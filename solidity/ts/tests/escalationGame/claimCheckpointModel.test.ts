import { beforeEach, describe, test } from 'bun:test'
import { encodeDeployData, zeroAddress, zeroHash, type Address } from '@zoltar/core-shared/evm/ethereum'
import assert from '../../testSupport/simulator/utils/assert'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { readClaimCheckpointBatch, type ClaimCheckpointTuple } from '../../testSupport/simulator/utils/contracts/claimCheckpoints'
import { test_statoblast_EscalationClaimCheckpointHarness_EscalationClaimCheckpointHarness as harness } from '../../types/contractArtifact'
import { useEscalationGameFixture } from './fixture'

type Interval = readonly [bigint, bigint, bigint, bigint]
type Transform = { before: bigint; remaining: bigint; consumed: bigint }

// Deterministic inputs and scheduling share a replay seed, but expectations never
// read the contract's transform getters, checkpoint cache, or allocation output.
function randomIntegers(seed: number) {
	let state = seed >>> 0
	return (limit: number) => {
		state = (state + 0x6d2b79f5) >>> 0
		let value = Math.imul(state ^ (state >>> 15), state | 1)
		value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
		return Math.floor((((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000) * limit)
	}
}

function sequentialFloor(interval: Interval, { before, remaining, consumed }: Transform): Interval {
	const scaled = interval.map(value => (before === 0n ? value : (value * remaining) / before))
	const [start, end, rewardStart, rewardEnd] = scaled
	if (start === undefined || end === undefined || rewardStart === undefined || rewardEnd === undefined || start < consumed) throw new Error('Invalid reference interval')
	return [start - consumed, end - consumed, rewardStart, rewardEnd]
}

describe('Escalation Game: seeded checkpoint state machine', () => {
	const fixture = useEscalationGameFixture()
	beforeEach(async () => {
		await fixture.mockWindow.setTime(16n * 7n * 24n * 60n * 60n)
	})

	for (const seed of [0xc1a10001, 0xc1a10002, 0xc1a10003, 0xc1a10004, 0xc1a10005, 0xc1a10006, 0xc1a10007, 0xc1a10008]) {
		test(`sequential floors and fair cache schedules agree for seed 0x${seed.toString(16)}`, async () => {
			const random = randomIntegers(seed)
			const amount = BigInt(1 + random(24))
			const leafIndex = seed % 4 === 0 ? 0n : 1n
			const start = leafIndex === 0n ? 0n : BigInt(16 + random(96))
			const tuple: ClaimCheckpointTuple = [random(3), amount, start + amount, leafIndex]
			const initial: Interval = [start, start + amount, start, start + amount]
			const depth = 11 + random(9)
			const schedule = seed % 4
			const trace: string[] = []
			const context = () => `seed=0x${seed.toString(16)} depth=${depth} schedule=${schedule} trace=${trace.join(',')}`
			const deploy = async (source: Address, transform: Transform, inherited = true) => {
				const hash = await fixture.client.sendTransaction({ data: encodeDeployData({ abi: harness.abi, bytecode: `0x${harness.evm.bytecode.object}`, args: [source, inherited ? leafIndex + 1n : leafIndex, transform.before, transform.remaining, transform.consumed] }) })
				const receipt = await fixture.client.waitForTransactionReceipt({ hash })
				if (receipt.contractAddress === undefined) throw new Error(`Missing history node: ${context()}`)
				return receipt.contractAddress
			}
			const progress = (game: Address) => fixture.client.readContract({ abi: harness.abi, address: game, functionName: 'getClaimCheckpointProgress', args: tuple })
			const interval = (game: Address) => fixture.client.readContract({ abi: harness.abi, address: game, functionName: 'getUnresolvedClaimInterval', args: tuple })
			const checkpoint = (game: Address) => fixture.client.readContract({ abi: harness.abi, address: game, functionName: 'getClaimCheckpointState', args: tuple })
			const budgetOffset = random(8)
			const budgetStride = 1 + 2 * random(4)
			let calls = 0
			const step = async (game: Address, label: string, budget = BigInt(1 + ((budgetOffset + calls * budgetStride) % 8))) => {
				const before = await progress(game)
				const batch = await readClaimCheckpointBatch(fixture.client, game, tuple, budget)
				trace.push(`${label}:${budget}:${before[1]}:${batch.transforms.length}`)
				await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: harness.abi, address: game, functionName: 'processClaimCheckpoint', args: [...tuple, budget, batch.baseCommitment, batch.transforms] }))
				calls += 1
				const after = await progress(game)
				if (!after[2]) assert.ok(after[1] - before[1] <= budget && before[1] - after[1] <= budget, context())
				return after
			}
			const finish = async (game: Address, label: string) => {
				for (let turn = 0; turn <= 2 * depth + 2; turn += 1) {
					if ((await progress(game))[2]) return
					await step(game, label)
				}
				throw new Error(`Fair positive-budget schedule failed to finish: ${context()}`)
			}

			// Unrelated history preceding the local leaf must never influence it.
			let source = zeroAddress
			const olderGenerations = 1 + random(3)
			for (let older = 0; older < olderGenerations; older += 1) source = await deploy(source, { before: 17n, remaining: 1n, consumed: 1000n })
			const nodes: Address[] = []
			const expected: Interval[] = []
			let current = initial
			for (let generation = 0; generation < depth; generation += 1) {
				const before = BigInt(10 + random(24))
				const remaining = seed % 3 === 0 && generation === 5 ? 0n : before - BigInt(random(2))
				const retainedStart = generation === 0 ? current[0] : (current[0] * remaining) / before
				const consumed = leafIndex === 0n ? 0n : BigInt(random(Number(retainedStart < 3n ? retainedStart : 3n) + 1))
				const transform = { before, remaining, consumed }
				source = await deploy(source, transform, generation !== 0)
				current = sequentialFloor(current, generation === 0 ? { ...transform, before: 0n } : transform)
				nodes.push(source)
				expected.push(current)
				if (generation <= 8) assert.deepStrictEqual(await interval(source), current, `shallow local-origin view: ${context()}`)
			}
			const targetTransform = { before: 11n, remaining: BigInt(7 + random(5)), consumed: 0n }
			const cold = await deploy(source, targetTransform)
			const reused = await deploy(source, targetTransform)
			const output = sequentialFloor(current, targetTransform)
			assert.strictEqual((await progress(cold))[3], false, context())
			await assert.rejects(interval(cold), /Claim checkpoint required/)

			// A cold cache's stored coordinates advance through the independent
			// prefix one budget at a time, including intervals rounded to zero.
			for (let turn = 0; turn <= 2 * depth + 2; turn += 1) {
				if ((await progress(cold))[2]) break
				const after = await step(cold, 'cold')
				const applied = after[0] === zeroAddress ? depth - 1 - Number(after[1]) : 0
				assert.deepStrictEqual(Object.values((await checkpoint(cold))[3]), applied === 0 ? initial : expected[applied - 1], context())
			}
			assert.strictEqual((await progress(cold))[2], true, context())
			assert.deepStrictEqual(await interval(cold), output, context())

			if (schedule === 1 || schedule === 2) await step(reused, 'early-child', 1n)
			if (schedule === 2) {
				for (let turn = 0; (await progress(reused))[0] !== zeroAddress && turn < depth; turn += 1) await step(reused, 'child-discovery')
				assert.strictEqual((await progress(reused))[0], zeroAddress, context())
				await step(reused, 'partial-child-application', 1n)
				assert.strictEqual((await progress(reused))[2], false, context())
			}
			// Half the seeds first cache a non-immediate ancestor. Parent discovery
			// must preserve the boundary transform when it reuses this prefix.
			if (seed % 8 >= 4) {
				const ancestor = nodes[3 + random(depth - 5)]
				if (ancestor === undefined) throw new Error(context())
				await finish(ancestor, 'ancestor')
			}
			if (schedule === 3) {
				// Round robin gives each pending job a positive budget. The child may
				// finish before adoption; either valid race must preserve the result.
				for (let turn = 0; turn <= 2 * depth + 2; turn += 1) {
					if ((await progress(source))[2]) break
					await step(source, 'parent')
					if (!(await progress(reused))[2]) await step(reused, 'child')
				}
			}
			await finish(source, 'parent')
			const childWasComplete = (await progress(reused))[2]
			await step(reused, 'adopt-parent', 1n)
			assert.deepStrictEqual(await progress(reused), [zeroAddress, 0n, true, true], context())
			if (!childWasComplete) assert.strictEqual((await checkpoint(reused))[2], source, context())
			assert.strictEqual((await checkpoint(reused))[1], zeroHash, context())
			assert.deepStrictEqual(await interval(reused), output, context())
			assert.deepStrictEqual(Object.values((await checkpoint(reused))[3]), expected.at(-2), context())
			const allocation = await fixture.client.readContract({ abi: harness.abi, address: reused, functionName: 'getInheritedClaimAllocation', args: tuple })
			assert.deepStrictEqual(allocation, [current[1] - current[0], output[1] - output[0], output[3] - output[2], output[3]], context())
			await step(reused, 'completed-replay')
			assert.deepStrictEqual(await interval(reused), await interval(cold), context())
		})
	}
})

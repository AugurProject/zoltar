import assert from '../../testSupport/simulator/utils/assert'
import { beforeEach, describe, test } from 'bun:test'
import { encodeAbiParameters, encodeDeployData, keccak256, type Address, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { createWriteClient, writeContractAndWait, type WriteClient } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate, test_statoblast_EscalationClaimCheckpointHarness_EscalationClaimCheckpointHarness as checkpointHarness } from '../../types/contractArtifact'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { readCarryPeaks, readCarryLeafCount, readCarryTotal, readNullifierRoot } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { zeroHash, zeroPeakArray } from './carryHelpers'
import { useEscalationGameFixture } from './fixture'
import { readClaimCheckpointBatch } from '../../testSupport/simulator/utils/contracts/claimCheckpoints'
import { formatStorageSlot, getUintMappingStorageSlot } from '../../testSupport/storage'
import { getArray, getContractOutput, getRecord, getString, loadContractsJson, normalizeStorageLayout } from '../contractArtifactHelpers'

// These tests exercise the bounded view at the actual game fallback, while the
// exact checkpoint arithmetic is covered by the deterministic history harness.
describe('Escalation Game: bounded claim checkpoints', () => {
	const fixture = useEscalationGameFixture()
	beforeEach(async () => {
		// Anvil starts at timestamp 1; synthetic ancestors forked then and must
		// be past the canonical eight-week direct-claim window before caching.
		await fixture.mockWindow.setTime(16n * 7n * 24n * 60n * 60n)
	})

	test('deep unprepared history stops at a fixed bound instead of recursively walking ancestors', async () => {
		const { client, reportBond, nonDecisionThresholdAttoRep } = fixture
		let parent = await fixture.deployEscalationGameWithProofPool()
		await fixture.startEscalation(parent.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep)
		await fixture.depositOnOutcomeViaProofTestSecurityPool(parent.testSecurityPoolAddress, client.account.address, QuestionOutcome.Yes, reportBond)
		for (let generation = 0; generation < 10; generation += 1) {
			const peaks = await readCarryPeaks(client, parent.escalationGameAddress, QuestionOutcome.Yes)
			const count = await readCarryLeafCount(client, parent.escalationGameAddress, QuestionOutcome.Yes)
			const total = await readCarryTotal(client, parent.escalationGameAddress, QuestionOutcome.Yes)
			const root = await readNullifierRoot(client, parent.escalationGameAddress, QuestionOutcome.Yes)
			const child = await fixture.deployEscalationGameWithProofPool()
			await fixture.startEscalationFromFork(child.escalationGameAddress, reportBond, nonDecisionThresholdAttoRep, 0n)
			await fixture.initializeSnapshotFromSourceViaTestSecurityPool(child.testSecurityPoolAddress, parent.escalationGameAddress, zeroHash(), [zeroPeakArray(), peaks, zeroPeakArray()], [0n, count, 0n], [0n, total, 0n], [zeroHash(), root, zeroHash()])
			parent = child
		}
		await assert.rejects(
			client.readContract({
				abi: statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.abi,
				address: parent.escalationGameAddress,
				functionName: 'getInheritedClaimAllocation',
				args: [QuestionOutcome.Yes, reportBond, reportBond, 0n],
			}),
			/Claim checkpoint required/,
		)
	})

	type Transform = { before: bigint; remaining: bigint; consumed: bigint }
	type Interval = readonly [bigint, bigint, bigint, bigint]
	const tuple = [QuestionOutcome.Yes, 333_333_333_333_333n, 999_999_999_999_999n, 1n] as const
	const initialInterval = (amount: bigint = tuple[1], cumulative: bigint = tuple[2]): Interval => [cumulative - amount, cumulative, cumulative - amount, cumulative]
	const applyTransform = (interval: Interval, transform: Transform): Interval => {
		const retain = (value: bigint) => (transform.before === 0n ? value : (value * transform.remaining) / transform.before)
		return [retain(interval[0]) - transform.consumed, retain(interval[1]) - transform.consumed, retain(interval[2]), retain(interval[3])]
	}
	const deployHistoryNode = async (source: Address, transform: Transform, snapshotLeafCount = 2n) => {
		const hash = await fixture.client.sendTransaction({
			data: encodeDeployData({ abi: checkpointHarness.abi, bytecode: `0x${checkpointHarness.evm.bytecode.object}`, args: [source, snapshotLeafCount, transform.before, transform.remaining, transform.consumed] }),
		})
		const receipt = await fixture.client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === null || receipt.contractAddress === undefined) throw new Error('Claim history deployment missing')
		return receipt.contractAddress
	}
	const deployHistory = async (depth: number) => {
		const nodes: Address[] = []
		const transforms: Transform[] = []
		let source = addressString(0n)
		let interval = initialInterval()
		for (let generation = 0; generation < depth; generation += 1) {
			const before = generation === 0 ? 0n : 101n + BigInt(generation)
			const transform = { before, remaining: before === 0n ? 0n : before - 3n, consumed: BigInt(generation % 3) }
			source = await deployHistoryNode(source, transform, generation === 0 ? 0n : 2n)
			nodes.push(source)
			transforms.push(transform)
			interval = applyTransform(interval, transform)
		}
		const targetTransform = { before: 17n, remaining: 13n, consumed: 9n }
		const target = await deployHistoryNode(source, targetTransform)
		return { target, nodes, transforms, interval, targetTransform }
	}
	const progress = async (target: Address) => await fixture.client.readContract({ abi: checkpointHarness.abi, address: target, functionName: 'getClaimCheckpointProgress', args: tuple })
	const allocation = async (target: Address) => await fixture.client.readContract({ abi: checkpointHarness.abi, address: target, functionName: 'getInheritedClaimAllocation', args: tuple })
	const process = async (target: Address, maxSteps = 8n, client: WriteClient = fixture.client) => {
		const batch = await readClaimCheckpointBatch(client, target, tuple, maxSteps > 8n ? 8n : maxSteps)
		const hash = await writeContractAndWait(client, () => client.writeContract({ abi: checkpointHarness.abi, address: target, functionName: 'processClaimCheckpoint', args: [...tuple, maxSteps, batch.baseCommitment, batch.transforms] }))
		const receipt = await client.waitForTransactionReceipt({ hash })
		assert.ok(receipt.gasUsed < 1_500_000n, `checkpoint step used ${receipt.gasUsed} gas`)
		return receipt
	}
	const finish = async (target: Address, budget = 8n) => {
		let gasUsed = 0n
		let maximumGasUsed = 0n
		for (let transaction = 0; transaction < 100; transaction += 1) {
			if ((await progress(target))[2]) return { calls: transaction, gasUsed, maximumGasUsed }
			const receipt = await process(target, budget)
			gasUsed += receipt.gasUsed
			if (receipt.gasUsed > maximumGasUsed) maximumGasUsed = receipt.gasUsed
		}
		throw new Error('Checkpoint did not finish within its expected bound')
	}
	const expectedAllocation = (interval: Interval, transform: Transform): Interval => {
		const retained = applyTransform(interval, { ...transform, consumed: 0n })
		return [interval[1] - interval[0], retained[1] - retained[0], retained[3] - retained[2], retained[3]]
	}

	test('real game fallback stores and verifies checkpoint witnesses in the game domain', async () => {
		const history = await deployHistory(13)
		const target = await fixture.deployEscalationGameWithProofPool()
		await fixture.startEscalationFromFork(target.escalationGameAddress, fixture.reportBond, fixture.nonDecisionThresholdAttoRep, 0n)
		await fixture.initializeSnapshotFromSourceViaTestSecurityPool(target.testSecurityPoolAddress, history.target, zeroHash(), [zeroPeakArray(), zeroPeakArray(), zeroPeakArray()], [0n, 2n, 0n], [0n, tuple[2], 0n], [zeroHash(), zeroHash(), zeroHash()])
		await finish(target.escalationGameAddress)
		const expected = applyTransform(history.interval, history.targetTransform)
		assert.deepStrictEqual(await allocation(target.escalationGameAddress), expectedAllocation(expected, { before: 0n, remaining: 0n, consumed: 0n }))
		assert.deepStrictEqual(await progress(target.escalationGameAddress), [addressString(0n), 0n, true, true])
	})

	test('deep checkpoints preserve each floor, compact only principal, and resume permissionlessly', async () => {
		const { target, interval, targetTransform } = await deployHistory(25)
		assert.strictEqual((await progress(target))[3], false)
		await assert.rejects(allocation(target), /Claim checkpoint required/)
		const first = await process(target, 3n)
		assert.ok(first.gasUsed < 700_000n)
		assert.strictEqual((await progress(target))[1], 3n)
		assert.strictEqual((await progress(target))[2], false)
		const thirdParty = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[1])
		await process(target, 8n, thirdParty)
		assert.strictEqual((await progress(target))[1], 11n)
		await finish(target)
		assert.deepStrictEqual(await allocation(target), expectedAllocation(interval, targetTransform))
		assert.deepStrictEqual(await progress(target), [addressString(0n), 0n, true, true])
		const completeBefore = await allocation(target)
		await process(target, 1n, thirdParty)
		assert.deepStrictEqual(await allocation(target), completeBefore, 'duplicate/front-run processing cannot reset or overwrite a completed interval')
		const unresolved = await fixture.client.readContract({ abi: checkpointHarness.abi, address: target, functionName: 'getUnresolvedClaimInterval', args: tuple })
		assert.deepStrictEqual(unresolved, applyTransform(interval, targetTransform))
		assert.ok(unresolved[2] > unresolved[0], 'principal compacts while reward coordinates preserve previously allocated windows')
	})

	test('view fallback is bounded at exactly eight ancestors and checkpoint outputs agree with shallow views', async () => {
		const { target, interval, targetTransform } = await deployHistory(8)
		assert.deepStrictEqual((await progress(target)).slice(2), [false, true])
		const before = await allocation(target)
		assert.deepStrictEqual(before, expectedAllocation(interval, targetTransform))
		await finish(target)
		assert.deepStrictEqual(await allocation(target), before)
		const extra = await deployHistoryNode(target, { before: 0n, remaining: 0n, consumed: 0n })
		assert.strictEqual((await progress(extra))[3], false)
		await assert.rejects(allocation(extra), /Claim checkpoint required/)
		await finish(extra)
		assert.strictEqual((await progress(extra))[3], true)
	})

	test('immediate parent consumption and target retention remain live after checkpoint completion', async () => {
		const history = await deployHistory(12)
		const parent = history.nodes.at(-1)
		const parentTransform = history.transforms.at(-1)
		if (parent === undefined || parentTransform === undefined) throw new Error('Missing immediate parent')
		// Immediate-parent migration is still open, so its direct claims may change.
		const block = await fixture.client.getBlock()
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: parent, functionName: 'setForkState', args: [1, block.timestamp] }))
		await finish(history.target)
		const before = await allocation(history.target)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: parent, functionName: 'setConsumedBefore', args: [QuestionOutcome.Yes, parentTransform.consumed + 17n] }))
		const updatedInterval: Interval = [history.interval[0] - 17n, history.interval[1] - 17n, history.interval[2], history.interval[3]]
		assert.deepStrictEqual(await allocation(history.target), expectedAllocation(updatedInterval, history.targetTransform))
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: history.target, functionName: 'setRetention', args: [19n, 11n] }))
		assert.deepStrictEqual(await allocation(history.target), expectedAllocation(updatedInterval, { before: 19n, remaining: 11n, consumed: 0n }))
		assert.notStrictEqual((await allocation(history.target))[1], before[1])
	})

	test('mutable ancestors cannot be cached, and the exact migration deadline remains mutable', async () => {
		const { target, nodes } = await deployHistory(12)
		const grandparent = nodes.at(-2)
		if (grandparent === undefined) throw new Error('Missing grandparent')
		const block = await fixture.client.getBlock()
		const migrationPeriod = 8n * 7n * 24n * 60n * 60n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: grandparent, functionName: 'setForkState', args: [0, 1n] }))
		await assert.rejects(process(target), /Claim source still mutable/)
		assert.strictEqual((await progress(target))[1], 0n, 'failed processing must not commit partial frames')
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: grandparent, functionName: 'setForkState', args: [1, block.timestamp] }))
		await fixture.mockWindow.setTime(block.timestamp + migrationPeriod)
		assert.strictEqual(await fixture.client.readContract({ abi: checkpointHarness.abi, address: grandparent, functionName: 'isClaimHistoryFrozen' }), false)
		await fixture.mockWindow.setTime(block.timestamp + migrationPeriod + 1n)
		assert.strictEqual(await fixture.client.readContract({ abi: checkpointHarness.abi, address: grandparent, functionName: 'isClaimHistoryFrozen' }), true)
		await finish(target)
		assert.strictEqual((await progress(target))[2], true)
	})

	test('claim tuple isolation, invalid budgets, and pending snapshot guards prevent cache poisoning', async () => {
		const { target } = await deployHistory(11)
		for (const budget of [0n, 9n, (1n << 256n) - 1n]) await assert.rejects(process(target, budget), /Invalid checkpoint budget/)
		await assert.rejects(fixture.client.simulateContract({ abi: checkpointHarness.abi, address: target, functionName: 'processClaimCheckpoint', args: [...tuple, 8n, `0x${'01'.repeat(32)}`, []] }), /Invalid checkpoint base/)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: target, functionName: 'processClaimCheckpoint', args: [QuestionOutcome.No, tuple[1], tuple[2], tuple[3], 8n, zeroHash(), []] }))
		assert.strictEqual((await progress(target))[1], 0n, 'another outcome has separate progress')
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: target, functionName: 'processClaimCheckpoint', args: [QuestionOutcome.Yes, tuple[1] + 1n, tuple[2], tuple[3], 8n, zeroHash(), []] }))
		assert.strictEqual((await progress(target))[1], 0n, 'another claimed amount has separate progress')
		await assert.rejects(fixture.client.readContract({ abi: checkpointHarness.abi, address: target, functionName: 'getClaimCheckpointProgress', args: [3, 1n, 1n, 1n] }), /Invalid claim interval/)
		await assert.rejects(fixture.client.readContract({ abi: checkpointHarness.abi, address: target, functionName: 'getClaimCheckpointProgress', args: [1, 2n, 1n, 1n] }), /Invalid claim interval/)
		await assert.rejects(fixture.client.readContract({ abi: checkpointHarness.abi, address: target, functionName: 'getClaimCheckpointProgress', args: [1, 1n, 1n, 1n << 64n] }), /Invalid claim interval/)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: target, functionName: 'setSnapshotProgress', args: [2] }))
		await assert.rejects(process(target), /Fork snapshot incomplete/)
		await assert.rejects(allocation(target), /Fork snapshot incomplete/)
		await assert.rejects(progress(target), /Fork snapshot incomplete/)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: target, functionName: 'setSnapshotProgress', args: [3] }))
		await finish(target)
		assert.strictEqual((await progress(target))[2], true)
	})

	test('local leaves stop ancestry traversal at their origin and cannot inherit an older haircut', async () => {
		const { target: ancestor } = await deployHistory(12)
		// leafIndex1 was added locally because only one leaf was inherited here.
		const origin = await deployHistoryNode(ancestor, { before: 9n, remaining: 1n, consumed: 5n }, 1n)
		const target = await deployHistoryNode(origin, { before: 0n, remaining: 0n, consumed: 0n })
		assert.strictEqual((await progress(target))[3], true)
		const expected = applyTransform(initialInterval(), { before: 0n, remaining: 0n, consumed: 5n })
		assert.deepStrictEqual(await allocation(target), expectedAllocation(expected, { before: 0n, remaining: 0n, consumed: 0n }))
		await finish(target)
		assert.deepStrictEqual(await allocation(target), expectedAllocation(expected, { before: 0n, remaining: 0n, consumed: 0n }))
	})

	test('a descendant reuses its canonical parent checkpoint instead of rebuilding the prepared prefix', async () => {
		const history = await deployHistory(25)
		await finish(history.target)
		const descendant = await deployHistoryNode(history.target, { before: 23n, remaining: 19n, consumed: 0n })
		await process(descendant)
		assert.strictEqual((await progress(descendant))[1], 0n, 'the canonical parent cache plus one frozen boundary transform completes preparation')
		assert.strictEqual((await progress(descendant))[2], true)
	})

	test('a newly completed parent cache supersedes cheap early preparation and partial application', async () => {
		for (const partiallyApplied of [false, true]) {
			const history = await deployHistory(18)
			const parent = history.nodes.at(-1)
			if (parent === undefined) throw new Error('Missing immediate parent')
			await process(history.target, 1n)
			if (partiallyApplied) {
				while ((await progress(history.target))[0] !== addressString(0n)) await process(history.target)
				await process(history.target, 1n)
			}
			assert.strictEqual((await progress(history.target))[2], false)
			await finish(parent)
			await process(history.target, 1n)
			assert.deepStrictEqual(await progress(history.target), [addressString(0n), 0n, true, true])
			assert.deepStrictEqual(await allocation(history.target), expectedAllocation(history.interval, history.targetTransform))
			const state = await fixture.client.readContract({ abi: checkpointHarness.abi, address: history.target, functionName: 'getClaimCheckpointState', args: tuple })
			assert.strictEqual(state[1], zeroHash())
			assert.strictEqual(state[2].toLowerCase(), parent.toLowerCase())
			assert.deepStrictEqual(await fixture.client.readContract({ abi: checkpointHarness.abi, address: history.target, functionName: 'getClaimCheckpointWitnessSegment', args: tuple }), [addressString(0n), zeroHash(), 0n, 0n])
		}
	})

	test('deeper canonical reuse includes both boundary transforms and preserves non-dyadic rounding', async () => {
		const history = await deployHistory(17)
		await finish(history.target)
		let source = history.target
		let expected = applyTransform(history.interval, history.targetTransform)
		for (let generation = 0; generation < 3; generation += 1) {
			const transform = { before: 29n + BigInt(generation), remaining: 17n, consumed: BigInt(generation) }
			source = await deployHistoryNode(source, transform)
			expected = applyTransform(expected, transform)
		}
		const targetTransform = { before: 11n, remaining: 7n, consumed: 0n }
		const target = await deployHistoryNode(source, targetTransform)
		await process(target, 1n)
		assert.strictEqual((await progress(target))[1], 1n)
		await process(target, 1n)
		assert.strictEqual((await progress(target))[1], 2n)
		await process(target, 1n)
		assert.strictEqual((await progress(target))[1], 3n)
		assert.notStrictEqual((await progress(target))[0], addressString(0n), 'reused source parent requires its own budgeted discovery step')
		await process(target, 1n)
		assert.strictEqual((await progress(target))[1], 4n)
		assert.strictEqual((await progress(target))[0], addressString(0n))
		await finish(target)
		assert.deepStrictEqual(await allocation(target), expectedAllocation(expected, targetTransform))
	})

	test('sparse anchors recover witnesses from current state after partial pops and later cache creation', async () => {
		const history = await deployHistory(18)
		while ((await progress(history.target))[1] < 17n) await process(history.target)
		const segment = () => fixture.client.readContract({ abi: checkpointHarness.abi, address: history.target, functionName: 'getClaimCheckpointWitnessSegment', args: tuple })
		assert.deepStrictEqual((await segment()).slice(2), [16n, 1n])
		const olderCache = history.nodes.at(-3)
		if (olderCache === undefined) throw new Error('Missing older cache')
		await finish(olderCache)
		// Recovery follows canonical source pointers and ignores newly available caches.
		const thirdParty = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[2])
		await process(history.target, 1n, thirdParty)
		assert.deepStrictEqual((await segment()).slice(2), [8n, 8n])
		await process(history.target, 7n, thirdParty)
		assert.deepStrictEqual((await segment()).slice(2), [8n, 1n])
		await process(history.target, 1n, thirdParty)
		assert.deepStrictEqual((await segment()).slice(2), [0n, 8n])
		await process(history.target, 1n, thirdParty)
		assert.deepStrictEqual((await segment()).slice(2), [0n, 7n])
		await process(history.target, 7n, thirdParty)
		assert.deepStrictEqual(await segment(), [addressString(0n), zeroHash(), 0n, 0n])
		assert.deepStrictEqual(await allocation(history.target), expectedAllocation(history.interval, history.targetTransform))
	})

	test('malformed, reordered, skipped, stale, and foreign compact batches revert atomically', async () => {
		const history = await deployHistory(17)
		while ((await progress(history.target))[1] < 16n) await process(history.target)
		const batch = await readClaimCheckpointBatch(fixture.client, history.target, tuple)
		const first = batch.transforms[0]
		if (first === undefined) throw new Error('Missing checkpoint transform')
		const write = async (value: typeof batch, target = history.target, claim: readonly [number, bigint, bigint, bigint] = tuple) =>
			await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: target, functionName: 'processClaimCheckpoint', args: [...claim, 8n, value.baseCommitment, value.transforms] }))
		const before = await progress(history.target)
		const state = () => fixture.client.readContract({ abi: checkpointHarness.abi, address: history.target, functionName: 'getClaimCheckpointState', args: tuple })
		const segment = () => fixture.client.readContract({ abi: checkpointHarness.abi, address: history.target, functionName: 'getClaimCheckpointWitnessSegment', args: tuple })
		const stateBefore = await state()
		const segmentBefore = await segment()
		for (const malformed of [
			{ ...batch, transforms: [{ ...first, repRemainingAttoRep: first.repRemainingAttoRep + 1n }, ...batch.transforms.slice(1)] },
			{ ...batch, baseCommitment: zeroHash() },
			{ ...batch, transforms: [...batch.transforms].reverse() },
			{ ...batch, transforms: batch.transforms.slice(1) },
			{ ...batch, transforms: batch.transforms.slice(0, -1) },
			{ ...batch, transforms: [first, ...batch.transforms.slice(0, -1)] },
		]) {
			await assert.rejects(write(malformed), /Invalid checkpoint batch/)
			assert.deepStrictEqual(await progress(history.target), before)
			assert.deepStrictEqual(await state(), stateBefore)
			assert.deepStrictEqual(await segment(), segmentBefore)
		}
		await assert.rejects(write({ ...batch, transforms: [...batch.transforms, first] }), /Invalid checkpoint budget/)
		await assert.rejects(write({ baseCommitment: zeroHash(), transforms: [] }), /Checkpoint transforms required/)
		const sibling = await deployHistoryNode(history.nodes.at(-1) ?? addressString(0n), history.targetTransform)
		while ((await progress(sibling))[1] < 16n) await process(sibling)
		await assert.rejects(write(batch, sibling), /Invalid checkpoint batch/)
		const foreignTuple = [QuestionOutcome.No, tuple[1], tuple[2], tuple[3]] as const
		for (let step = 0; step < 2; step += 1) await write({ baseCommitment: zeroHash(), transforms: [] }, history.target, foreignTuple)
		await assert.rejects(write(batch, history.target, foreignTuple), /Invalid checkpoint batch/)
		const partial = await readClaimCheckpointBatch(fixture.client, history.target, tuple, 1n)
		await write(partial)
		const afterConcurrentPop = await state()
		await assert.rejects(write(batch), /Invalid checkpoint batch/)
		assert.deepStrictEqual(await state(), afterConcurrentPop)
		await finish(history.target)
		assert.deepStrictEqual(await allocation(history.target), expectedAllocation(history.interval, history.targetTransform))
	})

	test('completed caches cannot cross a sibling branch, another tuple, or a later local leaf origin', async () => {
		const history = await deployHistory(16)
		await finish(history.target)
		const source = history.nodes.at(-1)
		if (source === undefined) throw new Error('Missing branch source')
		const sibling = await deployHistoryNode(source, { before: 37n, remaining: 19n, consumed: 0n })
		const descendant = await deployHistoryNode(sibling, { before: 0n, remaining: 0n, consumed: 0n })
		await process(descendant)
		assert.strictEqual((await progress(descendant))[1], 8n, 'a sibling checkpoint is not on this canonical path')
		const differentTupleTarget = await deployHistoryNode(history.target, { before: 0n, remaining: 0n, consumed: 0n })
		const foreignTuple = [QuestionOutcome.Yes, tuple[1] + 1n, tuple[2], tuple[3]] as const
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: differentTupleTarget, functionName: 'processClaimCheckpoint', args: [...foreignTuple, 8n, zeroHash(), []] }))
		const foreignState = await fixture.client.readContract({ abi: checkpointHarness.abi, address: differentTupleTarget, functionName: 'getClaimCheckpointState', args: foreignTuple })
		assert.strictEqual(foreignState[2], addressString(0n))
		const localOrigin = await deployHistoryNode(history.target, { before: 13n, remaining: 1n, consumed: 3n }, 1n)
		await finish(localOrigin)
		const localDescendant = await deployHistoryNode(localOrigin, { before: 0n, remaining: 0n, consumed: 0n })
		await finish(localDescendant)
		assert.deepStrictEqual(await allocation(localDescendant), expectedAllocation(applyTransform(initialInterval(), { before: 0n, remaining: 0n, consumed: 3n }), { before: 0n, remaining: 0n, consumed: 0n }))
	})

	test('reused boundary must be frozen while the immediate parent and target stay live', async () => {
		const history = await deployHistory(15)
		const parent = history.nodes.at(-1)
		const grandparent = history.nodes.at(-2)
		const parentTransform = history.transforms.at(-1)
		if (parent === undefined || grandparent === undefined || parentTransform === undefined) throw new Error('Missing reuse boundary')
		await finish(parent)
		const block = await fixture.client.getBlock()
		const cutoff = block.timestamp + 8n * 7n * 24n * 60n * 60n
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: grandparent, functionName: 'setForkState', args: [1, block.timestamp] }))
		await fixture.mockWindow.setTime(cutoff)
		await assert.rejects(fixture.client.simulateContract({ abi: checkpointHarness.abi, address: history.target, functionName: 'processClaimCheckpoint', args: [...tuple, 1n, zeroHash(), []] }), /Claim source still mutable/)
		assert.strictEqual((await progress(history.target))[1], 0n)
		await fixture.mockWindow.setTime(cutoff + 1n)
		await process(history.target, 1n)
		assert.strictEqual((await progress(history.target))[2], true)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: parent, functionName: 'setConsumedBefore', args: [QuestionOutcome.Yes, parentTransform.consumed + 7n] }))
		const updated: Interval = [history.interval[0] - 7n, history.interval[1] - 7n, history.interval[2], history.interval[3]]
		assert.deepStrictEqual(await allocation(history.target), expectedAllocation(updated, history.targetTransform))
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: history.target, functionName: 'setRetention', args: [47n, 29n] }))
		assert.deepStrictEqual(await allocation(history.target), expectedAllocation(updated, { before: 47n, remaining: 29n, consumed: 0n }))
	})

	test('every partial suffix size preserves its exact base, segment, and four interval coordinates', async () => {
		const history = await deployHistory(17)
		const source = history.nodes.at(-1)
		if (source === undefined) throw new Error('Missing batched history source')
		for (let budget = 1n; budget <= 8n; budget += 1n) {
			const target = await deployHistoryNode(source, history.targetTransform)
			while ((await progress(target))[0] !== addressString(0n) || (await progress(target))[1] === 0n) await process(target)
			const batch = await readClaimCheckpointBatch(fixture.client, target, tuple, budget)
			assert.strictEqual(batch.transforms.length, Number(budget))
			await process(target, budget)
			const state = await fixture.client.readContract({ abi: checkpointHarness.abi, address: target, functionName: 'getClaimCheckpointState', args: tuple })
			const expected = history.transforms.slice(0, Number(budget)).reduce(applyTransform, initialInterval())
			assert.deepStrictEqual(Object.values(state[3]), expected)
			assert.strictEqual(state[1], batch.baseCommitment)
			assert.strictEqual((await progress(target))[1], 16n - budget)
			const segment = await fixture.client.readContract({ abi: checkpointHarness.abi, address: target, functionName: 'getClaimCheckpointWitnessSegment', args: tuple })
			assert.deepStrictEqual(segment.slice(2), budget === 8n ? [0n, 8n] : [8n, 8n - budget])
			await finish(target, budget)
			assert.deepStrictEqual(await allocation(target), expectedAllocation(history.interval, history.targetTransform))
		}
	})

	test('authenticated batches crossing sparse segment boundaries delete only exhausted anchors', async () => {
		const history = await deployHistory(18)
		while ((await progress(history.target))[1] < 17n) await process(history.target)
		const claimId = keccak256(encodeAbiParameters([{ type: 'uint8' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], tuple))
		const checkpointStorage = normalizeStorageLayout(getContractOutput(loadContractsJson(`${import.meta.dir}/..`), 'contracts/test/statoblast/EscalationClaimCheckpointHarness.sol', 'EscalationClaimCheckpointHarness')).find(entry => entry.label === 'claimCheckpoints')
		if (checkpointStorage === undefined) throw new Error('Missing checkpoint storage')
		const checkpointType = getRecord(checkpointStorage.type['value'], 'Missing checkpoint mapping value')
		const segmentsStorage = getArray(checkpointType['members'], 'Missing checkpoint members')
			.map(member => getRecord(member, 'Invalid checkpoint member'))
			.find(member => member['label'] === 'segments')
		if (segmentsStorage === undefined) throw new Error('Missing segment storage')
		const segmentsSlot = getUintMappingStorageSlot(BigInt(claimId), BigInt(checkpointStorage.slot)) + BigInt(getString(segmentsStorage['slot'], 'Missing segments offset'))
		const segmentSlot = getUintMappingStorageSlot(2n, segmentsSlot)
		const readSlot = (slot: bigint) => fixture.mockWindow.request({ method: 'eth_getStorageAt', params: [history.target, formatStorageSlot(slot), 'latest'] })
		assert.notStrictEqual(await readSlot(segmentSlot), zeroHash())
		assert.notStrictEqual(await readSlot(segmentSlot + 1n), zeroHash())
		let baseCommitment: Hash = zeroHash()
		for (const transform of history.transforms.slice(8, 17).reverse()) {
			baseCommitment = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }, { type: 'bytes32' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], [history.target, claimId, baseCommitment, transform.before, transform.remaining, transform.consumed]))
		}
		const transforms = history.transforms
			.slice(0, 8)
			.reverse()
			.map(transform => ({ repBeforeAttoRep: transform.before, repRemainingAttoRep: transform.remaining, consumedBeforeAttoRep: transform.consumed }))
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: history.target, functionName: 'processClaimCheckpoint', args: [...tuple, 8n, baseCommitment, transforms] }))
		assert.strictEqual((await progress(history.target))[1], 9n)
		const segment = await fixture.client.readContract({ abi: checkpointHarness.abi, address: history.target, functionName: 'getClaimCheckpointWitnessSegment', args: tuple })
		assert.deepStrictEqual(segment.slice(2), [8n, 1n])
		const state = await fixture.client.readContract({ abi: checkpointHarness.abi, address: history.target, functionName: 'getClaimCheckpointState', args: tuple })
		assert.strictEqual(state[1], baseCommitment)
		assert.deepStrictEqual(Object.values(state[3]), history.transforms.slice(0, 8).reduce(applyTransform, initialInterval()))
		assert.strictEqual(await readSlot(segmentSlot), zeroHash(), 'the exhausted segment source must be deleted')
		assert.strictEqual(await readSlot(segmentSlot + 1n), zeroHash(), 'the exhausted segment commitment must be deleted')
		assert.notStrictEqual(await readSlot(getUintMappingStorageSlot(1n, segmentsSlot)), zeroHash(), 'the partially applied segment stays recoverable')
		await finish(history.target)
		assert.deepStrictEqual(await allocation(history.target), expectedAllocation(history.interval, history.targetTransform))
	})

	test('cold sparse storage stays bounded and prepared descendants reuse checkpoint work', async () => {
		const history = await deployHistory(25)
		const cold = await finish(history.target)
		const descendant = await deployHistoryNode(history.target, { before: 0n, remaining: 0n, consumed: 0n })
		const warm = await finish(descendant)
		// Includes the bounded central-custody checks added to each native claim path.
		// The six-call budget is separate from the per-transaction cap below.
		assert.strictEqual(cold.calls, 6)
		assert.ok(cold.gasUsed < 2_100_000n, `cold preparation used ${cold.gasUsed} gas`)
		assert.strictEqual(warm.calls, 1)
		assert.ok(warm.gasUsed < 350_000n, `reused preparation used ${warm.gasUsed} gas`)
		console.info(`Claim checkpoint gas: cold25=${cold.gasUsed} (${cold.calls} calls, maximum ${cold.maximumGasUsed}), prepared descendant=${warm.gasUsed} (${warm.calls} call)`)
	})

	test('maximum supported leaf-index depth keeps every ancestry transaction below the gas cap', async () => {
		const leafCount = (1n << 64n) - 1n
		const deepTuple = [QuestionOutcome.Yes, tuple[1], tuple[2], leafCount - 1n] as const
		let source = addressString(0n)
		let interval = initialInterval()
		const transform = { before: 101n, remaining: 99n, consumed: 0n }
		for (let generation = 0; generation < 11; generation += 1) {
			source = await deployHistoryNode(source, transform, generation === 0 ? 0n : leafCount)
			if (generation !== 0) interval = applyTransform(interval, transform)
		}
		const target = await deployHistoryNode(source, transform, leafCount)
		let maximumGasUsed = 0n
		for (let transaction = 0; transaction < 4; transaction += 1) {
			const batch = await readClaimCheckpointBatch(fixture.client, target, deepTuple)
			const hash = await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: checkpointHarness.abi, address: target, functionName: 'processClaimCheckpoint', args: [...deepTuple, 8n, batch.baseCommitment, batch.transforms], gas: 3_000_000n }))
			const receipt = await fixture.client.waitForTransactionReceipt({ hash })
			assert.ok(receipt.gasUsed < 3_000_000n, `worst leaf-index traversal used ${receipt.gasUsed} gas`)
			if (receipt.gasUsed > maximumGasUsed) maximumGasUsed = receipt.gasUsed
		}
		console.info(`Claim checkpoint maximum leaf-index step gas: ${maximumGasUsed}`)
		const completed = await fixture.client.readContract({ abi: checkpointHarness.abi, address: target, functionName: 'getClaimCheckpointProgress', args: deepTuple })
		assert.strictEqual(completed[2], true)
		assert.deepStrictEqual(await fixture.client.readContract({ abi: checkpointHarness.abi, address: target, functionName: 'getInheritedClaimAllocation', args: deepTuple }), expectedAllocation(interval, transform))
	})
})

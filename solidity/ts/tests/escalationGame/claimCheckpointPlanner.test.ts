import { beforeEach, describe, expect, test } from 'bun:test'
import { encodeDeployData, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { isFinalClaimCheckpointBatch, planClaimCheckpointPreparation, type ClaimCheckpointIdentity, type ClaimCheckpointProgress, type ClaimCheckpointSettlement } from '@zoltar/statoblast-shared/escalationGame/claimCheckpoint'
import { test_statoblast_EscalationClaimCheckpointHarness_EscalationClaimCheckpointHarness as harness } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { readClaimCheckpointBatch } from '../../testSupport/simulator/utils/contracts/claimCheckpoints'
import { useEscalationGameFixture } from './fixture'

// Actual harness receipts validate discovery/application costs. Settlement counts
// below are explicit policy accounting; real pool atomic/separate settlement is
// exercised by statoblast/escalationMigration.test.ts.
describe('checkpoint planner executed preparation costs', () => {
	const fixture = useEscalationGameFixture()
	const tuple = [1, 100n, 200n, 1n] as const
	const claim: ClaimCheckpointIdentity = { outcomeIndex: tuple[0], amountAttoRep: tuple[1], cumulativeAmountAttoRep: tuple[2], leafIndex: tuple[3] }
	beforeEach(async () => {
		await fixture.mockWindow.setTime(16n * 7n * 24n * 60n * 60n)
	})
	async function deploy(source: Address) {
		const hash = await fixture.client.sendTransaction({ data: encodeDeployData({ abi: harness.abi, bytecode: `0x${harness.evm.bytecode.object}`, args: [source, source === zeroAddress ? 0n : 2n, 1000n, 997n, 0n] }) })
		const receipt = await fixture.client.waitForTransactionReceipt({ hash })
		if (receipt.contractAddress === null || receipt.contractAddress === undefined) throw new Error('Missing checkpoint harness address')
		return receipt.contractAddress
	}
	async function progress(game: Address): Promise<ClaimCheckpointProgress> {
		const value = await fixture.client.readContract({ abi: harness.abi, address: game, functionName: 'getClaimCheckpointProgress', args: tuple })
		return { nextSourceGame: value[0], pendingSteps: value[1], complete: value[2], ready: value[3] }
	}
	async function process(game: Address, maxSteps = 8n) {
		const batch = await readClaimCheckpointBatch(fixture.client, game, tuple, maxSteps)
		const hash = await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi: harness.abi, address: game, functionName: 'processClaimCheckpoint', args: [...tuple, maxSteps, batch.baseCommitment, batch.transforms] }))
		const receipt = await fixture.client.waitForTransactionReceipt({ hash })
		expect(receipt.status).toBe('success')
	}
	async function readNode(game: Address) {
		const [local, historyFrozen, checkpoint] = await Promise.all([
			fixture.client.readContract({ abi: harness.abi, address: game, functionName: 'getClaimIntervalTransform', args: [tuple[0], tuple[3]] }),
			fixture.client.readContract({ abi: harness.abi, address: game, functionName: 'isClaimHistoryFrozen' }),
			progress(game),
		])
		return { parentGame: local[0], historyFrozen, progress: checkpoint }
	}
	async function execute(targets: Address[], settlement: ClaimCheckpointSettlement, planned: boolean) {
		let preparationTransactions = 0
		let atomicFinalBatches = 0
		let reused = false
		for (let round = 0; round < 100; round++) {
			const pending: Address[] = []
			for (const game of targets) if (!(await progress(game)).ready) pending.push(game)
			if (pending.length === 0) return { preparationTransactions, accountedTotalTransactions: preparationTransactions + targets.length - atomicFinalBatches, reused }
			const jobs = planned ? await planClaimCheckpointPreparation({ claims: pending.map(game => ({ game, claim, settlement })), readNode, maxAncestorReads: 64 }) : pending.map(game => ({ game, targetGame: game, reason: 'required' }))
			expect(jobs.length).toBeGreaterThan(0)
			for (const job of jobs) {
				const before = await progress(job.game)
				if (settlement === 'atomic' && job.game === job.targetGame && isFinalClaimCheckpointBatch(before)) atomicFinalBatches++
				if (job.reason !== 'required') reused = true
				await process(job.game)
				preparationTransactions++
			}
		}
		throw new Error('Checkpoint planner did not reach settlement readiness')
	}
	const cases = [8, 16, 24, 32].flatMap(depth => [false, true].map(partial => ({ depth, partial })))
	test.each(cases)('depth $depth, partial application $partial: branches and settlement capability never increase accounted transactions', async ({ depth, partial }) => {
		let parent = zeroAddress
		for (let index = 0; index <= depth; index++) parent = await deploy(parent)
		const targets = [await deploy(parent), await deploy(parent), await deploy(parent)]
		if (partial) {
			for (const target of targets) {
				while ((await progress(target)).nextSourceGame !== zeroAddress) await process(target)
				await process(target, 3n)
			}
		}
		for (const count of [1, 3]) {
			for (const settlement of ['atomic', 'separate'] as const) {
				const selected = targets.slice(0, count)
				const snapshot = await fixture.mockWindow.anvilSnapshot()
				const direct = await execute(selected, settlement, false)
				const directAllocations = await Promise.all(selected.map(address => fixture.client.readContract({ abi: harness.abi, address, functionName: 'getInheritedClaimAllocation', args: tuple })))
				await fixture.mockWindow.anvilRevert(snapshot)
				const retrySnapshot = await fixture.mockWindow.anvilSnapshot()
				const planned = await execute(selected, settlement, true)
				expect(planned.accountedTotalTransactions).toBeLessThanOrEqual(direct.accountedTotalTransactions)
				if (planned.reused) expect(planned.accountedTotalTransactions).toBeLessThan(direct.accountedTotalTransactions)
				const plannedAllocations = await Promise.all(selected.map(address => fixture.client.readContract({ abi: harness.abi, address, functionName: 'getInheritedClaimAllocation', args: tuple })))
				expect(plannedAllocations).toEqual(directAllocations)
				await fixture.mockWindow.anvilRevert(retrySnapshot)
			}
		}
	})
	test('a nearly applied parent beats the separate-settlement 24-step terminal in executed preparation', async () => {
		let parent = zeroAddress
		for (let index = 0; index <= 24; index++) parent = await deploy(parent)
		const target = await deploy(parent)
		while ((await progress(target)).nextSourceGame !== zeroAddress) await process(target)
		while ((await progress(parent)).nextSourceGame !== zeroAddress) await process(parent)
		while ((await progress(parent)).pendingSteps > 1n) {
			const remaining = (await progress(parent)).pendingSteps - 1n
			await process(parent, remaining > 8n ? 8n : remaining)
		}
		expect((await progress(target)).pendingSteps).toBe(24n)
		expect((await progress(parent)).pendingSteps).toBe(1n)
		const snapshot = await fixture.mockWindow.anvilSnapshot()
		const direct = await execute([target], 'separate', false)
		const directAllocation = await fixture.client.readContract({ abi: harness.abi, address: target, functionName: 'getInheritedClaimAllocation', args: tuple })
		await fixture.mockWindow.anvilRevert(snapshot)
		const planned = await execute([target], 'separate', true)
		expect(direct.preparationTransactions).toBe(3)
		expect(planned.preparationTransactions).toBe(2)
		expect(planned.reused).toBeTrue()
		// Already-pending target progress requires its own adoption transaction.
		expect(planned.accountedTotalTransactions).toBe(3)
		expect(direct.accountedTotalTransactions).toBe(4)
		expect(await fixture.client.readContract({ abi: harness.abi, address: target, functionName: 'getInheritedClaimAllocation', args: tuple })).toEqual(directAllocation)
	})
})

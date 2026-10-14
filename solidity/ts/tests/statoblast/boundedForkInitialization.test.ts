import { describe, expect, test } from 'bun:test'
import { encodeFunctionData, keccak256, zeroAddress, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { formatStorageSlot } from '../../testSupport/storage'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getInfraContractAddresses, getSecurityPoolAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getSecurityPoolsEscalationGame, getSystemState } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getSecurityPoolForkerForkData, initiateSecurityPoolFork } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { getEscalationGameOutcomeState } from '../../testSupport/simulator/utils/contracts/escalationGame'
import { manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact, statoblast_EscalationGame_EscalationGame as gameArtifact, statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact } from '../../types/contractArtifact'
import { useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

const outcomes = [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]
const transactionGasLimit = 16_777_216n

describe('Statoblast: bounded fork initialization', () => {
	const fixture = useSecurityPoolPortfolioFixture()

	test.each([true, false])('every stage fits the transaction gas cap with all 64 peaks in every outcome; shared=%p', async shared => {
		const { owner, other, base, poolFor, secondQuestionId } = fixture
		const gasMeasurements: Record<string, string> = {}
		const checkGas = async (hash: Hash, stage: string) => {
			const { gasUsed } = await owner().waitForTransactionReceipt({ hash })
			expect(gasUsed).toBeLessThanOrEqual(transactionGasLimit)
			gasMeasurements[stage] = gasUsed.toString()
		}
		if (shared) await fixture.allocate(secondQuestionId)
		await base.mockWindow.setTime(fixture.secondEndTime + 1n)
		const native = getSecurityPoolAddresses(zeroAddress, base.genesisUniverse, base.questionId, base.statoblastSecurityMultiplierBps)
		const parent = shared ? poolFor(secondQuestionId).securityPool : native.securityPool
		if (shared) await fixture.refreshPrice(secondQuestionId)
		else await manipulatePriceOracle(owner(), base.mockWindow, native.openOraclePriceCoordinator)
		for (const outcome of outcomes) {
			const data = encodeFunctionData({ abi: poolArtifact.abi, functionName: 'depositToEscalationGame', args: [outcome, base.reportBond * BigInt(outcome + 1)] })
			if (shared) await fixture.execute(parent, data)
			else await writeContractAndWait(owner(), () => owner().sendTransaction({ to: parent, data }))
		}
		const parentGame = await getSecurityPoolsEscalationGame(owner(), parent)
		const leafCount = (1n << 64n) - 1n
		const stateDiff: Record<string, bigint> = {}
		// Synthetic storage isolates the maximum supported MMR shape, including histories
		// carried across arbitrarily many forks. This does not assert a reachable attack history.
		// Current compiler layout is checked by readback before measuring any operation.
		for (const outcome of outcomes) {
			const outcomeSlot = 8n + 142n * BigInt(outcome)
			stateDiff[formatStorageSlot(outcomeSlot + 70n)] = leafCount
			for (let peak = 0; peak < 64; peak++) stateDiff[formatStorageSlot(outcomeSlot + 71n + BigInt(peak))] = BigInt(keccak256(formatStorageSlot(BigInt(1 + outcome * 64 + peak))))
		}
		await base.mockWindow.addStateOverrides({ [parentGame]: { stateDiff } })
		const parentStates = await Promise.all(outcomes.map(outcome => getEscalationGameOutcomeState(owner(), parentGame, outcome)))
		for (const state of parentStates) {
			expect(state.currentLeafCount).toBe(leafCount)
			expect(state.currentPeaks.filter(peak => BigInt(peak) !== 0n)).toHaveLength(64)
		}
		await approveToken(owner(), getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner(), base.genesisUniverse, shared ? base.questionId : secondQuestionId)
		const forkHash = await initiateSecurityPoolFork(owner(), parent)
		await checkGas(forkHash, 'parent snapshot')
		if (shared) await fixture.prepareChild(parent, QuestionOutcome.No)
		await fixture.prepareChildDependencies(parent, QuestionOutcome.No)
		const forker = getInfraContractAddresses().securityPoolForker
		const created = await writeContractAndWait(owner(), () => owner().writeContract({ abi: forkerArtifact.abi, address: forker, functionName: 'createChildUniverse', args: [parent, BigInt(QuestionOutcome.No)] }))
		await checkGas(created, 'child creation')
		const factory = getInfraContractAddresses().securityPoolFactory
		const originId = await owner().readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getSecurityPoolOriginId', args: [parent] })
		const child = await owner().readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getSecurityPool', args: [originId, getChildUniverseId(base.genesisUniverse, QuestionOutcome.No)] })
		const childGame = await getSecurityPoolsEscalationGame(owner(), child)
		const count = () => owner().readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotOutcomesInitialized' })
		const initialized = () => owner().readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotInitialized' })
		const funded = () => owner().readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'isForkCarryFundingComplete' })
		const advance = async () => writeContractAndWait(other(), () => other().writeContract({ abi: forkerArtifact.abi, address: forker, functionName: 'continueChildUniverse', args: [parent, BigInt(QuestionOutcome.No)] }))
		expect(await count()).toBe(0n)
		expect(await funded()).toBe(false)
		await expect(owner().simulateContract({ abi: forkerArtifact.abi, address: forker, functionName: 'migrateVault', args: [parent, BigInt(QuestionOutcome.No)] })).rejects.toThrow('Fork carry not ready')
		await expect(owner().simulateContract({ abi: forkerArtifact.abi, address: forker, functionName: 'continueChildUniverse', args: [parent, BigInt(QuestionOutcome.Yes)] })).rejects.toThrow('Child pool missing')
		const parentFork = await getSecurityPoolForkerForkData(owner(), parent)
		const migrationCutoff = parentFork.forkActivationTime + 56n * DAY
		for (let step = 0; step < 3; step++) {
			expect(await initialized()).toBe(false)
			expect(await funded()).toBe(false)
			expect(await getSystemState(owner(), child)).toBe(SystemState.ForkMigration)
			// Completion remains possible after the original cutoff; that never reopens migration.
			if (step === 1) await base.mockWindow.setTime(migrationCutoff + 1n)
			if (step > 0) await expect(owner().simulateContract({ abi: forkerArtifact.abi, address: forker, functionName: 'startTruthAuction', args: [child] })).rejects.toThrow('Fork carry not ready')
			await expect(owner().simulateContract({ abi: poolArtifact.abi, address: child, functionName: 'resumeForkedEscalationGame' })).rejects.toThrow('Fork continuation unavailable')
			const hash = await advance()
			await checkGas(hash, `outcome ${step}`)
			expect(await count()).toBe(BigInt(step + 1))
		}
		expect(await initialized()).toBe(true)
		expect(await funded()).toBe(true)
		for (const outcome of outcomes) {
			const state = await getEscalationGameOutcomeState(owner(), childGame, outcome)
			const expected = parentStates[outcome]
			if (expected === undefined) throw new Error('Missing parent outcome state')
			expect(state.snapshotLeafCount).toBe(leafCount)
			expect(state.currentLeafCount).toBe(leafCount)
			expect(state.snapshotPeaks).toEqual(expected.currentPeaks)
			expect(state.currentPeaks).toEqual(expected.currentPeaks)
			expect(state.balanceAttoRep).toBe(expected.balanceAttoRep)
		}
		await advance()
		expect(await count()).toBe(3n)
		expect((await getSecurityPoolForkerForkData(owner(), parent)).forkActivationTime).toBe(parentFork.forkActivationTime)
		await expect(owner().simulateContract({ abi: forkerArtifact.abi, address: forker, functionName: 'migrateVault', args: [parent, BigInt(QuestionOutcome.No)] })).rejects.toThrow('Migration window closed')
		await expect(owner().simulateContract({ abi: forkerArtifact.abi, address: forker, functionName: 'createChildUniverse', args: [parent, BigInt(QuestionOutcome.Yes)] })).rejects.toThrow('Migration closed')
		await expect(owner().simulateContract({ abi: forkerArtifact.abi, address: forker, functionName: 'createChildUniverse', args: [parent, BigInt(QuestionOutcome.No)] })).rejects.toThrow('Child pool exists')
		const auction = await writeContractAndWait(other(), () => other().writeContract({ abi: forkerArtifact.abi, address: forker, functionName: 'startTruthAuction', args: [child] }))
		await checkGas(auction, 'activation')
		expect(await getSystemState(owner(), child)).toBe(SystemState.Operational)
		const resumedAt = await owner().readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkResumedAt' })
		expect(resumedAt).toBeGreaterThan(migrationCutoff)
		await advance()
		expect(await owner().readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkResumedAt' })).toBe(resumedAt)
		expect(await owner().readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'getEscalationGameEndDate' })).toBeGreaterThanOrEqual(resumedAt + 3n * DAY)
		if (process.env['REPORT_BOUNDED_FORK_GAS'] === '1') console.log('Bounded fork gas', { shared, ...gasMeasurements })
	})
})

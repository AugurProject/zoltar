import { describe, expect, test } from 'bun:test'
import { keccak256, zeroAddress, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { formatStorageSlot } from '../../testSupport/storage'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getSecurityPoolsEscalationGame, getSystemState } from '../../testSupport/simulator/utils/contracts/securityPool'
import { initiateSecurityPoolFork } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { getEscalationGameOutcomeState } from '../../testSupport/simulator/utils/contracts/escalationGame'
import {
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
} from '../../types/contractArtifact'
import { useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

const outcomes = [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]
const transactionGasLimit = 16_777_216n

describe('Statoblast: bounded fork initialization', () => {
	const fixture = useSecurityPoolPortfolioFixture()

	test('central first-use preparation and direct materialization fit the gas cap with 192 nonzero carry peaks', async () => {
		const { owner, other, base, poolFor, secondQuestionId } = fixture
		const parent = poolFor(secondQuestionId).securityPool
		const forker = getInfraContractAddresses().securityPoolForker
		const coordinator = await owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'forkController' })
		const gasMeasurements: Record<string, string> = {}
		const checkGas = async (hash: Hash, stage: string) => {
			const { gasUsed } = await owner().waitForTransactionReceipt({ hash })
			expect(gasUsed).toBeLessThanOrEqual(transactionGasLimit)
			gasMeasurements[stage] = gasUsed.toString()
		}
		await base.mockWindow.setTime(fixture.secondEndTime + 1n)
		await approveToken(owner(), getRepTokenAddress(base.genesisUniverse), parent)
		for (const outcome of outcomes) {
			await writeContractAndWait(owner(), () => owner().writeContract({ abi: poolArtifact.abi, address: parent, functionName: 'depositWalletRepToEscalationGame', args: [outcome, 11n * 10n ** 17n * BigInt(outcome + 1)] }))
		}
		const parentGame = await getSecurityPoolsEscalationGame(owner(), parent)
		const leafCount = (1n << 64n) - 1n
		const stateDiff: Record<string, bigint> = {}
		// Exercise the largest fixed-width carry representation, independent of the
		// number of historical questions, deposits and prior native forks.
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
		await forkUniverse(owner(), base.genesisUniverse, base.questionId)
		const forkTime = (await getUniverseData(owner(), base.genesisUniverse)).forkTime
		await checkGas(await initiateSecurityPoolFork(owner(), parent), 'aggregate freeze')
		await base.mockWindow.setTime(forkTime + 56n * DAY + 1n)
		const childUniverse = getChildUniverseId(base.genesisUniverse, QuestionOutcome.No)
		await checkGas(await writeContractAndWait(other(), () => other().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'prepareBranch', args: [base.genesisUniverse, BigInt(QuestionOutcome.No)], gas: transactionGasLimit })), 'shared branch custody preparation')
		await checkGas(await writeContractAndWait(other(), () => other().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'startBranch', args: [base.genesisUniverse, BigInt(QuestionOutcome.No)], gas: transactionGasLimit })), 'shared branch migration')
		const factory = getInfraContractAddresses().securityPoolFactory
		await writeContractAndWait(other(), () => other().writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'preparePortfolioPriceFeed', args: [parent, childUniverse] }))
		await writeContractAndWait(other(), () => other().writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'prepareChildPoolDependencies', args: [parent, BigInt(QuestionOutcome.No)] }))
		const childCoordinator = await owner().readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getChildPoolDependencies', args: [parent, BigInt(QuestionOutcome.No)] })
		const feed = await owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'priceFeed', args: [childUniverse] })
		const coordinatorCaller = createWriteClient(base.mockWindow, BigInt(childCoordinator))
		// Coordinator registration requires the native child, whose preparation
		// cannot bypass the shared fork activation window.
		await expect(coordinatorCaller.simulateContract({ abi: feedArtifact.abi, address: feed, functionName: 'requestPrice', args: [other().account.address, 1n, 0n, 0n] })).rejects.toThrow('Unregistered coordinator')
		await expect(other().simulateContract({ abi: forkerArtifact.abi, address: forker, functionName: 'preparePortfolioQuestion', args: [parent, childUniverse] })).rejects.toThrow('Fork activation window still open')
		await base.mockWindow.setTime(forkTime + 63n * DAY)
		await checkGas(await writeContractAndWait(other(), () => other().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'finalizeBranch', args: [childUniverse] })), 'shared branch activation')
		await checkGas(await writeContractAndWait(other(), () => other().writeContract({ abi: forkerArtifact.abi, address: forker, functionName: 'preparePortfolioQuestion', args: [parent, childUniverse] })), 'question preparation')
		const child = await owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'getPool', args: [secondQuestionId, childUniverse] })
		expect(await getSecurityPoolsEscalationGame(owner(), child)).toBe(zeroAddress)
		for (let outcome = 0; outcome < 3; outcome++) {
			await checkGas(await writeContractAndWait(other(), () => other().writeContract({ abi: forkerArtifact.abi, address: forker, functionName: 'materializePortfolioQuestion', args: [parent, childUniverse], gas: transactionGasLimit })), `question carry outcome ${outcome}`)
			const game = await getSecurityPoolsEscalationGame(owner(), child)
			expect(await owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'forkCarrySnapshotOutcomesInitialized' })).toBe(BigInt(outcome + 1))
			if (outcome < 2) {
				expect(await getSystemState(owner(), child)).toBe(SystemState.ForkMigration)
				expect(await owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'forkResumedAt' })).toBe(0n)
				await expect(owner().simulateContract({ abi: poolArtifact.abi, address: child, functionName: 'depositWalletRepToEscalationGame', args: [QuestionOutcome.Yes, 1n] })).rejects.toThrow()
				await expect(owner().simulateContract({ abi: poolArtifact.abi, address: child, functionName: 'resumeForkedEscalationGame' })).rejects.toThrow()
			}
		}
		const childGame = await getSecurityPoolsEscalationGame(owner(), child)
		expect(await getSystemState(owner(), child)).toBe(SystemState.Operational)
		expect(await owner().readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkCarrySnapshotInitialized' })).toBe(true)
		expect(await owner().readContract({ abi: gameArtifact.abi, address: childGame, functionName: 'forkResumedAt' })).toBe(forkTime + 63n * DAY)
		for (const outcome of outcomes) {
			const state = await getEscalationGameOutcomeState(owner(), childGame, outcome)
			const expected = parentStates[outcome]
			if (expected === undefined) throw new Error('Missing parent outcome state')
			expect(state.currentLeafCount).toBe(leafCount)
			expect(state.snapshotPeaks).toEqual(expected.currentPeaks)
			expect(state.currentPeaks).toEqual(expected.currentPeaks)
			expect(state.balanceAttoRep).toBe(expected.balanceAttoRep)
		}
		if (process.env['REPORT_BOUNDED_FORK_GAS'] === '1') console.log('Bounded central fork gas', gasMeasurements)
	})
})

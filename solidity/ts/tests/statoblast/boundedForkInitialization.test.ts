import { describe, expect, test } from 'bun:test'
import { keccak256, zeroAddress, type Hash } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { formatStorageSlot } from '../../testSupport/storage'
import { QuestionOutcome } from '../../testSupport/simulator/types/types'
import { SystemState } from '../../testSupport/simulator/types/statoblastTypes'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { deployChild, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getSecurityPoolsEscalationGame, getSystemState } from '../../testSupport/simulator/utils/contracts/securityPool'
import { initiateSecurityPoolFork } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { getEscalationGameOutcomeState } from '../../testSupport/simulator/utils/contracts/escalationGame'
import {
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory as factoryArtifact,
	statoblast_factories_EscalationGameFactory_EscalationGameFactory as escalationFactoryArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolReporterLedger_SecurityPoolReporterLedger as reporterArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed as feedArtifact,
} from '../../types/contractArtifact'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

const outcomes = [QuestionOutcome.Invalid, QuestionOutcome.Yes, QuestionOutcome.No]
const transactionGasLimit = 16_777_216n

describe('Statoblast: bounded fork initialization', () => {
	const fixture = useSecurityPoolPortfolioFixture()

	test('staged branch and reporter setup fit with 192 carry peaks and populated portfolio schedules', async () => {
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
		const ownerClient = owner()
		const portfolio = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		const settlement = { abi: settlementArtifact.abi, address: await ownerClient.readContract({ ...portfolio, functionName: 'settlement' }) }
		const book = { abi: bookArtifact.abi, address: await ownerClient.readContract({ ...settlement, functionName: 'ledger' }) }
		const bookId = await ownerClient.readContract({ ...settlement, functionName: 'bookIds', args: [base.genesisUniverse] })
		const reporters = { abi: reporterArtifact.abi, address: await ownerClient.readContract({ ...portfolio, functionName: 'reporters' }) }
		const liveReports = []
		const feeStreams = []
		const register = async (title: string, end: bigint) => {
			const data = makeQuestion(title, end)
			const id = getQuestionId(data, base.outcomes)
			await createQuestion(ownerClient, data, base.outcomes)
			await fixture.register(id)
			return id
		}
		const firstReport = fixture.secondEndTime - DAY
		for (let index = 0n; index < 12n; index++) {
			const end = firstReport + index * 3_600n
			liveReports.push({ id: await register(`Continuation report ${index}`, end), end })
			feeStreams.push(await register(`Continuation fee stream ${index}`, fixture.secondEndTime + 90n * DAY + index * DAY))
		}
		await fixture.prepare()
		for (const { id } of liveReports) await fixture.mint(unit, id)
		for (const [index, id] of feeStreams.entries()) {
			await base.mockWindow.setTime(base.questionData.endTime + BigInt(index) * 3n * DAY)
			await fixture.refreshPrice()
			await fixture.mint(unit, id)
		}
		const feeEnds = new Set()
		for (const id of feeStreams) {
			const [state] = await ownerClient.readContract({ ...book, functionName: 'scaledQuestion', args: [bookId, id] })
			expect(BigInt(state.feeEnd)).toBeGreaterThan(fixture.secondEndTime)
			feeEnds.add(state.feeEnd)
		}
		expect(feeEnds.size).toBe(feeStreams.length)
		const reporterDeadlines = new Set()
		const settlementDeadlines = new Set()
		for (const { id, end } of liveReports) {
			const pool = { abi: poolArtifact.abi, address: poolFor(id).securityPool }
			await approveToken(ownerClient, getRepTokenAddress(base.genesisUniverse), pool.address)
			await base.mockWindow.setTime(end + 1n)
			await writeContractAndWait(ownerClient, () => ownerClient.writeContract({ ...pool, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
			const [reporter] = await ownerClient.readContract({ ...reporters, functionName: 'question', args: [base.genesisUniverse, id] })
			const [claim] = await ownerClient.readContract({ ...book, functionName: 'scaledQuestion', args: [bookId, id] })
			expect(BigInt(reporter.finalAfter)).toBeGreaterThan(fixture.secondEndTime)
			expect(BigInt(claim.finalAfter)).toBeGreaterThan(fixture.secondEndTime)
			reporterDeadlines.add(reporter.finalAfter)
			settlementDeadlines.add(claim.finalAfter)
		}
		expect(reporterDeadlines.size).toBe(liveReports.length)
		expect(settlementDeadlines.size).toBe(liveReports.length)
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
		const stageCapital = { ...portfolio, functionName: 'prepareForkCapital' as const, args: [base.genesisUniverse, BigInt(QuestionOutcome.No)] as const }
		await expect(other().simulateContract(stageCapital)).rejects.toThrow('Deploy native child first')
		await checkGas(await deployChild(other(), base.genesisUniverse, BigInt(QuestionOutcome.No)), 'native REP deployment')
		const stagedCapital = (await other().simulateContract(stageCapital)).result
		const capitalStage = await writeContractAndWait(other(), () => other().writeContract({ ...stageCapital, gas: 10_000_000n }))
		expect((await other().simulateContract(stageCapital)).result).toBe(stagedCapital)
		await expect(other().simulateContract({ abi: capitalArtifact.abi, address: stagedCapital, functionName: 'depositFor', args: [other().account.address, 1n] })).rejects.toThrow('Capital universe inactive')
		await checkGas(capitalStage, 'capital ledger predeployment')
		expect(await owner().readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'capitalLedger', args: [childUniverse] })).toBe(zeroAddress)
		const custodyStage = await writeContractAndWait(other(), () => other().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'prepareBranch', args: [base.genesisUniverse, BigInt(QuestionOutcome.No)], gas: 11_000_000n }))
		await checkGas(custodyStage, 'shared branch custody preparation')
		expect(await ownerClient.readContract({ ...portfolio, functionName: 'capitalLedger', args: [childUniverse] })).toBe(stagedCapital)
		expect((await other().simulateContract(stageCapital)).result).toBe(stagedCapital)
		await checkGas(await writeContractAndWait(other(), () => other().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'startBranch', args: [base.genesisUniverse, BigInt(QuestionOutcome.No)], gas: transactionGasLimit })), 'shared branch migration')
		const factory = getInfraContractAddresses().securityPoolFactory
		await writeContractAndWait(other(), () => other().writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'preparePortfolioPriceFeed', args: [parent, childUniverse] }))
		await writeContractAndWait(other(), () => other().writeContract({ abi: factoryArtifact.abi, address: factory, functionName: 'prepareChildPoolCoordinator', args: [parent, BigInt(QuestionOutcome.No)] }))
		const childCoordinator = await owner().readContract({ abi: factoryArtifact.abi, address: factory, functionName: 'getChildPoolCoordinator', args: [parent, BigInt(QuestionOutcome.No)] })
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
		const prepareReporter = { abi: escalationFactoryArtifact.abi, address: getInfraContractAddresses().escalationGameFactory, functionName: 'prepareEscalationGame' as const, args: [child] as const }
		const dormantGame = (await other().simulateContract(prepareReporter)).result
		await checkGas(await writeContractAndWait(other(), () => other().writeContract({ ...prepareReporter, gas: 6_000_000n })), 'dormant continuation game')
		expect(await getSecurityPoolsEscalationGame(owner(), child)).toBe(zeroAddress)
		await expect(other().simulateContract({ abi: gameArtifact.abi, address: dormantGame, functionName: 'depositRepOnOutcome', args: [1, 100n * unit] })).rejects.toThrow('Game inactive')

		for (let outcome = 0; outcome < 3; outcome++) {
			await checkGas(await writeContractAndWait(other(), () => other().writeContract({ abi: forkerArtifact.abi, address: forker, functionName: 'materializePortfolioQuestion', args: [parent, childUniverse], gas: 10_000_000n })), `question carry outcome ${outcome}`)
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
		expect(childGame).toBe(dormantGame)
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

import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	Zoltar_Zoltar as zoltarArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
} from '../types/contractArtifact'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { DAY } from '../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId } from '../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress, getZoltarForkThreshold } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { manipulatePriceOracle } from '../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

describe('Shared portfolio child fee clock', () => {
	const fixture = useSecurityPoolPortfolioFixture()
	test.each([
		{ own: false, delay: 0n },
		{ own: false, delay: 10n * DAY },
		{ own: true, delay: 0n },
		{ own: true, delay: 10n * DAY },
	])('activation preserves cash through unavailable pricing and finality (own: $own, delay: $delay)', async ({ own, delay }) => {
		await fixture.prepare()
		await fixture.mint()
		const { base } = fixture
		const owner = fixture.owner()
		const portfolio = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		const parent = fixture.poolFor(base.questionId).securityPool
		const forkQuestion = { ...base.questionData, title: 'Unrelated child fee fork', endTime: (await base.mockWindow.getTime()) - 1n, startTime: 0n }
		if (own) await base.mockWindow.setTime(base.questionData.endTime + 1n)
		else await createQuestion(owner, forkQuestion, base.outcomes)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, base.genesisUniverse, own ? base.questionId : getQuestionId(forkQuestion, base.outcomes))
		const controller = await owner.readContract({ ...portfolio, functionName: 'forkController' })
		const fork = { abi: forkArtifact.abi, address: controller }
		await writeContractAndWait(owner, () => owner.writeContract({ ...fork, functionName: 'choose', args: [base.genesisUniverse, 1n] }))
		// Fund a future child report without depending on underwriter principal withdrawals.
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: tokenArtifact.abi, address: getRepTokenAddress(base.genesisUniverse), functionName: 'transfer', args: [owner.account.address, 1_000_000n * unit] }))
		const reportingRep = 1_000n * unit + 2n * (await getZoltarForkThreshold(owner, base.genesisUniverse))
		await addRepToMigrationBalance(owner, base.genesisUniverse, reportingRep)
		await splitMigrationRep(owner, base.genesisUniverse, reportingRep, [1n])
		const forkTime = (await getUniverseData(owner, base.genesisUniverse)).forkTime
		const child = getChildUniverseId(base.genesisUniverse, 1n)
		const frozenCash = await owner.readContract({ ...portfolio, functionName: 'quoteQuestionSettlement', args: [parent, 10n * unit] })
		await base.mockWindow.setTime(forkTime + 63n * DAY + delay)
		await writeContractAndWait(owner, () => owner.writeContract({ ...fork, functionName: 'startBranch', args: [base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...fork, functionName: 'finalizeBranch', args: [child] }))
		const clock = await owner.readContract({ ...fork, functionName: 'clocks', args: [child] })
		expect(clock[0]).toBe(forkTime)
		expect(clock[1]).toBe(forkTime + 63n * DAY)
		expect(await owner.readContract({ ...fork, functionName: 'portfolioTime', args: [child] })).toBe((await owner.getBlock()).timestamp - 63n * DAY)
		const engine = await owner.readContract({ ...portfolio, functionName: 'settlement' })
		expect(await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'feeTimestamp', args: [child] })).toBe(forkTime + 63n * DAY)
		const book = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await owner.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [child] })
		const feeRate = async () => (await owner.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, base.questionId] }))[0].feeRateAttoEthPerSecond
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'materializePortfolioQuestion', args: [parent, child] }))
		const poolAddress = await owner.readContract({ ...portfolio, functionName: 'getPool', args: [base.questionId, child] })
		const pool = { abi: poolArtifact.abi, address: poolAddress }
		const refresh = () => writeContractAndWait(owner, () => owner.writeContract({ ...pool, functionName: 'refreshPortfolioFees' }))
		const cash = () => owner.readContract({ ...portfolio, functionName: 'quoteQuestionSettlement', args: [poolAddress, 10n * unit] })
		await refresh()
		expect(await cash()).toBe(frozenCash)
		await base.mockWindow.advanceTime(DAY)
		await refresh()
		expect(await cash()).toBe(frozenCash)
		const oracle = await owner.readContract({ ...pool, functionName: 'openOraclePriceCoordinator' })
		await manipulatePriceOracle(owner, base.mockWindow, oracle, unit, 100n * unit)
		await refresh()
		const liveCash = await cash()
		await base.mockWindow.advanceTime(100n)
		await refresh()
		if (own) {
			expect(await cash()).toBe(frozenCash)
			await base.mockWindow.advanceTime(7n * DAY)
			await refresh()
			expect(await cash()).toBe(frozenCash)
		} else {
			expect(await cash()).toBeLessThan(liveCash)
			const capital = await owner.readContract({ ...portfolio, functionName: 'capitalLedger', args: [child] })
			expect(await owner.readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'demandAttoEth' })).toBe(await cash())
			// Reporting replaces the holding charge with the prepaid resolution premium.
			await base.mockWindow.setTime(base.questionData.endTime + 1n)
			await manipulatePriceOracle(owner, base.mockWindow, oracle, unit, 100n * unit)
			await refresh()
			expect(await feeRate()).toBeGreaterThan(0n)
			await approveToken(owner, getRepTokenAddress(child), poolAddress)
			await writeContractAndWait(owner, () => owner.writeContract({ ...pool, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
			await refresh()
			expect(await feeRate()).toBe(0n)
			const reportedCash = await cash()
			await base.mockWindow.advanceTime(100n)
			await refresh()
			expect(await cash()).toBe(reportedCash)
			const game = await owner.readContract({ ...pool, functionName: 'escalationGame' })
			const end = await owner.readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
			await base.mockWindow.setTime(end + DAY)
			await manipulatePriceOracle(owner, base.mockWindow, oracle, unit, 100n * unit)
			if (delay !== 0n) await refresh()
			expect(await feeRate()).toBe(0n)
			const nextQuestion = { ...forkQuestion, title: 'Later fork must preserve finalized child cash', endTime: end }
			await createQuestion(owner, nextQuestion, base.outcomes)
			const earliest = await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getEarliestForkTime', args: [child] })
			if (earliest > (await base.mockWindow.getTime())) await base.mockWindow.setTime(earliest)
			await forkUniverse(owner, child, getQuestionId(nextQuestion, base.outcomes))
			await refresh()
			expect(await cash()).toBe(reportedCash)
			await base.mockWindow.advanceTime(DAY)
			await refresh()
			expect(await cash()).toBe(reportedCash)
		}
	})
})

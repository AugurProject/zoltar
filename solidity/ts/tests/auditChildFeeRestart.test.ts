import { stagePortfolioForkCapital } from '../testSupport/simulator/utils/contracts/portfolioFork'
import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { parseAbi, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	Zoltar_Zoltar as zoltarArtifact,
} from '../types/contractArtifact'
import { DAY } from '../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId } from '../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../testSupport/simulator/utils/contracts/deployStatoblast'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { unit, useSecurityPoolPortfolioFixture } from './statoblast/securityPoolPortfolioFixture'

const feeStreamAbi = parseAbi(['function feeStream(address pool) view returns (uint96 rate, uint48 stop)'])

// Audit regression: a holding fee ends when reporting on its question begins. A fork child registers its
// pool before the branch's own escalation game exists, and a parent game that reached non-decision leaves the inherited question
// without a finality time, so neither existing guard stopped `feeStream`: the holding fee restarted in the
// child for a question already under reporting. The reporter ledger's recorded source game now stops it.
describe('audit: a holding fee does not restart in a fork child for a question under reporting', () => {
	const fixture = useSecurityPoolPortfolioFixture({})
	test('a registered, unmaterialized child pool of an undecided parent game has no holding fee', async () => {
		const { base } = fixture
		const owner = fixture.owner()
		const other = fixture.other()
		const portfolio = { abi: portfolioArtifact.abi, address: fixture.portfolio }
		await fixture.prepare()
		await fixture.deposit(1_000n * unit, other)
		await fixture.authorize(200n * unit, other)
		await fixture.mint(10n * unit)
		const parent = fixture.poolFor(base.questionId).securityPool
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await fixture.refreshPrice()
		// Both outcomes reach the non-decision threshold: the game has no winner, so no finality time is scheduled.
		const threshold = await owner.readContract({ abi: zoltarArtifact.abi, address: getZoltarAddress(), functionName: 'getNonDecisionThresholdAttoRep', args: [base.genesisUniverse] })
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), parent)
		for (const outcome of [1, 2]) await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: parent, functionName: 'depositWalletRepToEscalationGame', args: [outcome, threshold] }))
		const parentGame = await owner.readContract({ abi: poolArtifact.abi, address: parent, functionName: 'escalationGame' })
		expect(await owner.readContract({ abi: gameArtifact.abi, address: parentGame, functionName: 'hasReachedNonDecision' })).toBe(true)

		const forkQuestion = { ...base.questionData, title: 'Unrelated fork during undecided reporting' }
		await createQuestion(owner, forkQuestion, base.outcomes)
		await approveToken(owner, getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner, base.genesisUniverse, getQuestionId(forkQuestion, base.outcomes))
		const coordinator = { abi: coordinatorArtifact.abi, address: await owner.readContract({ ...portfolio, functionName: 'forkController' }) }
		for (const client of [owner, other]) {
			await stagePortfolioForkCapital(client, coordinator.address, base.genesisUniverse, 1n)
			await writeContractAndWait(client, () => client.writeContract({ ...coordinator, functionName: 'choose', args: [base.genesisUniverse, 1n] }))
		}
		const forkTime = (await getUniverseData(owner, base.genesisUniverse)).forkTime
		await base.mockWindow.setTime(forkTime + 63n * DAY)
		const child = getChildUniverseId(base.genesisUniverse, 1)
		await stagePortfolioForkCapital(owner, coordinator.address, base.genesisUniverse, 1n)
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'startBranch', args: [base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner, () => owner.writeContract({ ...coordinator, functionName: 'finalizeBranch', args: [child] }))
		// Register the child pool without materializing the branch's own game.
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'preparePortfolioQuestion', args: [parent, child] }))
		const childPool = await owner.readContract({ ...portfolio, functionName: 'getPool', args: [base.questionId, child] })
		expect(childPool).not.toBe(zeroAddress)

		// Neither earlier guard applies: the child pool has no game, and the inherited question has no finality time.
		expect(await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })).toBe(zeroAddress)
		const engine = { abi: settlementArtifact.abi, address: await owner.readContract({ ...portfolio, functionName: 'settlement' }) }
		const book = { abi: bookArtifact.abi, address: await owner.readContract({ ...engine, functionName: 'ledger' }) }
		const bookId = await owner.readContract({ ...engine, functionName: 'bookIds', args: [child] })
		const [question] = await owner.readContract({ ...book, functionName: 'question', args: [bookId, base.questionId] })
		expect(question.finalAfter).toBe(0n)
		expect(question.feePrincipalAttoEth).toBeGreaterThan(0n)
		expect(await owner.readContract({ ...portfolio, functionName: 'annualFeeBps' })).toBeGreaterThan(0n)

		// Reporting began in the parent, so the child charges no holding fee.
		expect(await owner.readContract({ ...portfolio, functionName: 'sourceGame', args: [child, base.questionId] })).toBe(parentGame)
		const quoteHelper = await owner.readContract({ ...portfolio, functionName: 'quoteHelper' })
		expect(await owner.readContract({ abi: feeStreamAbi, address: quoteHelper, functionName: 'feeStream', args: [childPool] })).toEqual([0n, 0n])
	})
})

import { describe, expect, test } from 'bun:test'
import {
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
} from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { balanceOfShares } from '../../testSupport/simulator/utils/contracts/statoblast'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: native finalized portfolio redemptions', () => {
	const fixture = useSecurityPoolPortfolioFixture({ reportingFeeAttoEth: unit / 100n })
	const pool = () => ({ abi: poolArtifact.abi, address: fixture.poolFor(fixture.base.questionId).securityPool })
	const portfolio = () => ({ abi: portfolioArtifact.abi, address: fixture.portfolio })
	const shares = () => balanceOfShares(fixture.other(), fixture.poolFor(fixture.base.questionId).shareToken, fixture.base.genesisUniverse, fixture.other().account.address)
	const refresh = () => writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'refreshPortfolioFees' }))
	const settlementState = async () => {
		const client = fixture.owner()
		const engine = await client.readContract({ ...portfolio(), functionName: 'settlement' })
		const book = await client.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await client.readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [fixture.base.genesisUniverse] })
		const [question, frozenBookId] = await client.readContract({ abi: bookArtifact.abi, address: book, functionName: 'question', args: [bookId, fixture.base.questionId] })
		return { engine, book, bookId, question, frozenBookId }
	}
	const prepareReportedQuestion = async () => {
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.mint(20n * unit, fixture.secondQuestionId)
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), pool().address)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ ...pool(), functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const game = await fixture.owner().readContract({ ...pool(), functionName: 'escalationGame' })
		return fixture.owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
	}
	const secondCash = () => fixture.owner().readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [fixture.poolFor(fixture.secondQuestionId).securityPool, 20n * unit] })
	const questionCash = async (questionId: bigint) => {
		const state = await settlementState()
		const [question] = await fixture.owner().readContract({ abi: bookArtifact.abi, address: state.book, functionName: 'question', args: [state.bookId, questionId] })
		return fixture.owner().readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [fixture.poolFor(questionId).securityPool, question.outcomeSupplyAttoShares] })
	}

	test.each([false, true])('a question finalized before another question forks cannot detach recovery rights (checkpointed: %s)', async checkpointed => {
		const deadline = await prepareReportedQuestion()
		await fixture.base.mockWindow.setTime(deadline + 1n)
		if (checkpointed) await refresh()
		expect((await settlementState()).frozenBookId !== 0n).toBe(checkpointed)
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await fixture.base.mockWindow.setTime(fixture.secondEndTime + 1n)
		await forkUniverse(fixture.owner(), fixture.base.genesisUniverse, fixture.secondQuestionId)
		const target = { abi: shareArtifact.abi, address: fixture.poolFor(fixture.base.questionId).shareToken }
		await expect(writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...target, functionName: 'transferPortfolioRecoveryRights', args: [fixture.base.genesisUniverse, fixture.owner().account.address, [0n, 1n, 0n]] }))).rejects.toThrow('No live source recovery right')
		expect(await fixture.other().readContract({ ...target, functionName: 'balanceOfPortfolioRecoveryRights', args: [fixture.base.genesisUniverse, fixture.other().account.address] })).toEqual([0n, 0n, 0n])
		const before = await settlementState()
		const cash = await fixture.owner().getBalance({ address: before.engine })
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'redeemShares' }))
		expect((await shares())[1]).toBe(0n)
		expect(await fixture.owner().getBalance({ address: before.engine })).toBeLessThan(cash)
	})

	test('winning shares redeem after the strict finality boundary without a prior question checkpoint', async () => {
		const deadline = await prepareReportedQuestion()
		await fixture.base.mockWindow.setTime(deadline)
		await expect(fixture.other().simulateContract({ ...pool(), functionName: 'redeemShares' })).rejects.toThrow('Question not final')
		await fixture.base.mockWindow.setTime(deadline + 1n)
		const beforeShares = await shares()
		const expectedCash = await fixture.other().readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [pool().address, beforeShares[1]] })
		const otherCash = await secondCash()
		const balance = await fixture.other().getBalance({ address: fixture.other().account.address })
		const hash = await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'redeemShares' }))
		const receipt = await fixture.other().waitForTransactionReceipt({ hash })
		if (receipt.effectiveGasPrice === undefined) throw new Error('Redemption receipt must include its effective gas price')
		expect(await fixture.other().getBalance({ address: fixture.other().account.address })).toBe(balance + expectedCash - receipt.gasUsed * receipt.effectiveGasPrice)
		expect(await shares()).toEqual([beforeShares[0], 0n, beforeShares[2]])
		const state = await settlementState()
		expect(state.frozenBookId).not.toBe(0n)
		expect(state.question.outcomeSupplyAttoShares).toBe(state.question.rewardShares)
		expect(state.question.rewardShares).toBeGreaterThan(0n)
		expect(state.question.feeRateAttoEthPerSecond).toBe(0n)
		expect(await secondCash()).toBe(otherCash)
		expect(await fixture.owner().getBalance({ address: state.engine })).toBe((await questionCash(fixture.base.questionId)) + (await questionCash(fixture.secondQuestionId)))
		await refresh()
		await refresh()
		expect(await secondCash()).toBe(otherCash)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...portfolio(), functionName: 'claimQuestionReportingReward', args: [pool().address] }))
		expect((await settlementState()).question.outcomeSupplyAttoShares).toBe(0n)
		expect(await fixture.owner().getBalance({ address: state.engine })).toBe(await questionCash(fixture.secondQuestionId))
	})

	test('partial complete-set return and the remaining winner preserve the frozen cash rate and other questions', async () => {
		const deadline = await prepareReportedQuestion()
		await fixture.base.mockWindow.setTime(deadline + 1n)
		await refresh()
		const before = await settlementState()
		const beforeShares = await shares()
		const otherCash = await secondCash()
		const amount = beforeShares[0] / 3n
		const expectedCash = await fixture.other().readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [pool().address, amount] })
		const balance = await fixture.owner().getBalance({ address: before.engine })
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'redeemCompleteSet', args: [amount] }))
		expect(await shares()).toEqual([beforeShares[0] - amount, beforeShares[1] - amount, beforeShares[2] - amount])
		expect(await fixture.owner().getBalance({ address: before.engine })).toBe(balance - expectedCash)
		const after = await settlementState()
		expect(after.frozenBookId).toBe(before.frozenBookId)
		expect(after.question.feeRateAttoEthPerSecond).toBe(0n)
		expect(after.question.outcomeSupplyAttoShares).toBe(before.question.outcomeSupplyAttoShares - amount)
		await fixture.base.mockWindow.advanceTime(86_400n)
		await refresh()
		expect((await settlementState()).question).toEqual(after.question)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'redeemShares' }))
		expect(await secondCash()).toBe(otherCash)
		expect(await fixture.owner().getBalance({ address: before.engine })).toBe((await questionCash(fixture.base.questionId)) + (await questionCash(fixture.secondQuestionId)))
	})

	test('a later fork leaves final cash at its source and child refresh cannot duplicate the claim', async () => {
		await prepareReportedQuestion()
		const owner = fixture.owner()
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await fixture.base.mockWindow.setTime(fixture.secondEndTime + 1n)
		await forkUniverse(owner, fixture.base.genesisUniverse, fixture.secondQuestionId)
		const controller = await owner.readContract({ ...portfolio(), functionName: 'forkController' })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: controller, functionName: 'choose', args: [fixture.base.genesisUniverse, 1n] }))
		const forkTime = (await getUniverseData(owner, fixture.base.genesisUniverse)).forkTime
		await fixture.base.mockWindow.setTime(forkTime + 63n * DAY)
		const child = getChildUniverseId(fixture.base.genesisUniverse, 1)
		await writeContractAndWait(owner, () => owner.writeContract({ abi: coordinatorArtifact.abi, address: controller, functionName: 'finalizeBranch', args: [child] }))
		await writeContractAndWait(owner, () => owner.writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'preparePortfolioQuestion', args: [pool().address, child] }))
		const childPool = await owner.readContract({ ...portfolio(), functionName: 'getPool', args: [fixture.base.questionId, child] })
		await writeContractAndWait(owner, () => owner.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'refreshPortfolioFees' }))
		expect(await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'shareTokenSupplyAttoShares' })).toBe(0n)
		expect(await owner.readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'settlementCollateralAttoEth' })).toBe(0n)
		await refresh()
		const state = await settlementState()
		const beforeShares = await shares()
		const expectedCash = await owner.readContract({ ...portfolio(), functionName: 'quoteQuestionSettlement', args: [pool().address, beforeShares[1]] })
		expect(expectedCash).toBeGreaterThan(0n)
		const balance = await owner.getBalance({ address: state.engine })
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ ...pool(), functionName: 'redeemShares' }))
		expect(await owner.getBalance({ address: state.engine })).toBe(balance - expectedCash)
		expect((await shares())[1]).toBe(0n)
		await refresh()
		const final = await settlementState()
		expect(final.question.outcomeSupplyAttoShares).toBe(final.question.rewardShares)
	})
})

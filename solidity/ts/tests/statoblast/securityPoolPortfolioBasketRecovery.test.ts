import { describe, expect, test } from 'bun:test'
import { useSecurityPoolPortfolioFixture, unit } from './securityPoolPortfolioFixture'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as coordinatorArtifact,
	statoblast_SecurityPoolCapitalLedger_SecurityPoolCapitalLedger as capitalArtifact,
	statoblast_SecurityPoolPortfolioSettlement_SecurityPoolPortfolioSettlement as settlementArtifact,
	statoblast_SecurityPoolSettlementBook_SecurityPoolSettlementBook as bookArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_tokens_ShareToken_ShareToken as sharesArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'

describe('Statoblast: native fork claim basket recovery', () => {
	const fixture = useSecurityPoolPortfolioFixture()

	test.each([{ chosen: true }, { chosen: false }])('winning claims collect actual ETH and forfeited REP without a child oracle or auction: $chosen', async ({ chosen }) => {
		const { owner, other, base, portfolio } = fixture
		await fixture.prepare()
		await fixture.deposit(1_000n * unit, other())
		await fixture.authorize(200n * unit, other())
		await fixture.mint()
		const parentPool = fixture.poolFor(base.questionId).securityPool
		const shares = await owner().readContract({ abi: poolArtifact.abi, address: parentPool, functionName: 'shareToken' })
		const balances = await other().readContract({ abi: sharesArtifact.abi, address: shares, functionName: 'balanceOfShares', args: [base.genesisUniverse, other().account.address] })
		await approveToken(owner(), getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await forkUniverse(owner(), base.genesisUniverse, base.questionId)
		const coordinator = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'forkController' })
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'choose', args: [base.genesisUniverse, chosen ? 1n : 2n] }))
		await writeContractAndWait(other(), () => other().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'choose', args: [base.genesisUniverse, 2n] }))
		const forkTime = (await getUniverseData(owner(), base.genesisUniverse)).forkTime
		await base.mockWindow.setTime(forkTime + 63n * DAY)
		const child = getChildUniverseId(base.genesisUniverse, 1)
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'startBranch', args: [base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: coordinatorArtifact.abi, address: coordinator, functionName: 'finalizeBranch', args: [child] }))
		await writeContractAndWait(other(), () => other().writeContract({ abi: sharesArtifact.abi, address: shares, functionName: 'migrate', args: [base.genesisUniverse * 256n + 1n, [1n]] }))
		const childPool = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'getPool', args: [base.questionId, child] })
		const capital = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'capitalLedger', args: [child] })
		const engine = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'settlement' })
		const book = await owner().readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'ledger' })
		const bookId = await owner().readContract({ abi: settlementArtifact.abi, address: engine, functionName: 'bookIds', args: [child] })
		const basketRep = await owner().readContract({ abi: bookArtifact.abi, address: book, functionName: 'recoveryRep', args: [bookId] })
		expect(basketRep).toBe(chosen ? 1_000n * unit : 2_000n * unit)
		expect(await owner().readContract({ abi: capitalArtifact.abi, address: capital, functionName: 'priceValidUntil' })).toBe(0n)
		const expectedRep = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'quoteQuestionRecoveryRep', args: [childPool, balances[1]] })
		const expectedCash = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'quoteQuestionSettlement', args: [childPool, balances[1]] })
		expect(await owner().readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'attoSharesToAttoRep', args: [balances[1]] })).toBe(expectedRep)
		expect(expectedRep).toBeGreaterThan(0n)
		if (!chosen) expect(expectedCash).toBe(0n)
		const token = await owner().readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'repToken' })
		const repBefore = await owner().readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [other().account.address] })
		const cashBefore = await owner().getBalance({ address: engine })
		await base.mockWindow.setTime(forkTime + 66n * DAY + 1n)
		await writeContractAndWait(other(), () => other().writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'redeemShares' }))
		expect(await owner().readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [other().account.address] })).toBe(repBefore + expectedRep)
		expect(await owner().getBalance({ address: engine })).toBe(cashBefore - expectedCash)
		expect((await other().readContract({ abi: sharesArtifact.abi, address: shares, functionName: 'balanceOfShares', args: [child, other().account.address] }))[1]).toBe(0n)
		await writeContractAndWait(other(), () => other().writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'redeemShares' }))
		expect(await owner().readContract({ abi: tokenArtifact.abi, address: token, functionName: 'balanceOf', args: [other().account.address] })).toBe(repBefore + expectedRep)
	})
})

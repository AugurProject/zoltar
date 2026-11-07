import { describe, expect, test } from 'bun:test'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import {
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinator as forkArtifact,
	statoblast_SecurityPoolForker_SecurityPoolForker as forkerArtifact,
	statoblast_SecurityPool_SecurityPool as poolArtifact,
	statoblast_EscalationGame_EscalationGame as gameArtifact,
	statoblast_tokens_ShareToken_ShareToken as shareArtifact,
	ReputationToken_ReputationToken as tokenArtifact,
} from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { approveToken, getChildUniverseId } from '../../testSupport/simulator/utils/utilities'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { addRepToMigrationBalance, splitMigrationRep, forkUniverse, getRepTokenAddress, getUniverseData, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { manipulatePriceOracle } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { unit, useSecurityPoolPortfolioFixture } from './securityPoolPortfolioFixture'

describe('Statoblast: lazy child outcome supply', () => {
	const fixture = useSecurityPoolPortfolioFixture({ annualFeeBps: 0n })
	test.each([
		{ name: 'no materialized claims', outcomes: [], chosen: true },
		{ name: 'balanced partial claims', outcomes: [0, 1, 2], chosen: true },
		{ name: 'uneven partial claims', outcomes: [1], chosen: true },
		{ name: 'zero-cash recovery', outcomes: [0, 1, 2], chosen: false },
	])('new child purchases reserve all old claims: $name', async ({ outcomes, chosen }) => {
		const { base, owner, other, portfolio } = fixture
		await fixture.prepare()
		await fixture.mint(10n * unit)
		await fixture.mint(10n * unit, base.questionId, { sender: owner() })
		const parent = fixture.poolFor(base.questionId)
		const settlement = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'settlement' })
		await base.mockWindow.setBalance(parent.securityPool, 7n * unit)
		await base.mockWindow.setBalance(settlement, (await owner().getBalance({ address: settlement })) + 11n * unit)
		const forkQuestion = { ...base.questionData, title: 'Early unrelated supply fork', startTime: 0n, endTime: (await base.mockWindow.getTime()) - 1n }
		await createQuestion(owner(), forkQuestion, base.outcomes)
		await approveToken(owner(), getRepTokenAddress(base.genesisUniverse), getZoltarAddress())
		await forkUniverse(owner(), base.genesisUniverse, getQuestionId(forkQuestion, base.outcomes))
		expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'availableMintCapacity', args: [base.genesisUniverse] })).toBe(0n)
		await expect(fixture.mint(unit)).rejects.toThrow()
		expect(await owner().readContract({ abi: poolArtifact.abi, address: parent.securityPool, functionName: 'shareTokenSupplyAttoShares' })).toBe(20n * unit)
		const controller = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'forkController' })
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: forkArtifact.abi, address: controller, functionName: 'choose', args: [base.genesisUniverse, chosen ? 1n : 2n] }))
		await addRepToMigrationBalance(owner(), base.genesisUniverse, 1_000n * unit)
		await splitMigrationRep(owner(), base.genesisUniverse, 1_000n * unit, [1n])
		const forkTime = (await getUniverseData(owner(), base.genesisUniverse)).forkTime
		await base.mockWindow.setTime(forkTime + 63n * DAY)
		const child = getChildUniverseId(base.genesisUniverse, 1)
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: forkArtifact.abi, address: controller, functionName: 'startBranch', args: [base.genesisUniverse, 1n] }))
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: forkArtifact.abi, address: controller, functionName: 'finalizeBranch', args: [child] }))
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: forkerArtifact.abi, address: getInfraContractAddresses().securityPoolForker, functionName: 'materializePortfolioQuestion', args: [parent.securityPool, child] }))
		const childPool = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'getPool', args: [base.questionId, child] })
		await base.mockWindow.setBalance(childPool, 13n * unit)
		for (const outcome of outcomes) await writeContractAndWait(other(), () => other().writeContract({ abi: shareArtifact.abi, address: parent.shareToken, functionName: 'migrate', args: [base.genesisUniverse * 256n + BigInt(outcome), [1n]] }))
		const materialized = () => Promise.all([0, 1, 2].map(outcome => owner().readContract({ abi: shareArtifact.abi, address: parent.shareToken, functionName: 'totalSupplyForOutcome', args: [child, outcome] })))
		expect(await materialized()).toEqual([0, 1, 2].map(outcome => (outcomes.includes(outcome) ? 10n * unit : 0n)))
		expect(await owner().readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'shareTokenSupplyAttoShares' })).toBe(20n * unit)
		if (!chosen) {
			expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'availableMintCapacity', args: [child] })).toBe(0n)
			await expect(other().writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'createCompleteSet', args: [child, base.questionId, unit, other().account.address, 0n], value: 2n * unit })).rejects.toThrow()
			expect(await owner().readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'shareTokenSupplyAttoShares' })).toBe(20n * unit)
			expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'quoteQuestionSettlement', args: [childPool, 10n * unit] })).toBe(0n)
			const rep = getRepTokenAddress(child)
			const balance = await other().readContract({ abi: tokenArtifact.abi, address: rep, functionName: 'balanceOf', args: [other().account.address] })
			await writeContractAndWait(other(), () => other().writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'redeemCompleteSet', args: [10n * unit] }))
			expect(await other().readContract({ abi: tokenArtifact.abi, address: rep, functionName: 'balanceOf', args: [other().account.address] })).toBe(balance + 500n * unit)
			return
		}
		const oracle = await owner().readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'openOraclePriceCoordinator' })
		await manipulatePriceOracle(owner(), base.mockWindow, oracle, unit, 100n * unit)
		const newcomer = createWriteClient(base.mockWindow, TEST_ADDRESSES[2])
		const [fee] = await newcomer.readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'purchaseQuote', args: [child, base.questionId, unit] })
		await writeContractAndWait(newcomer, () => newcomer.writeContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'createCompleteSet', args: [child, base.questionId, unit, newcomer.account.address, unit], value: unit + fee }))
		expect(await materialized()).toEqual([0, 1, 2].map(outcome => (outcomes.includes(outcome) ? 10n * unit : 0n) + unit))
		expect(await owner().readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'shareTokenSupplyAttoShares' })).toBe(21n * unit)
		const cash = await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'quoteQuestionSettlement', args: [childPool, unit] })
		expect(cash).toBe(unit)
		const cashBefore = await owner().getBalance({ address: settlement })
		await writeContractAndWait(newcomer, () => newcomer.writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'redeemCompleteSet', args: [unit] }))
		expect(await owner().getBalance({ address: settlement })).toBe(cashBefore - unit)
		// Settle while one original holder still has no materialized child shares.
		if (!outcomes.includes(1)) await writeContractAndWait(other(), () => other().writeContract({ abi: shareArtifact.abi, address: parent.shareToken, functionName: 'migrate', args: [base.genesisUniverse * 256n + 1n, [1n]] }))
		await base.mockWindow.setTime(base.questionData.endTime + 1n)
		await approveToken(owner(), getRepTokenAddress(child), childPool)
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'depositWalletRepToEscalationGame', args: [1, 100n * unit] }))
		const game = await owner().readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'escalationGame' })
		const end = await owner().readContract({ abi: gameArtifact.abi, address: game, functionName: 'getEscalationGameEndDate' })
		await base.mockWindow.setTime(end + 1n)
		await writeContractAndWait(other(), () => other().writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'redeemShares' }))
		expect(await owner().readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'shareTokenSupplyAttoShares' })).toBe(10n * unit)
		for (const outcome of [0, 1, 2]) await writeContractAndWait(owner(), () => owner().writeContract({ abi: shareArtifact.abi, address: parent.shareToken, functionName: 'migrate', args: [base.genesisUniverse * 256n + BigInt(outcome), [1n]] }))
		expect(await owner().readContract({ abi: portfolioArtifact.abi, address: portfolio, functionName: 'quoteQuestionSettlement', args: [childPool, 10n * unit] })).toBe(10n * unit)
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'redeemShares' }))
		expect(await owner().readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'shareTokenSupplyAttoShares' })).toBe(0n)
		expect(await owner().readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'attoSharesToAttoEth', args: [10n * unit] })).toBe(0n)
		expect(await owner().readContract({ abi: poolArtifact.abi, address: childPool, functionName: 'attoSharesToAttoRep', args: [10n * unit] })).toBe(0n)
		await writeContractAndWait(owner(), () => owner().writeContract({ abi: poolArtifact.abi, address: childPool, functionName: 'redeemShares' }))
		expect(await owner().getBalance({ address: parent.securityPool })).toBe(7n * unit)
		expect(await owner().getBalance({ address: childPool })).toBe(13n * unit)
		expect(await owner().getBalance({ address: settlement })).toBe(11n * unit)
	})
})

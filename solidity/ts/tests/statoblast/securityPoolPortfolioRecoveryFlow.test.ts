import { describe, expect, test } from 'bun:test'
import { parseAbi } from '@zoltar/core-shared/evm/ethereum'
import { getQuestionId } from '@zoltar/zoltar-shared/questions/questionId'
import { statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio as portfolioArtifact, statoblast_SecurityPoolPortfolioRecovery_SecurityPoolPortfolioRecovery as recoveryArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { DAY } from '../../testSupport/simulator/utils/constants'
import { createQuestion, makeQuestion } from '../../testSupport/simulator/utils/contracts/zoltarQuestionData'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { useAggregatePortfolioFixture } from './securityPoolPortfolioAggregateFixture'
import { unit } from './securityPoolPortfolioFixture'

describe('Statoblast: shared recovery avoids owner-by-question claim multiplication', () => {
	const { fixture, deposit, shares, withdraw, mint, custody, rebalance } = useAggregatePortfolioFixture()

	test('an owner recovers and collects selected allocations without a separate processor', async () => {
		await deposit()
		await deposit(5_000n * unit, fixture.other())
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		await mint(100n * unit, fixture.secondQuestionId)
		const firstPool = fixture.poolFor(fixture.base.questionId).securityPool
		const secondPool = fixture.poolFor(fixture.secondQuestionId).securityPool
		const expected = ((await fixture.repClaim(firstPool, await custody())) + (await fixture.repClaim(secondPool, await custody(2n)))) / 2n
		await redeemCompleteSet(fixture.other(), firstPool, 100n * unit)
		await redeemCompleteSet(fixture.other(), secondPool, 100n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		const owner = fixture.owner()
		const token = getRepTokenAddress(fixture.base.genesisUniverse)
		const before = await getERC20Balance(owner, token, owner.account.address)
		const claimAbi = parseAbi(['function claimRecovered(uint256[] intervalIds,uint256[] positionIds)'])
		await writeContractAndWait(owner, () => owner.writeContract({ abi: claimAbi, address: fixture.portfolio, functionName: 'claimRecovered', args: [[0n], [1n, 2n]] }))
		expect((await getERC20Balance(owner, token, owner.account.address)) - before).toBe(expected)
		const ledger = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'recoveryLedger' })
		expect((await owner.readContract({ abi: recoveryArtifact.abi, address: ledger, functionName: 'previewClaim', args: [fixture.other().account.address, [0n]] }))[0]).toBe(expected)
		const beforeOther = await getERC20Balance(owner, token, fixture.other().account.address)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: claimAbi, address: fixture.portfolio, functionName: 'claimRecovered', args: [[0n], []] }))
		expect((await getERC20Balance(owner, token, fixture.other().account.address)) - beforeOther).toBe(expected)
	})

	test('one owner collection recovers two questions after another depositor churns ownership', async () => {
		await deposit()
		await deposit(5_000n * unit, fixture.other())
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		await mint(100n * unit, fixture.secondQuestionId)
		const firstPool = fixture.poolFor(fixture.base.questionId).securityPool
		const secondPool = fixture.poolFor(fixture.secondQuestionId).securityPool
		const expected = ((await fixture.repClaim(firstPool, await custody())) + (await fixture.repClaim(secondPool, await custody(2n)))) / 2n
		const beforeShares = await shares(fixture.other().account.address)
		await deposit(1n, fixture.other())
		await withdraw((await shares(fixture.other().account.address)) - beforeShares, fixture.other())
		await redeemCompleteSet(fixture.other(), firstPool, 100n * unit)
		await redeemCompleteSet(fixture.other(), secondPool, 100n * unit)
		await fixture.refreshPrice(fixture.base.questionId)
		await rebalance()
		await rebalance(2n)
		const token = getRepTokenAddress(fixture.base.genesisUniverse)
		const before = await getERC20Balance(fixture.owner(), token, fixture.owner().account.address)
		await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'claimRecovered', args: [[0n], []] }))
		expect((await getERC20Balance(fixture.owner(), token, fixture.owner().account.address)) - before).toBe(expected)
	})

	test('twenty-four funded questions and foreign ownership changes leave one victim collection interval', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		const amount = 1_000_000_000n
		let expected = 0n
		for (let index = 0; index < 24; index++) {
			const question = makeQuestion(`Shared recovery workload ${index}`, fixture.base.questionData.endTime + DAY)
			const questionId = getQuestionId(question, fixture.base.outcomes)
			await createQuestion(fixture.other(), question, fixture.base.outcomes)
			await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'addQuestion', args: [questionId] }))
			await mint(amount, questionId)
			const pool = fixture.poolFor(questionId).securityPool
			const positionId = BigInt(index + 1)
			expected += await fixture.repClaim(pool, await custody(positionId))
			await deposit(1n, fixture.other())
			await withdraw(await shares(fixture.other().account.address), fixture.other())
			await redeemCompleteSet(fixture.other(), pool, amount)
			await rebalance(positionId)
		}
		const owner = fixture.owner()
		const ledger = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'recoveryLedger' })
		expect(await owner.readContract({ abi: recoveryArtifact.abi, address: ledger, functionName: 'getOwnerIntervalCount', args: [owner.account.address] })).toBe(1n)
		expect(await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'recoveredRepAttoRep' })).toBe(expected)
		const token = getRepTokenAddress(fixture.base.genesisUniverse)
		const before = await getERC20Balance(owner, token, owner.account.address)
		const hash = await writeContractAndWait(owner, () => owner.writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'claimRecovered', args: [[0n], []] }))
		expect((await getERC20Balance(owner, token, owner.account.address)) - before).toBe(expected)
		const receipt = await owner.waitForTransactionReceipt({ hash })
		expect(receipt.gasUsed).toBeLessThan(500_000n)
		await expect(writeContractAndWait(owner, () => owner.writeContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'claimRecovered', args: [[0n], []] }))).rejects.toThrow('No recovered proceeds')
		const reward = await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'processingRewards', args: [fixture.other().account.address] })
		expect(reward).toBe((24n * unit) / 4_000n)
		await rebalance(1n)
		expect(await owner.readContract({ abi: portfolioArtifact.abi, address: fixture.portfolio, functionName: 'processingRewards', args: [fixture.other().account.address] })).toBe(reward)
	})
})

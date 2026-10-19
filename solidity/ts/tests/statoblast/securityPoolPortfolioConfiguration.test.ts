import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPoolPortfolioRecovery_SecurityPoolPortfolioRecovery as recoveryArtifact, statoblast_SecurityPoolPortfolioQuote_SecurityPoolPortfolioQuote as quoteArtifact } from '../../types/contractArtifact'
import { writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { initiateSecurityPoolFork } from '../../testSupport/simulator/utils/contracts/securityPoolForker'
import { redeemCompleteSet, setUnderwritingLimit } from '../../testSupport/simulator/utils/contracts/securityPool'
import { forkUniverse, getRepTokenAddress, getZoltarAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { aggregatePortfolioAbi, useAggregatePortfolioFixture } from './securityPoolPortfolioAggregateFixture'
import { unit } from './securityPoolPortfolioFixture'

describe('Statoblast: configured reserve risk and purchase fees', () => {
	const economics = { targetHealthFactorBps: 15_000n, purchaseFeeBps: 250n, minimumPurchaseFeeAttoEth: unit / 100n, completionRewardAttoEth: unit / 2_000n }
	const { fixture, deposit, quote, mint, assets, custody, fees } = useAggregatePortfolioFixture(economics)

	test('creator health and purchase fee parameters govern both backing and capacity reuse', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		const [backing, fee] = await quote()
		expect(backing).toBe(300n * unit)
		expect(fee).toBe((15n * unit) / 2n)
		await mint(100n * unit, fixture.base.questionId, fee)
		expect(await assets()).toBe(4_700n * unit)
		expect(await fixture.repClaim(fixture.base.securityPoolAddresses.securityPool, await custody())).toBe(backing)
		expect(await fees()).toBe(fee - economics.completionRewardAttoEth)
		await setUnderwritingLimit(fixture.owner(), fixture.base.securityPoolAddresses.securityPool, 1_000n * unit)
		const [reusedBacking, reusedFee] = await quote()
		expect(reusedBacking).toBe(0n)
		expect(reusedFee).toBe(fee)
		const helper = await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'quoteHelper' })
		expect(await fixture.owner().readContract({ abi: quoteArtifact.abi, address: helper, functionName: 'targetHealthFactorBps' })).toBe(economics.targetHealthFactorBps)
	})
})

describe('Statoblast: configured minimum purchase fee', () => {
	const configuredMinimum = unit / 50n
	const { fixture, deposit, quote, mint } = useAggregatePortfolioFixture({ purchaseFeeBps: 0n, minimumPurchaseFeeAttoEth: configuredMinimum })
	test('the creator-selected ETH minimum applies on every purchase including capacity reuse', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		expect((await quote(1n))[1]).toBe(configuredMinimum)
		expect((await quote(100n * unit))[1]).toBe(configuredMinimum)
		await mint(100n * unit, fixture.base.questionId, configuredMinimum)
		await setUnderwritingLimit(fixture.owner(), fixture.base.securityPoolAddresses.securityPool, 1_000n * unit)
		const [depositNeeded, fee] = await quote(1n)
		expect(depositNeeded).toBe(0n)
		expect(fee).toBe(configuredMinimum)
	})
})

describe('Statoblast: explicitly configured zero upfront fees', () => {
	const { fixture, deposit, quote, mint, fees } = useAggregatePortfolioFixture({ minimumPurchaseFeeAttoEth: 0n, purchaseFeeBps: 0n, completionRewardAttoEth: 0n })
	test('zero fee and reward policy purchases and completes without an unfunded bounty', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		expect((await quote())[1]).toBe(0n)
		await mint(100n * unit, fixture.base.questionId, 0n)
		expect(await fees()).toBe(0n)
		await redeemCompleteSet(fixture.other(), fixture.base.securityPoolAddresses.securityPool, 100n * unit)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recyclePosition', args: [1n] }))
		expect(await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'processingRewards', args: [fixture.other().account.address] })).toBe(0n)
	})
})

describe('Statoblast: ownership changes fund shared processing without charging full exits', () => {
	const changeFee = unit / 1_000n
	const reward = unit / 4_000n
	const { fixture, deposit, mint, shares, withdraw } = useAggregatePortfolioFixture({ ownershipChangeFeeAttoEth: changeFee })
	const pendingFee = () => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'quoteOwnershipChangeFee' })
	const budget = () => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'maintenanceBudgetAttoEth' })
	const rawDeposit = async (amount: bigint, value: bigint, owner = fixture.other()) => {
		await approveToken(owner, getRepTokenAddress(fixture.base.genesisUniverse), fixture.portfolio)
		return writeContractAndWait(owner, () => owner.writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'deposit', args: [amount, 1n], value }))
	}

	test('fees apply only with unfinished allocations, refund budget surplus, and require real completion to pay out', async () => {
		expect(await pendingFee()).toBe(0n)
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		expect(await pendingFee()).toBe(changeFee)
		await expect(rawDeposit(1n, 0n)).rejects.toThrow('Ownership change fee not funded')
		const beforeEth = await fixture.other().getBalance({ address: fixture.other().account.address })
		const hash = await rawDeposit(100n, 2n * changeFee)
		const receipt = await fixture.other().waitForTransactionReceipt({ hash })
		if (receipt.effectiveGasPrice === undefined) throw new Error('Missing effective gas price')
		expect(beforeEth - (await fixture.other().getBalance({ address: fixture.other().account.address }))).toBe(changeFee + receipt.gasUsed * receipt.effectiveGasPrice)
		expect(await budget()).toBe(changeFee)
		const ownerShares = await shares(fixture.other().account.address)
		await expect(withdraw(ownerShares / 2n, fixture.other())).rejects.toThrow('Ownership change fee not funded')
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'withdraw', args: [ownerShares / 2n, 0n], value: changeFee }))
		await withdraw(await shares(fixture.other().account.address), fixture.other())
		expect(await budget()).toBe(2n * changeFee)
		await redeemCompleteSet(fixture.other(), fixture.base.securityPoolAddresses.securityPool, 100n * unit)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recyclePosition', args: [1n] }))
		expect(await budget()).toBe(2n * changeFee - reward)
		expect(await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'processingRewards', args: [fixture.other().account.address] })).toBe(2n * reward)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recyclePosition', args: [1n] }))
		expect(await budget()).toBe(2n * changeFee - reward)
		expect(await pendingFee()).toBe(0n)
		const ledger = await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recoveryLedger' })
		expect(await fixture.owner().readContract({ abi: recoveryArtifact.abi, address: ledger, functionName: 'unfinishedPositionCount' })).toBe(0n)
	})

	test('positions created after an ownership fee cannot farm the earlier maintenance budget', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		await rawDeposit(1n, changeFee)
		await withdraw(await shares(fixture.other().account.address), fixture.other())
		expect(await budget()).toBe(changeFee)
		await mint(100n * unit, fixture.secondQuestionId)
		await redeemCompleteSet(fixture.other(), fixture.poolFor(fixture.secondQuestionId).securityPool, 100n * unit)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recyclePosition', args: [2n] }))
		expect(await budget()).toBe(changeFee)
		expect(await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'processingRewards', args: [fixture.other().account.address] })).toBe(reward)
		await redeemCompleteSet(fixture.other(), fixture.base.securityPoolAddresses.securityPool, 100n * unit)
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recyclePosition', args: [1n] }))
		expect(await budget()).toBe(changeFee - reward)
		expect(await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'processingRewards', args: [fixture.other().account.address] })).toBe(3n * reward)
	})

	test('fork-frozen ownership intervals retain their weights while partial and full idle exits remain free', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await mint()
		expect(await pendingFee()).toBe(changeFee)
		await fixture.base.mockWindow.setTime(fixture.base.questionData.endTime + 1n)
		await approveToken(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), getZoltarAddress())
		await forkUniverse(fixture.owner(), fixture.base.genesisUniverse, fixture.base.questionId)
		await initiateSecurityPoolFork(fixture.owner(), fixture.base.securityPoolAddresses.securityPool)
		expect(await pendingFee()).toBe(0n)
		// Processing freezes the source range even though its native allocation still has backing.
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'rebalancePosition', args: [1n] }))
		const ledger = await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recoveryLedger' })
		const interval = await fixture.owner().readContract({ abi: recoveryArtifact.abi, address: ledger, functionName: 'getOwnerInterval', args: [fixture.owner().account.address, 0n] })
		expect(interval.open).toBe(false)
		await withdraw((await shares()) / 2n)
		await withdraw(await shares())
		expect(await fixture.owner().readContract({ abi: recoveryArtifact.abi, address: ledger, functionName: 'getOwnerInterval', args: [fixture.owner().account.address, 0n] })).toEqual(interval)
		expect(await shares()).toBe(0n)
	})
})

import { describe, expect, test } from 'bun:test'
import { type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPool_SecurityPool as poolArtifact, statoblast_SecurityPoolPortfolioRecovery_SecurityPoolPortfolioRecovery as recoveryArtifact } from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { createCompleteSet, redeemCompleteSet, setUnderwritingLimit } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares, OperationType } from '../../testSupport/simulator/utils/contracts/statoblast'
import { manipulatePriceOracle, manipulatePriceOracleAndPerformOperation } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { aggregatePortfolioAbi, useAggregatePortfolioFixture } from './securityPoolPortfolioAggregateFixture'
import { unit } from './securityPoolPortfolioFixture'

describe('Statoblast: aggregate purchase fees', () => {
	const { fixture, deposit, quote, mint, fees, shares, assets, custody, positionCount } = useAggregatePortfolioFixture()
	const cleanupBounty = unit / 4_000n
	const pool = () => fixture.base.securityPoolAddresses.securityPool
	const eth = (address: Address) => getETHBalance(fixture.owner(), address)
	const idle = () => getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.portfolio)
	const prepare = async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
	}
	const claimFees = (owner = fixture.owner()) => writeContractAndWait(owner, () => owner.writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'claimFees' }))
	const bounty = (positionId = 1n) => fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recoveryBounties', args: [positionId] })

	test('the same purchase has the same positive fee with new backing or spare native capacity', async () => {
		await prepare()
		const [newBacking, newFee] = await quote(50n * unit)
		expect(newBacking).toBeGreaterThan(0n)
		expect(newFee).toBeGreaterThan(0n)
		await setUnderwritingLimit(fixture.owner(), pool(), 100n * unit)
		const [reusedBacking, reusedFee] = await quote(50n * unit)
		expect(reusedBacking).toBe(0n)
		expect(reusedFee).toBe(newFee)
	})

	test('dust purchases retain the native minimum backing fee when capacity is reused', async () => {
		await prepare()
		const minimumBacking = await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'minimumVaultRepDepositAttoRep' })
		const [, standaloneFee] = await quote(1n)
		const expectedFee = (minimumBacking + 99n) / 100n
		expect(standaloneFee).toBe(expectedFee > unit / 1_000n ? expectedFee : unit / 1_000n)
		await setUnderwritingLimit(fixture.owner(), pool(), 100n * unit)
		const [backing, reusedFee] = await quote(1n)
		expect(backing).toBe(0n)
		expect(reusedFee).toBe(standaloneFee)
	})

	test('spare native capacity still requires a fresh settled price to value the purchase fee', async () => {
		await prepare()
		await setUnderwritingLimit(fixture.owner(), pool(), 100n * unit)
		await fixture.base.mockWindow.advanceTime(301n)
		await expect(quote(50n * unit)).rejects.toThrow('Mint needs settled fresh price')
		await expect(mint(50n * unit)).rejects.toThrow('Mint needs settled fresh price')
		expect(await eth(pool())).toBe(0n)
	})

	test('an exact purchase quote includes pending native fee accrual rounding', async () => {
		await prepare()
		await mint(101n * unit + 3n)
		await fixture.base.mockWindow.advanceTime(2n)
		const amount = unit + 42n
		const [, purchaseFee] = await quote(amount)
		await mint(amount, fixture.base.questionId, purchaseFee)
		const supply = await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'shareTokenSupplyAttoShares' })
		expect(supply).toBeGreaterThan(101n * unit + 3n)
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([supply, supply, supply])
	})

	test('an exact purchase quote covers native withdrawal rounding after a backing donation', async () => {
		await manipulatePriceOracleAndPerformOperation(fixture.owner(), fixture.base.mockWindow, fixture.base.securityPoolAddresses.openOraclePriceCoordinator, OperationType.WithdrawRep, fixture.owner().account.address, 5_000n * unit, unit)
		await prepare()
		await mint()
		await fixture.transferRep(pool(), 9_301n * unit)
		const factory = getInfraContractAddresses().securityPoolFactory
		await fixture.base.mockWindow.impersonateAccount(factory)
		await fixture.base.mockWindow.setBalance(factory, unit)
		const factoryClient = createWriteClient(fixture.base.mockWindow, BigInt(factory))
		// Isolate the unit-conversion boundary from time-based fees using the factory's production initializer.
		await writeContractAndWait(factoryClient, () => factoryClient.writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'setStartingParams', args: [unit, 74n * unit + 3n] }))
		const [, purchaseFee] = await quote(37n * unit)
		expect(purchaseFee).toBeGreaterThan(0n)
		await mint(37n * unit, fixture.base.questionId, purchaseFee)
		const supply = await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'shareTokenSupplyAttoShares' })
		expect(supply).toBeGreaterThan(100n * unit)
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([supply, supply, supply])
	})

	test('dust buyers pay for reserved capital and insufficient fee budgets revert atomically', async () => {
		await prepare()
		const [backing, fee] = await quote(1_000_000_000n)
		expect(backing).toBeGreaterThan(0n)
		expect(fee).toBeGreaterThanOrEqual(unit / 1_000n)
		await expect(mint(1_000_000_000n, fixture.base.questionId, fee - 1n)).rejects.toThrow('Purchase fee exceeds budget')
		expect(await idle()).toBe(5_000n * unit)
		expect(await fixture.repClaim(pool(), fixture.portfolio)).toBe(0n)
		expect(await fees()).toBe(0n)
		await mint(1_000_000_000n, fixture.base.questionId, fee)
		expect(await fees()).toBe(fee - cleanupBounty)
		expect(await bounty()).toBe(cleanupBounty)
	})

	test('separate questions compensate reserved capital and subtract only that backing from reserve NAV', async () => {
		await prepare()
		let totalFees = 0n
		let totalBacking = 0n
		for (const [index, questionId] of [fixture.base.questionId, fixture.secondQuestionId].entries()) {
			const [backing, fee] = await quote(1_000_000_000n, questionId)
			await mint(1_000_000_000n, questionId, fee)
			expect(await fixture.repClaim(fixture.poolFor(questionId).securityPool, await custody(BigInt(index + 1)))).toBe(backing)
			totalFees += fee - cleanupBounty
			expect(await bounty(BigInt(index + 1))).toBe(cleanupBounty)
			totalBacking += backing
		}
		expect(await fees()).toBeGreaterThanOrEqual(totalFees)
		expect(await assets()).toBe(5_000n * unit - totalBacking)
	})

	test('fee budgets and forced ETH never become settlement collateral or buyer refunds', async () => {
		await prepare()
		await fixture.base.mockWindow.setBalance(fixture.portfolio, 3n * unit)
		const [, fee] = await quote()
		const payerBefore = await eth(fixture.other().account.address)
		const hash = await mint()
		const receipt = await fixture.other().waitForTransactionReceipt({ hash })
		if (receipt.effectiveGasPrice === undefined) throw new Error('Missing effective gas price')
		expect(payerBefore - (await eth(fixture.other().account.address))).toBe(100n * unit + fee + receipt.gasUsed * receipt.effectiveGasPrice)
		expect(await eth(fixture.portfolio)).toBe(3n * unit + fee)
		expect(await fees()).toBe(fee - cleanupBounty)
		expect(await bounty()).toBe(cleanupBounty)
		expect(await eth(pool())).toBe(100n * unit)
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([100n * unit, 100n * unit, 100n * unit])
	})

	test('redeeming complete sets does not refund purchase fees', async () => {
		await prepare()
		const [, fee] = await quote()
		await mint()
		await redeemCompleteSet(fixture.other(), pool(), 100n * unit)
		expect(await fees()).toBe(fee - cleanupBounty)
		expect(await bounty()).toBe(cleanupBounty)
		expect(await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'settlementCollateralAttoEth' })).toBe(0n)
	})

	test('funded owners earn proportional fees and late depositors cannot acquire past fees', async () => {
		await prepare()
		await mint()
		const earned = await fees()
		await deposit(await assets(), fixture.other())
		expect(await fees(fixture.other().account.address)).toBe(0n)
		expect(await fees()).toBeGreaterThanOrEqual(earned)
		const [, fee] = await quote(100n * unit, fixture.secondQuestionId)
		await mint(100n * unit, fixture.secondQuestionId, fee)
		expect(await fees(fixture.other().account.address)).toBeGreaterThanOrEqual((fee - cleanupBounty) / 2n)
		expect(await fees()).toBeGreaterThan(await fees(fixture.other().account.address))
	})

	test('permissionless native fee redemption remains with the original allocation owners', async () => {
		await prepare()
		await mint()
		const before = await fees()
		const source = await custody()
		await fixture.base.mockWindow.advanceTime(3_600n)
		await deposit(await assets(), fixture.other())
		await writeContractAndWait(fixture.other(), () => fixture.other().writeContract({ abi: poolArtifact.abi, address: pool(), functionName: 'redeemFees', args: [source] }))
		expect(await eth(source)).toBeGreaterThan(0n)
		expect(await fees()).toBe(before)
		expect(await fees(fixture.other().account.address)).toBe(0n)
	})

	test('price-induced capital top-ups use the same purchase fee as standalone backing', async () => {
		await prepare()
		await mint()
		await manipulatePriceOracle(fixture.owner(), fixture.base.mockWindow, fixture.base.securityPoolAddresses.openOraclePriceCoordinator, 2n * unit)
		const [backing, fee] = await quote()
		expect(backing).toBeGreaterThan(240n * unit)
		const [, standaloneFee] = await quote(100n * unit, fixture.secondQuestionId)
		expect(fee).toBe(standaloneFee)
		expect(fee).toBe((24n * unit) / 10n)
		await expect(mint(100n * unit, fixture.base.questionId, 0n)).rejects.toThrow('Purchase fee exceeds budget')
		await mint(100n * unit, fixture.base.questionId, fee)
	})

	test('existing native capacity charges and refunds without creating portfolio custody', async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
		await setUnderwritingLimit(fixture.owner(), pool(), 100n * unit)
		const [backing, fee] = await quote(50n * unit)
		expect(backing).toBe(0n)
		expect(fee).toBe((12n * unit) / 10n)
		await expect(mint(50n * unit, fixture.base.questionId, fee - 1n)).rejects.toThrow('Purchase fee exceeds budget')
		const payerBefore = await eth(fixture.other().account.address)
		const hash = await mint(50n * unit, fixture.base.questionId, fee + unit)
		const receipt = await fixture.other().waitForTransactionReceipt({ hash })
		if (receipt.effectiveGasPrice === undefined) throw new Error('Missing effective gas price')
		expect(payerBefore - (await eth(fixture.other().account.address))).toBe(50n * unit + fee + receipt.gasUsed * receipt.effectiveGasPrice)
		expect(await positionCount()).toBe(0n)
		expect(await assets()).toBe(5_000n * unit)
		expect(await fees()).toBe(fee)
		expect(await bounty()).toBe(0n)
		expect(await eth(fixture.portfolio)).toBe(fee)
		expect(await eth(pool())).toBe(50n * unit)
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([50n * unit, 50n * unit, 50n * unit])
	})

	test('reuse charges the full purchase fee to owners without reserving another cleanup bounty', async () => {
		await prepare()
		await mint()
		const before = await fees()
		const [, fee] = await quote()
		await mint(100n * unit, fixture.base.questionId, fee)
		expect(await positionCount()).toBe(1n)
		expect(await fees()).toBeGreaterThanOrEqual(before + fee)
		expect(await bounty()).toBe(cleanupBounty)
	})

	test('a portfolio without capital cannot collect fees from unrelated native capacity', async () => {
		await fixture.refreshPrice(fixture.base.questionId)
		await setUnderwritingLimit(fixture.owner(), pool(), 100n * unit)
		await expect(quote(50n * unit)).rejects.toThrow('No portfolio capital')
		await expect(mint(50n * unit)).rejects.toThrow('No portfolio capital')
		expect(await positionCount()).toBe(0n)
		expect(await assets()).toBe(0n)
		expect(await fees()).toBe(0n)
		expect(await bounty()).toBe(0n)
		expect(await eth(fixture.portfolio)).toBe(0n)
		expect(await eth(pool())).toBe(0n)
		await createCompleteSet(fixture.other(), pool(), 50n * unit)
		expect(await eth(pool())).toBe(50n * unit)
		expect(await eth(fixture.portfolio)).toBe(0n)
	})

	test('historical reuse credits purchase fees to the original owner recovery interval', async () => {
		await prepare()
		await mint()
		const earned = await fees()
		await deposit(await assets(), fixture.other())
		await redeemCompleteSet(fixture.other(), pool(), 100n * unit)
		const [, fee] = await quote()
		await mint(100n * unit, fixture.base.questionId, fee)
		const ledger = await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recoveryLedger' })
		expect(await positionCount()).toBe(1n)
		expect(await fees()).toBe(earned)
		expect(await fees(fixture.other().account.address)).toBe(0n)
		expect([...(await fixture.owner().readContract({ abi: recoveryArtifact.abi, address: ledger, functionName: 'claimableInterval', args: [fixture.owner().account.address, 0n] }))]).toEqual([0n, fee])
		expect([...(await fixture.owner().readContract({ abi: recoveryArtifact.abi, address: ledger, functionName: 'claimableInterval', args: [fixture.other().account.address, 0n] }))]).toEqual([0n, 0n])
		expect(await bounty()).toBe(cleanupBounty)
		const before = await eth(fixture.owner().account.address)
		const hash = await writeContractAndWait(fixture.owner(), () => fixture.owner().writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'claimRecovered', args: [[0n]] }))
		const receipt = await fixture.owner().waitForTransactionReceipt({ hash })
		if (receipt.effectiveGasPrice === undefined) throw new Error('Missing effective gas price')
		expect((await eth(fixture.owner().account.address)) + receipt.gasUsed * receipt.effectiveGasPrice - before).toBe(earned + fee)
		expect(await fees()).toBe(0n)
		expect(await fixture.owner().readContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'recoveredFeesAttoEth' })).toBe(0n)
	})

	test('final share failure and underfunded collateral leave fees and reserve unchanged', async () => {
		await prepare()
		await expect(mint(100n * unit, fixture.base.questionId, 10n * unit, 101n * unit)).rejects.toThrow('Minimum shares not met')
		await expect(mint(100n * unit, fixture.base.questionId, -1n)).rejects.toThrow('Mint collateral not funded')
		expect(await fees()).toBe(0n)
		expect(await idle()).toBe(5_000n * unit)
		expect(await fixture.repClaim(pool(), fixture.portfolio)).toBe(0n)
		expect(await eth(pool())).toBe(0n)
	})

	test('owners collect only their earned ETH without changing pool shares or REP exposure', async () => {
		await prepare()
		await mint()
		const balance = await shares()
		const reserve = await assets()
		await expect(claimFees(fixture.other())).rejects.toThrow('No fees available')
		const before = await eth(fixture.owner().account.address)
		const hash = await claimFees()
		const receipt = await fixture.owner().waitForTransactionReceipt({ hash })
		if (receipt.effectiveGasPrice === undefined) throw new Error('Missing effective gas price')
		expect((await eth(fixture.owner().account.address)) + receipt.gasUsed * receipt.effectiveGasPrice).toBeGreaterThan(before)
		expect(await fees()).toBe(0n)
		expect(await shares()).toBe(balance)
		expect(await assets()).toBe(reserve)
	})
})

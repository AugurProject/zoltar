import { describe, expect, test } from 'bun:test'
import { type Address } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_SecurityPool_SecurityPool as poolArtifact } from '../../types/contractArtifact'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { getInfraContractAddresses } from '../../testSupport/simulator/utils/contracts/deployStatoblast'
import { getERC20Balance, getETHBalance } from '../../testSupport/simulator/utils/utilities'
import { getRepTokenAddress } from '../../testSupport/simulator/utils/contracts/zoltar'
import { redeemCompleteSet, setUnderwritingLimit } from '../../testSupport/simulator/utils/contracts/securityPool'
import { balanceOfShares, OperationType } from '../../testSupport/simulator/utils/contracts/statoblast'
import { manipulatePriceOracle, manipulatePriceOracleAndPerformOperation } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { aggregatePortfolioAbi, useAggregatePortfolioFixture } from './securityPoolPortfolioAggregateFixture'
import { unit } from './securityPoolPortfolioFixture'

describe('Statoblast: aggregate reservation compensation', () => {
	const { fixture, deposit, quote, mint, fees, shares, assets, custody } = useAggregatePortfolioFixture()
	const pool = () => fixture.base.securityPoolAddresses.securityPool
	const eth = (address: Address) => getETHBalance(fixture.owner(), address)
	const idle = () => getERC20Balance(fixture.owner(), getRepTokenAddress(fixture.base.genesisUniverse), fixture.portfolio)
	const prepare = async () => {
		await deposit()
		await fixture.refreshPrice(fixture.base.questionId)
	}
	const claimFees = (owner = fixture.owner()) => writeContractAndWait(owner, () => owner.writeContract({ abi: aggregatePortfolioAbi, address: fixture.portfolio, functionName: 'claimFees' }))

	test('an exact reservation fee quote includes pending native fee accrual rounding', async () => {
		await prepare()
		await mint(101n * unit + 3n)
		await fixture.base.mockWindow.advanceTime(2n)
		const amount = unit + 42n
		const [, reservationFee] = await quote(amount)
		await mint(amount, fixture.base.questionId, reservationFee)
		const supply = await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'shareTokenSupplyAttoShares' })
		expect(supply).toBeGreaterThan(101n * unit + 3n)
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([supply, supply, supply])
	})

	test('an exact reservation fee quote covers native withdrawal rounding after a backing donation', async () => {
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
		const [, reservationFee] = await quote(37n * unit)
		expect(reservationFee).toBeGreaterThan(0n)
		await mint(37n * unit, fixture.base.questionId, reservationFee)
		const supply = await fixture.owner().readContract({ abi: poolArtifact.abi, address: pool(), functionName: 'shareTokenSupplyAttoShares' })
		expect(supply).toBeGreaterThan(100n * unit)
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([supply, supply, supply])
	})

	test('dust buyers pay for reserved capital and insufficient fee budgets revert atomically', async () => {
		await prepare()
		const [backing, fee] = await quote(1_000_000_000n)
		expect(backing).toBeGreaterThan(0n)
		expect(fee).toBeGreaterThanOrEqual(unit / 1_000n)
		await expect(mint(1_000_000_000n, fixture.base.questionId, fee - 1n)).rejects.toThrow('Reservation fee exceeds budget')
		expect(await idle()).toBe(5_000n * unit)
		expect(await fixture.repClaim(pool(), fixture.portfolio)).toBe(0n)
		expect(await fees()).toBe(0n)
		await mint(1_000_000_000n, fixture.base.questionId, fee)
		expect(await fees()).toBe(fee)
	})

	test('separate questions compensate reserved capital and subtract only that backing from reserve NAV', async () => {
		await prepare()
		let totalFees = 0n
		let totalBacking = 0n
		for (const [index, questionId] of [fixture.base.questionId, fixture.secondQuestionId].entries()) {
			const [backing, fee] = await quote(1_000_000_000n, questionId)
			await mint(1_000_000_000n, questionId, fee)
			expect(await fixture.repClaim(fixture.poolFor(questionId).securityPool, await custody(BigInt(index + 1)))).toBe(backing)
			totalFees += fee
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
		expect(await fees()).toBe(fee)
		expect(await eth(pool())).toBe(100n * unit)
		expect(await balanceOfShares(fixture.owner(), fixture.base.securityPoolAddresses.shareToken, fixture.base.genesisUniverse, fixture.other().account.address)).toEqual([100n * unit, 100n * unit, 100n * unit])
	})

	test('redeeming complete sets does not refund reservation fees', async () => {
		await prepare()
		const [, fee] = await quote()
		await mint()
		await redeemCompleteSet(fixture.other(), pool(), 100n * unit)
		expect(await fees()).toBe(fee)
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
		expect(await fees(fixture.other().account.address)).toBeGreaterThanOrEqual(fee / 2n)
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

	test('price-induced capital top-ups are compensated and cannot exceed a buyer fee budget', async () => {
		await prepare()
		await mint()
		await manipulatePriceOracle(fixture.owner(), fixture.base.mockWindow, fixture.base.securityPoolAddresses.openOraclePriceCoordinator, 2n * unit)
		const [backing, fee] = await quote()
		expect(backing).toBeGreaterThan(240n * unit)
		expect(fee).toBeGreaterThan((24n * unit) / 10n)
		await expect(mint(100n * unit, fixture.base.questionId, 0n)).rejects.toThrow('Reservation fee exceeds budget')
		await mint(100n * unit, fixture.base.questionId, fee)
	})

	test('existing native capacity needs no reservation fee even if the caller budgets extra ETH', async () => {
		await fixture.refreshPrice(fixture.base.questionId)
		await setUnderwritingLimit(fixture.owner(), pool(), 100n * unit)
		await mint(50n * unit)
		expect(await fees()).toBe(0n)
		expect(await eth(fixture.portfolio)).toBe(0n)
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

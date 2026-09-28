import { approveToken } from '../../testSupport/simulator/utils/utilities'
import { describe, expect, test } from 'bun:test'
import { useStatoblastVaultAccountingFixture } from './fixture'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { approveAndDepositRepToVault, manipulatePriceOracle, manipulatePriceOracleAndPerformOperation } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { OperationType } from '../../testSupport/simulator/utils/contracts/statoblast'
import { createCompleteSet, getRepToken, getSecurityVault, redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { statoblast_SecurityPool_SecurityPool } from '../../types/contractArtifact'

const unit = 10n ** 18n
const abi = statoblast_SecurityPool_SecurityPool.abi

describe('Statoblast: continuous proportional commitments', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const pool = () => fixture.securityPoolAddresses.securityPool
	const freshPrice = async (price = fixture.reportedRepEthPrice) => manipulatePriceOracle(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.priceOracleManagerAndOperatorQueuer, price)
	const setLimit = async (limit: bigint, client = fixture.client) => writeContractAndWait(client, () => client.writeContract({ abi, address: pool(), functionName: 'setUnderwritingLimit', args: [limit] }))
	const obligation = async (vault = fixture.client.account.address) => fixture.client.readContract({ abi, address: pool(), functionName: 'getVaultOpenInterestAttoEth', args: [vault] })
	const total = async () => fixture.client.readContract({ abi, address: pool(), functionName: 'totalUnderwritingLimitAttoEth' })

	test('setting a backed limit immediately permits minting without another transaction', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		await createCompleteSet(fixture.client, pool(), unit)
		expect(await total()).toBe(10n * unit)
		expect(await fixture.client.readContract({ abi, address: pool(), functionName: 'settlementCollateralAttoEth' })).toBe(unit)
	})

	test('initial shares use the same 18-decimal denomination as ETH', async () => {
		expect(await fixture.client.readContract({ abi, address: pool(), functionName: 'attoEthToAttoShares', args: [1n] })).toBe(1n)
		await freshPrice()
		await setLimit(10n * unit)
		await createCompleteSet(fixture.client, pool(), unit)
		expect(await fixture.client.readContract({ abi, address: pool(), functionName: 'shareTokenSupplyAttoShares' })).toBe(unit)
		expect(await fixture.client.readContract({ abi, address: pool(), functionName: 'attoSharesToAttoEth', args: [unit] })).toBe(unit)
	})

	test('wallet-funded escalation closes minting without changing standing commitments', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		await approveToken(fixture.client, await getRepToken(fixture.client, pool()), pool())
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi, address: pool(), functionName: 'depositWalletRepToEscalationGame', args: [1, unit * 100n] }))
		expect(await total()).toBe(10n * unit)
		await expect(createCompleteSet(fixture.client, pool(), unit)).rejects.toThrow('Escalation mint closed')
	})

	test('depositing REP does not create a commitment', async () => {
		expect((await getSecurityVault(fixture.client, pool(), fixture.client.account.address)).underwritingLimitAttoEth).toBe(0n)
		expect(await total()).toBe(0n)
	})

	test('adding a limit proportionally reassigns existing collateral without mint allocations', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		await createCompleteSet(fixture.client, pool(), 10n * unit)
		const receiver = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[1])
		await approveAndDepositRepToVault(receiver, fixture.repDeposit, fixture.questionId)
		await setLimit(5n * unit, receiver)
		const collateral = await fixture.client.readContract({ abi, address: pool(), functionName: 'settlementCollateralAttoEth' })
		expect(await total()).toBe(15n * unit)
		expect(await obligation()).toBe((collateral * 10n + 14n) / 15n)
		expect(await obligation(receiver.account.address)).toBe((collateral * 5n + 14n) / 15n)
		expect(await obligation()).toBeLessThanOrEqual(10n * unit)
		expect(await obligation(receiver.account.address)).toBeLessThanOrEqual(5n * unit)
	})

	test('underbacked total commitments close all minting even when a small mint would be covered', async () => {
		await freshPrice()
		await setLimit(400n * unit)
		await freshPrice(2n * fixture.reportedRepEthPrice)
		expect(await total()).toBe(400n * unit)
		expect(await fixture.client.readContract({ abi, address: pool(), functionName: 'getCurrentMintingCapacityAttoEth' })).toBe(0n)
		await expect(createCompleteSet(fixture.client, pool(), unit)).rejects.toThrow('Pool backing insufficient')
		await setLimit(250n * unit)
		expect(await fixture.client.readContract({ abi, address: pool(), functionName: 'getCurrentMintingCapacityAttoEth' })).toBe(250n * unit)
		await createCompleteSet(fixture.client, pool(), 250n * unit)
	})

	test('minting rejects insufficient aggregate backing and stale oracle prices', async () => {
		await freshPrice()
		await setLimit(400n * unit)
		await freshPrice(2n * fixture.reportedRepEthPrice)
		await expect(createCompleteSet(fixture.client, pool(), unit)).rejects.toThrow('Pool backing insufficient')
		await fixture.mockWindow.advanceTime(301n)
		await expect(createCompleteSet(fixture.client, pool(), unit, true)).rejects.toThrow('Stale price')
		expect(await fixture.client.readContract({ abi, address: pool(), functionName: 'getCurrentMintingCapacityAttoEth' })).toBe(0n)
	})

	test('reported backing ratios value the full ETH commitment at the live price', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		const factors = await fixture.client.readContract({ abi, address: pool(), functionName: 'getVaultCapacityBackingFactorsBps', args: [fixture.client.account.address] })
		const requiredBaseRep = 10n * fixture.reportedRepEthPrice
		expect(factors[0]).toBe((fixture.repDeposit * 10_000n) / requiredBaseRep)
		expect(factors[1]).toBe(factors[0])
	})

	test('no-op limits preserve fee rounding carries', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		const before = await fixture.client.readContract({ abi, address: pool(), functionName: 'getPoolAccountingSnapshot' })
		await setLimit(10n * unit)
		const outsider = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[1])
		await setLimit(0n, outsider)
		const after = await fixture.client.readContract({ abi, address: pool(), functionName: 'getPoolAccountingSnapshot' })
		expect(after.feeIndexRemainder).toBe(before.feeIndexRemainder)
	})

	test('retained underbacked commitments keep earning fees after a price change', async () => {
		await freshPrice()
		await setLimit(400n * unit)
		await createCompleteSet(fixture.client, pool(), 10n * unit)
		await freshPrice(2n * fixture.reportedRepEthPrice)
		await expect(createCompleteSet(fixture.client, pool(), unit)).rejects.toThrow('Pool backing insufficient')
		const before = await getSecurityVault(fixture.client, pool(), fixture.client.account.address)
		const collateralBefore = await fixture.client.readContract({ abi, address: pool(), functionName: 'settlementCollateralAttoEth' })
		await fixture.mockWindow.advanceTime(86_400n)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi, address: pool(), functionName: 'updateVaultFees', args: [fixture.client.account.address] }))
		const after = await getSecurityVault(fixture.client, pool(), fixture.client.account.address)
		expect(after.claimableFeesAttoEth).toBeGreaterThan(before.claimableFeesAttoEth)
		expect(after.underwritingLimitAttoEth).toBe(400n * unit)
		expect(await fixture.client.readContract({ abi, address: pool(), functionName: 'settlementCollateralAttoEth' })).toBeLessThan(collateralBefore)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi, address: pool(), functionName: 'redeemFees', args: [fixture.client.account.address] }))
		expect((await getSecurityVault(fixture.client, pool(), fixture.client.account.address)).claimableFeesAttoEth).toBe(0n)
	})

	test('deposits restore aggregate mint capacity without a separate confirmation', async () => {
		await freshPrice()
		await setLimit(400n * unit)
		await freshPrice(2n * fixture.reportedRepEthPrice)
		await approveAndDepositRepToVault(fixture.client, fixture.repDeposit, fixture.questionId)
		expect(await total()).toBe(400n * unit)
		await createCompleteSet(fixture.client, pool(), 400n * unit)
	})

	test('withdrawals preserve all standing commitments even with little settlement collateral', async () => {
		await freshPrice()
		await setLimit(400n * unit)
		const receiver = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[1])
		await approveAndDepositRepToVault(receiver, fixture.repDeposit, fixture.questionId)
		const price = 2n * fixture.reportedRepEthPrice
		await freshPrice(price)
		await createCompleteSet(fixture.client, pool(), unit)
		const before = await getSecurityVault(fixture.client, pool(), receiver.account.address)
		await manipulatePriceOracleAndPerformOperation(receiver, fixture.mockWindow, fixture.securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, receiver.account.address, fixture.repDeposit, price)
		expect((await getSecurityVault(fixture.client, pool(), receiver.account.address)).repBackingUnits).toBe(before.repBackingUnits)
		await fixture.mockWindow.advanceTime(301n)
		await manipulatePriceOracleAndPerformOperation(receiver, fixture.mockWindow, fixture.securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, receiver.account.address, 1_000n * unit, price)
		expect((await getSecurityVault(fixture.client, pool(), receiver.account.address)).repBackingUnits).toBeLessThan(before.repBackingUnits)
		expect(await fixture.client.readContract({ abi, address: pool(), functionName: 'getCurrentMintingCapacityAttoEth' })).toBeGreaterThanOrEqual(await fixture.client.readContract({ abi, address: pool(), functionName: 'settlementCollateralAttoEth' }))
	})

	test('liquidation after a price drop and new mint transfers commitments without writing off collateral', async () => {
		await freshPrice()
		await setLimit(400n * unit)
		const receiver = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[1])
		await approveAndDepositRepToVault(receiver, 3n * fixture.repDeposit, fixture.questionId)
		await freshPrice(2n * fixture.reportedRepEthPrice)
		await createCompleteSet(fixture.client, pool(), 400n * unit)
		const supplyBefore = await fixture.client.readContract({ abi, address: pool(), functionName: 'shareTokenSupplyAttoShares' })
		await manipulatePriceOracleAndPerformOperation(receiver, fixture.mockWindow, fixture.securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, fixture.client.account.address, 400n * unit)
		expect(await total()).toBe(400n * unit)
		expect((await getSecurityVault(fixture.client, pool(), fixture.client.account.address)).underwritingLimitAttoEth).toBe(0n)
		expect((await getSecurityVault(fixture.client, pool(), receiver.account.address)).underwritingLimitAttoEth).toBe(400n * unit)
		expect(await fixture.client.readContract({ abi, address: pool(), functionName: 'shareTokenSupplyAttoShares' })).toBe(supplyBefore)
		const collateral = await fixture.client.readContract({ abi, address: pool(), functionName: 'settlementCollateralAttoEth' })
		expect(collateral).toBeGreaterThan(399n * unit)
		expect(await obligation()).toBe(0n)
		expect(await obligation(receiver.account.address)).toBe(collateral)
		await redeemCompleteSet(fixture.client, pool(), supplyBefore)
		expect(await fixture.client.readContract({ abi, address: pool(), functionName: 'settlementCollateralAttoEth' })).toBe(0n)
	})

	test('reductions cannot strand settlement collateral and redemption preserves standing limits', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		await createCompleteSet(fixture.client, pool(), 8n * unit)
		await expect(setLimit(7n * unit)).rejects.toThrow()
		await setLimit(9n * unit)
		const supply = await fixture.client.readContract({ abi, address: pool(), functionName: 'shareTokenSupplyAttoShares' })
		await redeemCompleteSet(fixture.client, pool(), supply)
		expect(await obligation()).toBe(0n)
		expect(await total()).toBe(9n * unit)
		await setLimit(0n)
		expect(await total()).toBe(0n)
	})

	test('a fully backed receiver takes the entire underbacked limit at zero settlement collateral', async () => {
		await freshPrice()
		await setLimit(100n * unit)
		const receiver = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[1])
		await approveAndDepositRepToVault(receiver, 3n * fixture.repDeposit, fixture.questionId)
		await freshPrice(10n * fixture.reportedRepEthPrice)
		await manipulatePriceOracleAndPerformOperation(receiver, fixture.mockWindow, fixture.securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, fixture.client.account.address, 100n * unit)
		expect(await total()).toBe(100n * unit)
		expect((await getSecurityVault(fixture.client, pool(), fixture.client.account.address)).underwritingLimitAttoEth).toBe(0n)
		expect((await getSecurityVault(fixture.client, pool(), receiver.account.address)).underwritingLimitAttoEth).toBe(100n * unit)
		expect(await obligation(receiver.account.address)).toBe(0n)
	})
})

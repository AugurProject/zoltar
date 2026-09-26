import { describe, expect, test } from 'bun:test'
import { useStatoblastVaultAccountingFixture } from './fixture'
import { createWriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { approveAndDepositRepToVault, manipulatePriceOracle, manipulatePriceOracleAndPerformOperation } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { OperationType } from '../../testSupport/simulator/utils/contracts/statoblast'
import { createCompleteSet, getSecurityVault, redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { statoblast_SecurityPool_SecurityPool } from '../../types/contractArtifact'

const unit = 10n ** 18n
const abi = statoblast_SecurityPool_SecurityPool.abi

describe('Statoblast: continuous proportional commitments', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const pool = () => fixture.securityPoolAddresses.securityPool
	const freshPrice = async (price = fixture.reportedRepEthPrice) => manipulatePriceOracle(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.priceOracleManagerAndOperatorQueuer, price)
	const setLimit = async (limit: bigint, client = fixture.client) => writeContractAndWait(client, () => client.writeContract({ abi, address: pool(), functionName: 'setUnderwritingLimit', args: [limit] }))
	const certify = async (vault = fixture.client.account.address) => writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi, address: pool(), functionName: 'certifyVaultCoverage', args: [vault] }))
	const obligation = async (vault = fixture.client.account.address) => fixture.client.readContract({ abi, address: pool(), functionName: 'getVaultOpenInterestAttoEth', args: [vault] })
	const total = async () => fixture.client.readContract({ abi, address: pool(), functionName: 'totalUnderwritingLimitAttoEth' })
	const certified = async () => fixture.client.readContract({ abi, address: pool(), functionName: 'getCertifiedUnderwritingLimitAttoEth' })

	test('depositing REP does not create a commitment', async () => {
		expect((await getSecurityVault(fixture.client, pool(), fixture.client.account.address)).underwritingLimitAttoEth).toBe(0n)
		expect(await total()).toBe(0n)
	})

	test('adding a limit proportionally reassigns existing collateral without mint allocations', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		await certify()
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

	test('keepers can identify each vault needing certification without scanning on chain', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		const statusAbi = [{ type: 'function', name: 'isVaultCoverageCertified', stateMutability: 'view', inputs: [{ name: 'vault', type: 'address' }], outputs: [{ type: 'bool' }] }] as const
		const status = () => fixture.client.readContract({ abi: statusAbi, address: pool(), functionName: 'isVaultCoverageCertified', args: [fixture.client.account.address] })
		expect(await status()).toBe(false)
		await certify()
		expect(await status()).toBe(true)
		await setLimit(11n * unit)
		expect(await status()).toBe(false)
	})

	test('certification is idempotent and price changes require fresh certification', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		await certify()
		await certify()
		expect(await certified()).toBe(10n * unit)
		await freshPrice(2n * fixture.reportedRepEthPrice)
		expect(await certified()).toBe(0n)
		await certify()
		expect(await certified()).toBe(10n * unit)
	})

	test('reported backing ratios value the full ETH commitment at the live price', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		const factors = await fixture.client.readContract({ abi, address: pool(), functionName: 'getVaultCapacityBackingFactorsBps', args: [fixture.client.account.address] })
		const requiredBaseRep = 10n * fixture.reportedRepEthPrice
		expect(factors[0]).toBe((fixture.repDeposit * 10_000n) / requiredBaseRep)
		expect(factors[1]).toBe(factors[0])
	})

	test('no-op limits cannot invalidate coverage or erase fee rounding carries', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		await certify()
		const before = await fixture.client.readContract({ abi, address: pool(), functionName: 'getPoolAccountingSnapshot' })
		await setLimit(10n * unit)
		const outsider = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[1])
		await setLimit(0n, outsider)
		expect(await certified()).toBe(10n * unit)
		const after = await fixture.client.readContract({ abi, address: pool(), functionName: 'getPoolAccountingSnapshot' })
		expect(after.feeIndexRemainder).toBe(before.feeIndexRemainder)
	})

	test('an underbacked advertised limit cannot be certified after a price change', async () => {
		await freshPrice()
		await setLimit(400n * unit)
		await certify()
		await freshPrice(2n * fixture.reportedRepEthPrice)
		expect(await certified()).toBe(0n)
		await expect(certify()).rejects.toThrow()
		expect(await total()).toBe(400n * unit)
	})

	test('retained underbacked commitments keep earning fees without health certification', async () => {
		await freshPrice()
		await setLimit(400n * unit)
		await certify()
		await createCompleteSet(fixture.client, pool(), 10n * unit)
		await freshPrice(2n * fixture.reportedRepEthPrice)
		await expect(certify()).rejects.toThrow()
		await expect(createCompleteSet(fixture.client, pool(), unit)).rejects.toThrow('Commitments not certified')
		const before = await getSecurityVault(fixture.client, pool(), fixture.client.account.address)
		const collateralBefore = await fixture.client.readContract({ abi, address: pool(), functionName: 'settlementCollateralAttoEth' })
		await fixture.mockWindow.advanceTime(86_400n)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi, address: pool(), functionName: 'updateVaultFees', args: [fixture.client.account.address] }))
		const after = await getSecurityVault(fixture.client, pool(), fixture.client.account.address)
		expect(after.claimableFeesAttoEth).toBeGreaterThan(before.claimableFeesAttoEth)
		expect(after.underwritingLimitAttoEth).toBe(400n * unit)
		expect(await certified()).toBe(0n)
		expect(await fixture.client.readContract({ abi, address: pool(), functionName: 'settlementCollateralAttoEth' })).toBeLessThan(collateralBefore)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ abi, address: pool(), functionName: 'redeemFees', args: [fixture.client.account.address] }))
		expect((await getSecurityVault(fixture.client, pool(), fixture.client.account.address)).claimableFeesAttoEth).toBe(0n)
		expect(await certified()).toBe(0n)
	})

	test('backing changes invalidate earlier certification even when the commitment is unchanged', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		await certify()
		await approveAndDepositRepToVault(fixture.client, fixture.repDeposit, fixture.questionId)
		expect(await certified()).toBe(0n)
		expect(await total()).toBe(10n * unit)
		await certify()
		expect(await certified()).toBe(10n * unit)
	})

	test('reductions cannot strand settlement collateral and redemption preserves standing limits', async () => {
		await freshPrice()
		await setLimit(10n * unit)
		await certify()
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

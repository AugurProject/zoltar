import { dirname } from 'node:path'
import { getContractOutput, loadContractsJson, normalizeStorageLayout } from '../contractArtifactHelpers'
import { encodeAbiParameters, keccak256 } from '@zoltar/core-shared/evm/ethereum'
import { describe, expect, test } from 'bun:test'
import { statoblast_SecurityPool_SecurityPool } from '../../types/contractArtifact'
import { useStatoblastVaultAccountingFixture } from './fixture'
import { createWriteClient, type WriteClient, writeContractAndWait } from '../../testSupport/simulator/utils/clients'
import { TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { createCompleteSet, redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { approveAndDepositRepToVault } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'

const abi = statoblast_SecurityPool_SecurityPool.abi
const ETH = 10n ** 18n

describe('explicit coverage assignments', () => {
	const fixture = useStatoblastVaultAccountingFixture(false)
	const pool = () => fixture.securityPoolAddresses.securityPool
	const offer = async (client: WriteClient, enabled = true, maximum = 100n * ETH) => await writeContractAndWait(client, () => client.writeContract({ address: pool(), abi, functionName: 'setCoverageOffer', args: [enabled, maximum, 10_000n] }))
	const units = async (vault = fixture.client.account.address) => await fixture.client.readContract({ address: pool(), abi, functionName: 'getVaultObligationUnits', args: [vault] })
	const obligation = async (vault = fixture.client.account.address) => await fixture.client.readContract({ address: pool(), abi, functionName: 'getVaultOpenInterestAttoEth', args: [vault] })
	const secondVault = async () => {
		const client = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[1])
		await fixture.transferRepToAddress(fixture.client, client.account.address, fixture.repDeposit)
		await approveAndDepositRepToVault(client, fixture.repDeposit, fixture.questionId)
		return client
	}

	test('depositing REP does not authorize allocations or assign obligations', async () => {
		expect(await units()).toBe(0n)
		expect((await fixture.client.readContract({ address: pool(), abi, functionName: 'coverageOffers', args: [fixture.client.account.address] }))[0]).toBe(false)
		await expect(createCompleteSet(fixture.client, pool(), ETH)).rejects.toThrow()
		expect(await units()).toBe(0n)
	})

	test('an enabled offer permits allocation, and disabling it preserves existing units', async () => {
		await offer(fixture.client)
		await createCompleteSet(fixture.client, pool(), ETH)
		const assigned = await units()
		expect(assigned).toBeGreaterThan(0n)
		await offer(fixture.client, false)
		expect(await units()).toBe(assigned)
		await expect(createCompleteSet(fixture.client, pool(), ETH)).rejects.toThrow()
		expect(await units()).toBe(assigned)
	})

	test('a separately funded participating vault does not increase an existing vault obligation', async () => {
		await offer(fixture.client)
		await createCompleteSet(fixture.client, pool(), 10n * ETH)
		const before = await obligation()
		const originalUnits = await units()
		const other = await secondVault()
		expect(await units()).toBe(originalUnits)
		expect(await units(other.account.address)).toBe(0n)
		await offer(other)
		await createCompleteSet(other, pool(), 2n * ETH)
		expect(await units()).toBe(originalUnits)
		expect(await obligation()).toBeLessThanOrEqual(before)
		expect(await obligation(other.account.address)).toBeLessThanOrEqual(2n * ETH + 1n)
	})

	test('the offer limit applies to the rounded resulting position', async () => {
		await offer(fixture.client, true, ETH)
		await createCompleteSet(fixture.client, pool(), ETH)
		const originalUnits = await units()
		await expect(createCompleteSet(fixture.client, pool(), ETH)).rejects.toThrow()
		expect(await units()).toBe(originalUnits)
	})

	test('redemption preserves units until the last economic share claim is burned', async () => {
		await offer(fixture.client)
		await createCompleteSet(fixture.client, pool(), 2n * ETH)
		const assigned = await units()
		const shares = await fixture.client.readContract({ address: pool(), abi, functionName: 'shareTokenSupplyAttoShares' })
		await redeemCompleteSet(fixture.client, pool(), shares / 2n)
		expect(await units()).toBe(assigned)
		expect(await obligation()).toBeLessThanOrEqual(ETH)
		await redeemCompleteSet(fixture.client, pool(), shares - shares / 2n)
		expect(await units()).toBe(0n)
		const other = await secondVault()
		await offer(other)
		await createCompleteSet(other, pool(), ETH)
		expect(await units()).toBe(0n)
		expect(await obligation()).toBe(0n)
	})
	test('unused offers earn no fees and earlier epoch fees remain claimable', async () => {
		const other = await secondVault()
		await offer(fixture.client)
		await offer(other)
		await createCompleteSet(fixture.client, pool(), 2n * ETH)
		await fixture.mockWindow.advanceTime(86_400n)
		await writeContractAndWait(other, () => other.writeContract({ address: pool(), abi, functionName: 'updateVaultFees', args: [other.account.address] }))
		expect((await other.readContract({ address: pool(), abi, functionName: 'securityVaults', args: [other.account.address] }))[2]).toBe(0n)
		const shares = await fixture.client.readContract({ address: pool(), abi, functionName: 'shareTokenSupplyAttoShares' })
		await redeemCompleteSet(fixture.client, pool(), shares)
		await createCompleteSet(other, pool(), ETH)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ address: pool(), abi, functionName: 'updateVaultFees', args: [fixture.client.account.address] }))
		const earned = (await fixture.client.readContract({ address: pool(), abi, functionName: 'securityVaults', args: [fixture.client.account.address] }))[2]
		expect(earned).toBeGreaterThan(0n)
		expect(await units()).toBe(0n)
		expect(await obligation()).toBe(0n)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ address: pool(), abi, functionName: 'updateVaultFees', args: [fixture.client.account.address] }))
		expect((await fixture.client.readContract({ address: pool(), abi, functionName: 'securityVaults', args: [fixture.client.account.address] }))[2]).toBe(earned)
	})

	test('explicit allocations conserve units and reject duplicate participants atomically', async () => {
		const other = await secondVault()
		await offer(fixture.client)
		await offer(other)
		// Initialize the oracle through the regular mint helper.
		await createCompleteSet(fixture.client, pool(), ETH)
		const before = await fixture.client.readContract({ address: pool(), abi, functionName: 'totalObligationUnits' })
		const allocations = [fixture.client.account.address, other.account.address].sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase())).map(vault => ({ vault, collateralAttoEth: ETH }))
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ address: pool(), abi, functionName: 'createCompleteSet', args: [allocations], value: 2n * ETH }))
		const total = await fixture.client.readContract({ address: pool(), abi, functionName: 'totalObligationUnits' })
		expect(total).toBeGreaterThan(before)
		expect((await units()) + (await units(other.account.address))).toBe(total)
		const duplicate = { vault: other.account.address, collateralAttoEth: ETH }
		await expect(writeContractAndWait(fixture.client, () => fixture.client.writeContract({ address: pool(), abi, functionName: 'createCompleteSet', args: [[duplicate, duplicate]], value: 2n * ETH }))).rejects.toThrow()
		expect(await fixture.client.readContract({ address: pool(), abi, functionName: 'totalObligationUnits' })).toBe(total)
	})

	test('owner health requirements apply to the entire resulting position', async () => {
		await offer(fixture.client, true, 10_000n * ETH)
		await createCompleteSet(fixture.client, pool(), ETH)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ address: pool(), abi, functionName: 'setCoverageOffer', args: [true, 10_000n * ETH, 100_000_000n] }))
		const assigned = await units()
		await expect(createCompleteSet(fixture.client, pool(), ETH)).rejects.toThrow()
		expect(await units()).toBe(assigned)
	})

	test('production fee accrual charges only actively secured collateral', async () => {
		await offer(fixture.client)
		await createCompleteSet(fixture.client, pool(), 10n * ETH)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ address: pool(), abi, functionName: 'updateVaultFees', args: [fixture.client.account.address] }))
		const total = await units()
		const active = total / 2n
		const slot = (name: string) => {
			const field = normalizeStorageLayout(getContractOutput(loadContractsJson(dirname(import.meta.dir)), 'contracts/statoblast/SecurityPool.sol', 'SecurityPool')).find(field => field.label === name)
			if (field === undefined) throw new Error(`Missing coverage storage field ${name}`)
			return `0x${BigInt(field.slot).toString(16).padStart(64, '0')}`
		}
		const position = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [fixture.client.account.address, BigInt(slot('coveragePositions'))]))
		// Seed a conserved written-off position to isolate production fee settlement.
		await fixture.mockWindow.addStateOverrides({
			[pool()]: {
				stateDiff: {
					[position]: active,
					[slot('writtenOffObligationUnits')]: total - active,
					[slot('activeObligationUnits')]: active,
				},
			},
		})
		const before = await fixture.client.readContract({ address: pool(), abi, functionName: 'getPoolAccountingSnapshot' })
		await fixture.mockWindow.advanceTime(86_400n)
		await writeContractAndWait(fixture.client, () => fixture.client.writeContract({ address: pool(), abi, functionName: 'updateSettlementCollateral' }))
		const after = await fixture.client.readContract({ address: pool(), abi, functionName: 'getPoolAccountingSnapshot' })
		let exponent = after.lastUpdatedFeeAccumulator - before.lastUpdatedFeeAccumulator
		let base = before.currentRetentionRate
		let retention = ETH
		while (exponent > 0n) {
			if (exponent % 2n !== 0n) retention = (retention * base) / ETH
			exponent /= 2n
			if (exponent !== 0n) base = (base * base) / ETH
		}
		const feeBase = (before.settlementCollateralAttoEth * active) / total
		const pending = (before.feeIndexRemainder + before.totalFeesOwedRemainder) / ETH
		const decaying = feeBase > pending ? feeBase - pending : 0n
		const indexDelta = ((decaying - (decaying * retention) / ETH) * ETH + before.feeIndexRemainder) / active
		const charged = (indexDelta * active + before.totalFeesOwedRemainder) / ETH
		expect(before.settlementCollateralAttoEth - after.settlementCollateralAttoEth).toBe(charged)
		expect(charged).toBeGreaterThan(0n)
		expect(await fixture.client.readContract({ address: pool(), abi, functionName: 'totalObligationUnits' })).toBe(total)
		expect(await units()).toBe(active)
		expect(await fixture.client.readContract({ address: pool(), abi, functionName: 'writtenOffObligationUnits' })).toBe(total - active)
	})
})

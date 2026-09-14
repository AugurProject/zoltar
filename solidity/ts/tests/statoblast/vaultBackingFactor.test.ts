import { statoblast_interfaces_ISecurityPool_ISecurityPool } from '../../types/contractArtifact'
import { describe, test } from 'bun:test'
import assert from '../../testSupport/simulator/utils/assert'
import { useStatoblastVaultAccountingFixture } from './fixture'
import { createCompleteSet, getSecurityVault, getTotalCapacityOwnershipAttoRep, getShareTokenSupplyAttoShares, redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient } from '../../testSupport/simulator/utils/clients'

describe('Vault backing factor adjustment', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const adjust = async (factor: bigint) => {
		const { client, securityPoolAddresses } = fixture
		const hash = await client.writeContract({ address: securityPoolAddresses.securityPool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'adjustVaultBackingFactor', args: [factor] })
		const receipt = await client.waitForTransactionReceipt({ hash })
		assert.strictEqual(receipt.status, 'success')
	}

	test('adjusts the whole vault in both directions without transferring REP', async () => {
		const { client, securityPoolAddresses, repDeposit, getVaultRepClaim } = fixture
		const pool = securityPoolAddresses.securityPool
		const walletBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await adjust(20_000n)
		assert.strictEqual((await getSecurityVault(client, pool, client.account.address)).capacityOwnershipAttoRep, repDeposit / 2n)
		assert.strictEqual(await getTotalCapacityOwnershipAttoRep(client, pool), repDeposit / 2n)
		assert.strictEqual(await getVaultRepClaim(client.account.address), repDeposit)
		await adjust(10_000n)
		assert.strictEqual((await getSecurityVault(client, pool, client.account.address)).capacityOwnershipAttoRep, repDeposit)
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), walletBefore)
	})

	test('rejects changes after vault admission closes', async () => {
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await assert.rejects(adjust(20_000n), /Vault admission closed/)
	})

	test('rejects invalid factors, zero capacity, and empty vaults', async () => {
		await assert.rejects(adjust(9_999n), /Backing factor below minimum/)
		await assert.rejects(adjust(2n ** 256n - 1n), /Capacity must be positive/)
		const outsider = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[1])
		await assert.rejects(outsider.writeContract({ address: fixture.securityPoolAddresses.securityPool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'adjustVaultBackingFactor', args: [20_000n] }), /Vault has no REP backing/)
	})

	test('cannot reallocate committed capacity in either direction', async () => {
		await adjust(20_000n)
		const { client, securityPoolAddresses, repDeposit } = fixture
		await createCompleteSet(client, securityPoolAddresses.securityPool, repDeposit / 10n)
		await assert.rejects(adjust(30_000n), /Capacity committed/)
		await assert.rejects(adjust(10_000n), /Capacity committed/)
		assert.strictEqual((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).capacityOwnershipAttoRep, repDeposit / 2n)
		await redeemCompleteSet(client, securityPoolAddresses.securityPool, await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool))
		const feesBefore = (await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).claimableFeesAttoEth
		await adjust(10_000n)
		const adjusted = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		assert.strictEqual(adjusted.capacityOwnershipAttoRep, repDeposit)
		assert.ok(adjusted.claimableFeesAttoEth >= feesBefore, 'adjustment preserves accrued fees')
	})
})

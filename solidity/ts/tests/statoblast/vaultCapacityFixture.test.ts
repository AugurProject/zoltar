import { describe, test } from 'bun:test'
import assert from '../../testSupport/simulator/utils/assert'
import { useStatoblastVaultAccountingFixture } from './fixture'
import { setVaultCapacityFixture } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { getSecurityVault, updateVaultFees } from '../../testSupport/simulator/utils/contracts/securityPool'
import { statoblast_interfaces_ISecurityPool_ISecurityPool } from '../../types/contractArtifact'

describe('explicit vault capacity fixture', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	test.each([0n, fixture.repDeposit / 4n, fixture.repDeposit / 4n + 1n])('keeps synthetic capacity across fee checkpoints: %s', async capacity => {
		const { client, mockWindow, securityPoolAddresses } = fixture
		const pool = securityPoolAddresses.securityPool
		await setVaultCapacityFixture(client, mockWindow, securityPoolAddresses.openOraclePriceCoordinator, client.account.address, capacity)
		await updateVaultFees(client, pool, client.account.address)
		assert.strictEqual((await getSecurityVault(client, pool, client.account.address)).underwritingLimitAttoEth, capacity)
		assert.strictEqual(await client.readContract({ address: pool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'getVaultUnderwritingLimitAttoEth', args: [client.account.address] }), capacity)
		assert.strictEqual(await client.readContract({ address: pool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'totalUnderwritingLimitAttoEth' }), capacity)
	})
})

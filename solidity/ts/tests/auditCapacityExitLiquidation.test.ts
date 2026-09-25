import { OperationType, requestPriceIfNeededAndStageOperation } from '../testSupport/simulator/utils/contracts/statoblast'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../testSupport/simulator/utils/constants'
import { createCompleteSet, depositRepToVault, getSecurityVault, getSettlementCollateralAttoEth, getShareTokenSupplyAttoShares, redeemCompleteSet } from '../testSupport/simulator/utils/contracts/securityPool'
import { createWriteClient } from '../testSupport/simulator/utils/clients'
import { approveToken, getERC20Balance } from '../testSupport/simulator/utils/utilities'
import { addressString } from '../testSupport/simulator/utils/bigint'
import assert from '../testSupport/simulator/utils/assert'
import { describe, test } from 'bun:test'
import { statoblast_SecurityPool_SecurityPool } from '../types/contractArtifact'
import { useStatoblastVaultAccountingFixture } from './statoblast/fixture'

describe('Assigned coverage during an unrelated vault exit', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	test('an unallocated vault can withdraw without moving the underwriting vault obligation', async () => {
		const { client, mockWindow, securityPoolAddresses, repDeposit, transferRepToAddress, getVaultRepClaim } = fixture
		const pool = securityPoolAddresses.securityPool
		const exiting = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		await transferRepToAddress(client, exiting.account.address, repDeposit)
		await approveToken(exiting, addressString(GENESIS_REPUTATION_TOKEN), pool)
		await depositRepToVault(exiting, pool, repDeposit)
		await client.writeContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'setCoverageOffer', args: [true, repDeposit, 10_000n] })
		await createCompleteSet(client, pool, repDeposit / 4n)
		const before = await getSecurityVault(client, pool, client.account.address)
		const obligation = () => client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'getVaultOpenInterestAttoEth', args: [client.account.address] })
		const beforeDebt = await obligation()
		const walletBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), exiting.account.address)
		assert.strictEqual((await getSecurityVault(client, pool, exiting.account.address)).obligationUnits, 0n)
		await requestPriceIfNeededAndStageOperation(exiting, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.WithdrawRep, exiting.account.address, repDeposit)
		assert.strictEqual(await getVaultRepClaim(exiting.account.address), 0n)
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), exiting.account.address), walletBefore + repDeposit)
		assert.strictEqual((await getSecurityVault(client, pool, client.account.address)).obligationUnits, before.obligationUnits)
		assert.ok((await obligation()) <= beforeDebt, 'withdrawing unrelated REP cannot increase assigned obligation')
		assert.strictEqual(await getVaultRepClaim(client.account.address), repDeposit)
		await redeemCompleteSet(client, pool, await getShareTokenSupplyAttoShares(client, pool))
		assert.strictEqual(await getSettlementCollateralAttoEth(client, pool), 0n)
	})
})

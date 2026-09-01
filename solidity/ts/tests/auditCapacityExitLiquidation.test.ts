import { describe, test } from 'bun:test'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool } from '../types/contractArtifact'
import { createCompleteSet, getSecurityVault, getSettlementCollateralAttoEth, getShareTokenSupplyAttoShares, redeemCompleteSet } from '../testSupport/simulator/utils/contracts/securityPool'
import { useStatoblastVaultAccountingFixture } from './statoblast/fixture'

const BPS_DENOMINATOR = 10_000n
const MAX_UINT256 = 2n ** 256n - 1n

describe('Audit PoC: capacity-exit liquidation', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const { addressString, approveToken, assert, createWriteClient, decodeEventLog, depositRepToVault, GENESIS_REPUTATION_TOKEN, getERC20Balance, getVaultRepClaim, OperationType, repDeposit, requestPriceIfNeededAndStageOperation, statoblastSecurityMultiplierBps, TEST_ADDRESSES, transferRepToAddress } = fixture

	test('a capacity provider cannot exit while doing so would reassign live open interest to another vault', async () => {
		const { client, mockWindow, securityPoolAddresses } = fixture
		const securityPool = securityPoolAddresses.securityPool
		const coordinator = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		const exitVault = createWriteClient(mockWindow, TEST_ADDRESSES[1], 0)
		const receiverVault = createWriteClient(mockWindow, TEST_ADDRESSES[2], 0)
		const receiverBacking = repDeposit * 10n
		const exitWalletBeforeSetup = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), exitVault.account.address)

		await transferRepToAddress(client, exitVault.account.address, repDeposit)
		await transferRepToAddress(client, receiverVault.account.address, receiverBacking)
		for (const vaultClient of [exitVault, receiverVault]) {
			await approveToken(vaultClient, addressString(GENESIS_REPUTATION_TOKEN), securityPool)
		}
		await depositRepToVault(exitVault, securityPool, repDeposit)
		await depositRepToVault(receiverVault, securityPool, receiverBacking, MAX_UINT256)

		const victimBefore = await getSecurityVault(client, securityPool, client.account.address)
		const exitBefore = await getSecurityVault(client, securityPool, exitVault.account.address)
		const receiverBefore = await getSecurityVault(client, securityPool, receiverVault.account.address)
		assert.strictEqual(await getVaultRepClaim(client.account.address), repDeposit, 'victim should begin with its full REP deposit')
		assert.strictEqual(victimBefore.capacityOwnershipAttoRep, repDeposit, 'victim should use the minimum permitted deposit health factor')
		assert.strictEqual(exitBefore.capacityOwnershipAttoRep, repDeposit, 'exit vault should initially provide half of the live capacity')
		assert.strictEqual(receiverBefore.capacityOwnershipAttoRep, 0n, 'receiver backing should not dilute open-interest allocation before the attack')

		const temporaryOpenInterest = repDeposit
		const receiverEthBeforeAttack = await receiverVault.getBalance({ address: receiverVault.account.address })
		await createCompleteSet(receiverVault, securityPool, temporaryOpenInterest)
		const mintingCapacity = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'getCurrentMintingCapacityAttoEth',
		})
		assert.strictEqual(mintingCapacity, temporaryOpenInterest, 'the attack should mint exactly the aggregate capacity')
		const victimOpenInterestBeforeExit = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'getVaultOpenInterestAttoEth',
			args: [client.account.address],
		})
		assert.strictEqual(victimOpenInterestBeforeExit * statoblastSecurityMultiplierBps, repDeposit * BPS_DENOMINATOR, 'victim should be exactly healthy before the attacker removes capacity')

		const withdrawalLogStartBlock = (await client.getBlockNumber()) + 1n
		await requestPriceIfNeededAndStageOperation(exitVault, coordinator, OperationType.WithdrawRep, exitVault.account.address, repDeposit)
		const withdrawalExecution = (await client.getLogs({ address: coordinator, fromBlock: withdrawalLogStartBlock })).map(log => decodeEventLog({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, data: log.data, topics: log.topics })).find(log => log.eventName === 'ExecutedStagedOperation')
		if (withdrawalExecution === undefined) throw new Error('missing withdrawal execution event')
		assert.strictEqual(withdrawalExecution.args.success, false, 'capacity exit should fail while its capacity secures live open interest')
		assert.strictEqual(withdrawalExecution.args.errorMessage, 'Capacity committed', 'capacity exit should expose the live-open-interest invariant')
		assert.strictEqual(await getVaultRepClaim(exitVault.account.address), repDeposit, 'failed capacity exit should retain its REP commitment')
		assert.strictEqual((await getSecurityVault(client, securityPool, exitVault.account.address)).capacityOwnershipAttoRep, repDeposit, 'failed capacity exit should retain its capacity commitment')

		const victimOpenInterestAfterExit = await client.readContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'getVaultOpenInterestAttoEth',
			args: [client.account.address],
		})
		assert.strictEqual(victimOpenInterestAfterExit, victimOpenInterestBeforeExit, 'failed capacity exit should not reassign any open interest')
		assert.strictEqual(victimOpenInterestAfterExit * statoblastSecurityMultiplierBps, repDeposit * BPS_DENOMINATOR, 'victim should remain healthy after the rejected exit')

		const receiverWalletBeforeLiquidation = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), receiverVault.account.address)
		const liquidationLogStartBlock = (await client.getBlockNumber()) + 1n
		await requestPriceIfNeededAndStageOperation(receiverVault, coordinator, OperationType.Liquidation, client.account.address, victimOpenInterestAfterExit)
		const liquidationExecution = (await client.getLogs({ address: coordinator, fromBlock: liquidationLogStartBlock })).map(log => decodeEventLog({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, data: log.data, topics: log.topics })).find(log => log.eventName === 'ExecutedStagedOperation')
		if (liquidationExecution === undefined) throw new Error('missing liquidation execution event')
		assert.strictEqual(liquidationExecution.args.success, false, 'the unchanged healthy victim should not be liquidatable')
		const victimClaimAfterLiquidation = await getVaultRepClaim(client.account.address)
		const receiverClaimAfterLiquidation = await getVaultRepClaim(receiverVault.account.address)
		assert.strictEqual(victimClaimAfterLiquidation, repDeposit, 'rejected liquidation should preserve every victim REP')
		assert.strictEqual(receiverClaimAfterLiquidation, receiverBacking, 'rejected liquidation should not award victim REP to the receiver')

		const completeSetShares = await getShareTokenSupplyAttoShares(client, securityPool)
		await redeemCompleteSet(receiverVault, securityPool, completeSetShares)
		assert.strictEqual(await getSettlementCollateralAttoEth(client, securityPool), 0n, 'attacker should recover all temporary complete-set collateral')
		const receiverEthAfterRedemption = await receiverVault.getBalance({ address: receiverVault.account.address })
		assert.ok(receiverEthAfterRedemption > receiverEthBeforeAttack - temporaryOpenInterest / 100n, 'attacker should recover over 99% of temporary ETH despite normal retention and transaction fees')

		await requestPriceIfNeededAndStageOperation(exitVault, coordinator, OperationType.WithdrawRep, exitVault.account.address, repDeposit)
		assert.strictEqual(await getVaultRepClaim(exitVault.account.address), 0n, 'capacity provider should be able to exit after open interest is removed')
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), exitVault.account.address), exitWalletBeforeSetup + repDeposit, 'capacity provider should recover its full REP principal after open interest is removed')

		await requestPriceIfNeededAndStageOperation(receiverVault, coordinator, OperationType.WithdrawRep, receiverVault.account.address, receiverClaimAfterLiquidation)
		const receiverWalletAfterAttack = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), receiverVault.account.address)
		assert.strictEqual(await getVaultRepClaim(receiverVault.account.address), 0n, 'backing-only receiver should be able to exit after open interest is removed')
		assert.strictEqual(receiverWalletAfterAttack, receiverWalletBeforeLiquidation + receiverBacking, 'rejected attack should return only the receiver principal and no victim REP')
	})
})

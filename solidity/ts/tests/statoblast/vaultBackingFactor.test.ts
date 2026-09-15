import { isIgnorableLogDecodeError } from '../logDecodeErrors'
import { decodeEventLog } from '@zoltar/core-shared/evm/ethereum'
import { OperationType, getRequestPriceCostAttoEth, requestPriceIfNeededAndStageOperationWithInitialReportPrice, getIsPriceValid, getPendingReportId, requestPriceIfNeededAndStageOperation } from '../../testSupport/simulator/utils/contracts/statoblast'
import { manipulatePriceOracle, handleOracleReporting } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { statoblast_interfaces_ISecurityPool_ISecurityPool, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, IERC20_IERC20 } from '../../types/contractArtifact'
import { describe, test } from 'bun:test'
import assert from '../../testSupport/simulator/utils/assert'
import { useStatoblastVaultAccountingFixture } from './fixture'
import { depositRepToVault, updateVaultFees, createCompleteSet, getSecurityVault, getTotalCapacityOwnershipAttoRep, getShareTokenSupplyAttoShares, redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { approveToken, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient } from '../../testSupport/simulator/utils/clients'

describe('Vault backing factor adjustment', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const adjust = async (factor: bigint) => {
		const { client, securityPoolAddresses } = fixture
		if (!(await getIsPriceValid(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer))) await manipulatePriceOracle(client, fixture.mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)
		const hash = await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.AdjustVaultBackingFactor, client.account.address, factor)
		const receipt = await client.waitForTransactionReceipt({ hash })
		assert.strictEqual(receipt.status, 'success')
		const operationId = await client.readContract({ address: securityPoolAddresses.priceOracleManagerAndOperatorQueuer, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'stagedOperationCounter' })
		for (const log of receipt.logs) {
			if (log.address.toLowerCase() !== securityPoolAddresses.priceOracleManagerAndOperatorQueuer.toLowerCase()) continue
			try {
				const decoded = decodeEventLog({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, data: log.data, topics: log.topics })
				if (decoded.eventName !== 'ExecutedStagedOperation' || decoded.args.operationId !== operationId) continue
				if (!decoded.args.success) throw new Error(decoded.args.errorMessage)
				return
			} catch (error) {
				if (!isIgnorableLogDecodeError(error)) throw error
			}
		}
		throw new Error('Expected immediate operation execution')
	}

	test('uses the pool security multiplier as the inclusive absolute target minimum', async () => {
		await assert.rejects(adjust(19_999n), /Backing factor below minimum/)
		await adjust(20_000n)
		assert.strictEqual((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.client.account.address)).capacityOwnershipAttoRep, fixture.repDeposit)
		await adjust(30_000n)
		assert.strictEqual((await getSecurityVault(fixture.client, fixture.securityPoolAddresses.securityPool, fixture.client.account.address)).capacityOwnershipAttoRep, (fixture.repDeposit * 2n) / 3n)
		assert.strictEqual(await fixture.client.readContract({ address: fixture.securityPoolAddresses.securityPool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'getCurrentMintingCapacityAttoEth' }), fixture.repDeposit / 3n)
	})

	test('first deposits reject targets below the pool minimum and accept equality', async () => {
		const { client, mockWindow, securityPoolAddresses, repDeposit } = fixture
		const vault = createWriteClient(mockWindow, TEST_ADDRESSES[2])
		await fixture.transferRepToAddress(client, vault.account.address, repDeposit)
		await approveToken(vault, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
		await assert.rejects(depositRepToVault(vault, securityPoolAddresses.securityPool, repDeposit, 19_999n), /Target below pool minimum/)
		assert.strictEqual(await client.readContract({ address: securityPoolAddresses.securityPool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'vaultTargetBackingFactorBps', args: [vault.account.address] }), 0n)
		await depositRepToVault(vault, securityPoolAddresses.securityPool, repDeposit, 20_000n)
		assert.strictEqual((await getSecurityVault(client, securityPoolAddresses.securityPool, vault.account.address)).capacityOwnershipAttoRep, repDeposit)
	})

	test('initializes the target on the first deposit and persists a later change', async () => {
		const target = () => fixture.client.readContract({ address: fixture.securityPoolAddresses.securityPool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'vaultTargetBackingFactorBps', args: [fixture.client.account.address] })
		assert.strictEqual(await target(), 20_000n)
		await adjust(40_000n)
		assert.strictEqual(await target(), 40_000n)
	})

	test('uses the saved target for deposits and rejects deposit-time target changes', async () => {
		await adjust(40_000n)
		const { client, securityPoolAddresses, repDeposit } = fixture
		await assert.rejects(depositRepToVault(client, securityPoolAddresses.securityPool, repDeposit, 60_000n), /Use saved vault target/)
		await depositRepToVault(client, securityPoolAddresses.securityPool, repDeposit, 40_000n)
		assert.strictEqual((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).capacityOwnershipAttoRep, repDeposit)
	})

	test('applies a saved target automatically at a safe vault checkpoint after backing changes', async () => {
		await adjust(40_000n)
		const { client, securityPoolAddresses, repDeposit } = fixture
		const hash = await client.writeContract({ address: addressString(GENESIS_REPUTATION_TOKEN), abi: IERC20_IERC20.abi, functionName: 'transfer', args: [securityPoolAddresses.securityPool, repDeposit] })
		await client.waitForTransactionReceipt({ hash })
		assert.strictEqual((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).capacityOwnershipAttoRep, repDeposit / 2n)
		await updateVaultFees(client, securityPoolAddresses.securityPool, client.account.address)
		assert.strictEqual((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).capacityOwnershipAttoRep, repDeposit)
	})

	test.each(['committed', 'admission closed'] as const)('fee checkpoints preserve saved target and capacity while %s', async boundary => {
		await adjust(40_000n)
		const { client, mockWindow, securityPoolAddresses, repDeposit, questionData } = fixture
		const pool = securityPoolAddresses.securityPool
		if (boundary === 'committed') await createCompleteSet(client, pool, 10n ** 18n)
		else await mockWindow.setTime(questionData.endTime)
		const before = await getSecurityVault(client, pool, client.account.address)
		await client.waitForTransactionReceipt({ hash: await client.writeContract({ address: addressString(GENESIS_REPUTATION_TOKEN), abi: IERC20_IERC20.abi, functionName: 'transfer', args: [pool, repDeposit] }) })
		await updateVaultFees(client, pool, client.account.address)
		assert.strictEqual((await getSecurityVault(client, pool, client.account.address)).capacityOwnershipAttoRep, before.capacityOwnershipAttoRep)
		assert.strictEqual(await client.readContract({ address: pool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'vaultTargetBackingFactorBps', args: [client.account.address] }), 40_000n)
	})

	test.each([30_000n, 2n ** 256n - 1n])('supersedes an older manual adjustment even if its replacement fails (%s)', async newTarget => {
		const { client, securityPoolAddresses, mockWindow, repDeposit } = fixture
		const manager = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		for (let index = 0; index < 4; index++) await requestPriceIfNeededAndStageOperation(client, manager, OperationType.WithdrawRep, client.account.address, repDeposit / 100n)
		await requestPriceIfNeededAndStageOperation(client, manager, OperationType.AdjustVaultBackingFactor, client.account.address, 40_000n)
		const oldId = await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'stagedOperationCounter' })
		await handleOracleReporting(client, mockWindow, manager, 10n ** 18n)
		if (newTarget === 30_000n) await adjust(newTarget)
		else await assert.rejects(adjust(newTarget), /Capacity must be positive/)
		await assert.rejects(client.writeContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'executeStagedOperation', args: [oldId] }), /Staged operation unavailable/)
		assert.strictEqual(await client.readContract({ address: securityPoolAddresses.securityPool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'vaultTargetBackingFactorBps', args: [client.account.address] }), newTarget === 30_000n ? 30_000n : 20_000n)
	})

	test('replaces an automatic queued target without occupying another settlement slot', async () => {
		const { client, securityPoolAddresses, mockWindow } = fixture
		const manager = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		await requestPriceIfNeededAndStageOperation(client, manager, OperationType.AdjustVaultBackingFactor, client.account.address, 40_000n)
		await requestPriceIfNeededAndStageOperation(client, manager, OperationType.AdjustVaultBackingFactor, client.account.address, 30_000n)
		assert.strictEqual(await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'getActiveStagedOperationCount' }), 1n)
		assert.strictEqual(await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'getPendingSettlementOperationCount' }), 1n)
		await handleOracleReporting(client, mockWindow, manager, 10n ** 18n)
		assert.strictEqual(await client.readContract({ address: securityPoolAddresses.securityPool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'vaultTargetBackingFactorBps', args: [client.account.address] }), 30_000n)
	})

	test('keeps the current target until an on-chain queued change executes', async () => {
		const { client, securityPoolAddresses, mockWindow, repDeposit } = fixture
		const pool = securityPoolAddresses.securityPool
		const target = () => client.readContract({ address: pool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'vaultTargetBackingFactorBps', args: [client.account.address] })
		const before = await target()
		await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, OperationType.AdjustVaultBackingFactor, client.account.address, 40_000n)
		assert.ok((await getPendingReportId(client, securityPoolAddresses.priceOracleManagerAndOperatorQueuer)) > 0n)
		assert.strictEqual(await target(), before)
		await handleOracleReporting(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, 10n ** 18n)
		assert.strictEqual(await target(), 40_000n)
		assert.strictEqual((await getSecurityVault(client, pool, client.account.address)).capacityOwnershipAttoRep, repDeposit / 2n)
	})

	test('rejects a capacity increase that would make a previously healthy vault undercollateralized', async () => {
		await adjust(40_000n)
		const { client, securityPoolAddresses, mockWindow, repDeposit } = fixture
		const otherVault = createWriteClient(mockWindow, TEST_ADDRESSES[2])
		await fixture.transferRepToAddress(client, otherVault.account.address, repDeposit)
		await approveToken(otherVault, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
		await depositRepToVault(otherVault, securityPoolAddresses.securityPool, repDeposit)
		await createCompleteSet(client, securityPoolAddresses.securityPool, (repDeposit * 7n) / 10n)
		await manipulatePriceOracle(client, mockWindow, securityPoolAddresses.priceOracleManagerAndOperatorQueuer, 2n * 10n ** 18n)
		const oldOpenInterest = await client.readContract({ address: securityPoolAddresses.securityPool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'getVaultOpenInterestAttoEth', args: [client.account.address] })
		assert.ok(oldOpenInterest * 4n <= repDeposit, 'the current vault remains healthy before reallocating open interest')
		await assert.rejects(adjust(20_000n), /Vault backing insufficient/)
		assert.strictEqual(await client.readContract({ address: securityPoolAddresses.securityPool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'vaultTargetBackingFactorBps', args: [client.account.address] }), 40_000n)
		assert.strictEqual((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).capacityOwnershipAttoRep, repDeposit / 2n)
	})

	test('allows a fully collateralized capacity increase with settlement collateral committed', async () => {
		await adjust(40_000n)
		const { client, securityPoolAddresses, repDeposit } = fixture
		await createCompleteSet(client, securityPoolAddresses.securityPool, repDeposit / 10n)
		await adjust(20_000n)
		assert.strictEqual((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).capacityOwnershipAttoRep, repDeposit)
	})

	test('consumes a queued change that becomes unsafe without replacing the saved target', async () => {
		await adjust(40_000n)
		const { client, securityPoolAddresses, repDeposit, mockWindow } = fixture
		const manager = securityPoolAddresses.priceOracleManagerAndOperatorQueuer
		await createCompleteSet(client, securityPoolAddresses.securityPool, repDeposit / 5n)
		const validUntil = await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'lastSettlementTimestamp' })
		await mockWindow.setTime(validUntil + 3601n)
		await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, manager, OperationType.AdjustVaultBackingFactor, client.account.address, 20_000n, 300n, 3n * 10n ** 18n, await getRequestPriceCostAttoEth(client, manager))
		assert.ok((await getPendingReportId(client, manager)) > 0n)
		await handleOracleReporting(client, mockWindow, manager, 3n * 10n ** 18n)
		assert.strictEqual(await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'getActiveStagedOperationCount' }), 0n)
		assert.strictEqual(await client.readContract({ address: securityPoolAddresses.securityPool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'vaultTargetBackingFactorBps', args: [client.account.address] }), 40_000n)
		assert.strictEqual((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).capacityOwnershipAttoRep, repDeposit / 2n)
	})

	test('adjusts the whole vault in both directions without transferring REP', async () => {
		const { client, securityPoolAddresses, repDeposit, getVaultRepClaim } = fixture
		const pool = securityPoolAddresses.securityPool
		const walletBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await adjust(40_000n)
		assert.strictEqual((await getSecurityVault(client, pool, client.account.address)).capacityOwnershipAttoRep, repDeposit / 2n)
		assert.strictEqual(await getTotalCapacityOwnershipAttoRep(client, pool), repDeposit / 2n)
		assert.strictEqual(await getVaultRepClaim(client.account.address), repDeposit)
		await adjust(20_000n)
		assert.strictEqual((await getSecurityVault(client, pool, client.account.address)).capacityOwnershipAttoRep, repDeposit)
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), walletBefore)
	})

	test('rejects changes after vault admission closes', async () => {
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await manipulatePriceOracle(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.priceOracleManagerAndOperatorQueuer, 10n ** 18n)
		await assert.rejects(adjust(40_000n), /Vault admission closed/)
	})

	test('rejects invalid factors, zero capacity, and empty vaults', async () => {
		await assert.rejects(adjust(9_999n), /Backing factor below minimum/)
		await assert.rejects(adjust(2n ** 256n - 1n), /Capacity must be positive/)
		const outsider = createWriteClient(fixture.mockWindow, TEST_ADDRESSES[1])
		await assert.rejects(outsider.writeContract({ address: fixture.securityPoolAddresses.securityPool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'adjustVaultBackingFactor', args: [outsider.account.address, 40_000n] }), /Unauthorized/)
	})

	test('rejects committed capacity reductions without changing the saved target', async () => {
		await adjust(40_000n)
		const { client, securityPoolAddresses, repDeposit } = fixture
		await createCompleteSet(client, securityPoolAddresses.securityPool, repDeposit / 10n)
		await assert.rejects(adjust(60_000n), /Capacity committed/)
		assert.strictEqual((await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).capacityOwnershipAttoRep, repDeposit / 2n)
		await redeemCompleteSet(client, securityPoolAddresses.securityPool, await getShareTokenSupplyAttoShares(client, securityPoolAddresses.securityPool))
		const feesBefore = (await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)).claimableFeesAttoEth
		await adjust(20_000n)
		const adjusted = await getSecurityVault(client, securityPoolAddresses.securityPool, client.account.address)
		assert.strictEqual(adjusted.capacityOwnershipAttoRep, repDeposit)
		assert.ok(adjusted.claimableFeesAttoEth >= feesBefore, 'adjustment preserves accrued fees')
	})
})

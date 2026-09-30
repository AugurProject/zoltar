import { isIgnorableLogDecodeError } from '../logDecodeErrors'
import { decodeEventLog, zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import { OperationType, getRequestPriceCostAttoEth, requestPriceIfNeededAndStageOperationWithInitialReportPrice, getIsPriceValid, getPendingReportId, requestPriceIfNeededAndStageOperation } from '../../testSupport/simulator/utils/contracts/statoblast'
import { manipulatePriceOracle, handleOracleReporting } from '../../testSupport/simulator/utils/contracts/statoblastTestUtils'
import { statoblast_interfaces_ISecurityPool_ISecurityPool, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, IERC20_IERC20 } from '../../types/contractArtifact'
import { describe, test } from 'bun:test'
import assert from '../../testSupport/simulator/utils/assert'
import { useStatoblastVaultAccountingFixture } from './fixture'
import { depositRepToVault, updateVaultFees, createCompleteSet, getSecurityVault, getTotalUnderwritingLimitAttoEth, getShareTokenSupplyAttoShares, redeemCompleteSet } from '../../testSupport/simulator/utils/contracts/securityPool'
import { approveToken, getERC20Balance } from '../../testSupport/simulator/utils/utilities'
import { GENESIS_REPUTATION_TOKEN, TEST_ADDRESSES } from '../../testSupport/simulator/utils/constants'
import { addressString } from '../../testSupport/simulator/utils/bigint'
import { createWriteClient } from '../../testSupport/simulator/utils/clients'

describe('Vault standing underwriting limit adjustment', () => {
	const fixture = useStatoblastVaultAccountingFixture()
	const adjust = async (factor: bigint, client = fixture.client) => {
		const { securityPoolAddresses } = fixture
		if (!(await getIsPriceValid(client, securityPoolAddresses.openOraclePriceCoordinator))) await manipulatePriceOracle(client, fixture.mockWindow, securityPoolAddresses.openOraclePriceCoordinator)
		const hash = await requestPriceIfNeededAndStageOperation(client, securityPoolAddresses.openOraclePriceCoordinator, OperationType.SetVaultUnderwritingLimit, client.account.address, factor)
		const receipt = await client.waitForTransactionReceipt({ hash })
		assert.strictEqual(receipt.status, 'success')
		const operationId = await client.readContract({ address: securityPoolAddresses.openOraclePriceCoordinator, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'stagedOperationCounter' })
		for (const log of receipt.logs) {
			if (log.address.toLowerCase() !== securityPoolAddresses.openOraclePriceCoordinator.toLowerCase()) continue
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

	const unit = 10n ** 18n
	const readLimit = async (client = fixture.client) => client.readContract({ address: fixture.securityPoolAddresses.securityPool, abi: statoblast_interfaces_ISecurityPool_ISecurityPool.abi, functionName: 'getVaultUnderwritingLimitAttoEth', args: [client.account.address] })
	const mint = async (amount: bigint) => {
		await createCompleteSet(fixture.client, fixture.securityPoolAddresses.securityPool, amount)
	}

	test('checks the full limit at the inclusive backing boundary', async () => {
		await adjust(fixture.repDeposit / 2n)
		await assert.rejects(adjust(fixture.repDeposit / 2n + 1n), /Vault backing insufficient/)
		assert.strictEqual(await readLimit(), fixture.repDeposit / 2n)
		await adjust(30n * unit)
		assert.strictEqual(await getTotalUnderwritingLimitAttoEth(fixture.client, fixture.securityPoolAddresses.securityPool), 30n * unit)
	})

	test('first REP deposits preserve a zero commitment', async () => {
		const { client, mockWindow, securityPoolAddresses, repDeposit } = fixture
		const vault = createWriteClient(mockWindow, TEST_ADDRESSES[2])
		await fixture.transferRepToAddress(client, vault.account.address, repDeposit)
		await approveToken(vault, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddresses.securityPool)
		await assert.rejects(depositRepToVault(vault, securityPoolAddresses.securityPool, repDeposit, 19_999n), /Target below pool minimum/)
		await depositRepToVault(vault, securityPoolAddresses.securityPool, repDeposit, 20_000n)
		assert.strictEqual(await readLimit(vault), 0n)
	})

	test('records dust limits exactly and permits an empty-pool exit', async () => {
		assert.strictEqual(await readLimit(), 0n)
		await adjust(1n)
		assert.strictEqual(await readLimit(), 1n)
		await adjust(0n)
		assert.strictEqual(await readLimit(), 0n)
		await assert.rejects(adjust(2n ** 256n - 1n))
		assert.strictEqual(await readLimit(), 0n)
	})

	test('deposits cannot change an existing owner commitment', async () => {
		await adjust(40n * unit)
		const { client, securityPoolAddresses, repDeposit } = fixture
		await depositRepToVault(client, securityPoolAddresses.securityPool, repDeposit, 60_000n)
		assert.strictEqual(await readLimit(), 40n * unit)
		assert.strictEqual(await fixture.getVaultRepClaim(client.account.address), 2n * repDeposit)
	})

	test.each(['empty', 'committed', 'admission closed'] as const)('donations and fee checkpoints preserve authorization while %s', async boundary => {
		await adjust(40n * unit)
		const { client, mockWindow, securityPoolAddresses, repDeposit, questionData } = fixture
		const pool = securityPoolAddresses.securityPool
		if (boundary === 'committed') await mint(unit)
		else if (boundary === 'admission closed') await mockWindow.setTime(questionData.endTime)
		await client.waitForTransactionReceipt({ hash: await client.writeContract({ address: addressString(GENESIS_REPUTATION_TOKEN), abi: IERC20_IERC20.abi, functionName: 'transfer', args: [pool, repDeposit] }) })
		await updateVaultFees(client, pool, client.account.address)
		assert.strictEqual(await readLimit(), 40n * unit)
	})

	test.each([30n * unit, 2n ** 256n - 1n])('supersedes an older manual limit even if its replacement fails (%s)', async newLimit => {
		const { client, securityPoolAddresses, mockWindow, repDeposit } = fixture
		const manager = securityPoolAddresses.openOraclePriceCoordinator
		for (let index = 0; index < 4; index++) await requestPriceIfNeededAndStageOperation(client, manager, OperationType.WithdrawRep, client.account.address, repDeposit / 100n)
		await requestPriceIfNeededAndStageOperation(client, manager, OperationType.SetVaultUnderwritingLimit, client.account.address, 40n * unit)
		const oldId = await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'stagedOperationCounter' })
		await handleOracleReporting(client, mockWindow, manager, unit)
		if (newLimit === 30n * unit) await adjust(newLimit)
		else await assert.rejects(adjust(newLimit))
		await assert.rejects(client.writeContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'executeStagedOperation', args: [oldId] }), /Staged operation unavailable/)
		assert.strictEqual(await readLimit(), newLimit === 30n * unit ? newLimit : 0n)
	})

	test('replaces an automatic queued limit without occupying another settlement slot', async () => {
		const { client, securityPoolAddresses, mockWindow } = fixture
		const manager = securityPoolAddresses.openOraclePriceCoordinator
		await requestPriceIfNeededAndStageOperation(client, manager, OperationType.SetVaultUnderwritingLimit, client.account.address, 40n * unit)
		await requestPriceIfNeededAndStageOperation(client, manager, OperationType.SetVaultUnderwritingLimit, client.account.address, 30n * unit)
		assert.strictEqual(await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'getActiveStagedOperationCount' }), 1n)
		assert.strictEqual(await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'getPendingSettlementOperationCount' }), 1n)
		assert.strictEqual(await readLimit(), 0n)
		await handleOracleReporting(client, mockWindow, manager, unit)
		assert.strictEqual(await readLimit(), 30n * unit)
	})

	test('keeps the current limit until an on-chain queued change executes', async () => {
		const { client, securityPoolAddresses, mockWindow } = fixture
		const manager = securityPoolAddresses.openOraclePriceCoordinator
		await requestPriceIfNeededAndStageOperation(client, manager, OperationType.SetVaultUnderwritingLimit, client.account.address, 40n * unit)
		assert.ok((await getPendingReportId(client, manager)) > 0n)
		assert.strictEqual(await readLimit(), 0n)
		await handleOracleReporting(client, mockWindow, manager, unit)
		assert.strictEqual(await readLimit(), 40n * unit)
	})

	test('checks full-limit backing even when proportional exposure is small', async () => {
		await adjust(40n * unit)
		await mint(unit)
		await assert.rejects(adjust(fixture.repDeposit), /Vault backing insufficient/)
		assert.strictEqual(await readLimit(), 40n * unit)
	})

	test('allows a fully backed increase with settlement collateral outstanding', async () => {
		await adjust(40n * unit)
		await mint(10n * unit)
		await adjust(60n * unit)
		assert.strictEqual(await readLimit(), 60n * unit)
	})

	test('consumes a queued increase that becomes unsafe without replacing the standing limit', async () => {
		await adjust(40n * unit)
		await mint(10n * unit)
		const { client, securityPoolAddresses, mockWindow } = fixture
		const manager = securityPoolAddresses.openOraclePriceCoordinator
		const settledAt = await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'lastSettlementTimestamp' })
		await mockWindow.setTime(settledAt + 3601n)
		await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, manager, OperationType.SetVaultUnderwritingLimit, client.account.address, 100n * unit, 300n, 100n * unit, await getRequestPriceCostAttoEth(client, manager))
		assert.ok((await getPendingReportId(client, manager)) > 0n)
		await handleOracleReporting(client, mockWindow, manager, 100n * unit)
		assert.strictEqual(await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'getActiveStagedOperationCount' }), 0n)
		assert.strictEqual(await readLimit(), 40n * unit)
	})

	test('changes limits in both directions without transferring REP', async () => {
		const { client, securityPoolAddresses, repDeposit, getVaultRepClaim } = fixture
		const walletBefore = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address)
		await adjust(40n * unit)
		assert.strictEqual(await getTotalUnderwritingLimitAttoEth(client, securityPoolAddresses.securityPool), 40n * unit)
		assert.strictEqual(await getVaultRepClaim(client.account.address), repDeposit)
		await adjust(20n * unit)
		assert.strictEqual(await readLimit(), 20n * unit)
		assert.strictEqual(await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), client.account.address), walletBefore)
	})

	test('rejects increases after vault admission closes', async () => {
		await fixture.mockWindow.setTime(fixture.questionData.endTime + 1n)
		await manipulatePriceOracle(fixture.client, fixture.mockWindow, fixture.securityPoolAddresses.openOraclePriceCoordinator, unit)
		await assert.rejects(adjust(40n * unit), /Vault admission closed/)
	})

	test('consumes an empty-vault owner increase with a failed backing check', async () => {
		const { client, mockWindow, securityPoolAddresses } = fixture
		const outsider = createWriteClient(mockWindow, TEST_ADDRESSES[1])
		const manager = securityPoolAddresses.openOraclePriceCoordinator
		await manipulatePriceOracle(client, mockWindow, manager)
		await assert.rejects(adjust(40n * unit, outsider), /Vault backing insufficient/)
		assert.strictEqual(await readLimit(outsider), 0n)
		const operationId = await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'stagedOperationCounter' })
		assert.ok(operationId > 0n)
		const operation = await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'stagedOperations', args: [operationId] })
		assert.strictEqual(operation.operator, zeroAddress)
		assert.strictEqual(await client.readContract({ address: manager, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'getActiveStagedOperationCount' }), 0n)
	})

	test('rejects unsafe reductions and preserves earned fees through redemption and exit', async () => {
		await adjust(40n * unit)
		await mint(10n * unit)
		const { client, securityPoolAddresses } = fixture
		const pool = securityPoolAddresses.securityPool
		await assert.rejects(adjust(9n * unit), /Commitments below collateral/)
		assert.strictEqual(await readLimit(), 40n * unit)
		await redeemCompleteSet(client, pool, await getShareTokenSupplyAttoShares(client, pool))
		const feesBefore = (await getSecurityVault(client, pool, client.account.address)).claimableFeesAttoEth
		await adjust(0n)
		assert.strictEqual(await readLimit(), 0n)
		assert.ok((await getSecurityVault(client, pool, client.account.address)).claimableFeesAttoEth >= feesBefore)
	})
})

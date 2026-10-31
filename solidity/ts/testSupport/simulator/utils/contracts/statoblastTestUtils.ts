import { zeroAddress } from '@zoltar/core-shared/evm/ethereum'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import { AnvilWindowEthereum } from '../../AnvilWindowEthereum'
import { addressString } from '../bigint'
import { formatStorageSlot, getAddressMappingStorageSlot } from '../../../storage'
import { getSecurityPoolAddresses } from './deployStatoblast'
import { GENESIS_REPUTATION_TOKEN, GENESIS_UNIVERSE, STATOBLAST_SECURITY_MULTIPLIER_BPS } from '../constants'
import { approveToken, contractExists, getERC20Balance, requireAddress } from '../utilities'
import { WriteClient, writeContractAndWait } from '../clients'
import assert from '../assert'
import { getIsPriceValid, getLastPrice, getOpenOracleReportMeta, getOpenOracleReportStatus, getPendingReportId, getRequestPriceCostAttoEth, openOracleSettle, OperationType, requestPriceIfNeededAndStageOperationWithInitialReportPrice, requestPriceWithValue } from './statoblast'
import { QuestionOutcome } from '../../types/types'
import { forkZoltarWithOwnEscalationGame } from './securityPoolForker'
import { getTotalTheoreticalSupply } from './zoltar'
import { depositRepToVault, depositToEscalationGame, getRepToken, getSecurityVault, backingUnitsToAttoRep } from './securityPool'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool, statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed } from '../../../../types/contractArtifact'

const PRICE_PRECISION = 10n ** 18n
const DEFAULT_SELF_OPERATION_VALID_FOR_SECONDS = 5n * 60n

export const approveAndDepositRepToVault = async (client: WriteClient, repDeposit: bigint, questionId: bigint, targetHealthFactorBps?: bigint) => {
	const securityPoolAddress = getSecurityPoolAddresses(zeroAddress, GENESIS_UNIVERSE, questionId, STATOBLAST_SECURITY_MULTIPLIER_BPS).securityPool
	assert.ok(await contractExists(client, securityPoolAddress), 'security pool not deployed')

	const startBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	await approveToken(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	await depositRepToVault(client, securityPoolAddress, repDeposit, targetHealthFactorBps)

	const newBalance = await getERC20Balance(client, addressString(GENESIS_REPUTATION_TOKEN), securityPoolAddress)
	assert.strictEqual(newBalance, startBalance + repDeposit, 'Did not deposit rep')
}

export const triggerOwnGameFork = async (client: WriteClient, securityPoolAddress: Address) => {
	const repToken = await getRepToken(client, securityPoolAddress)
	const forkThresholdAttoRep = (((await getTotalTheoreticalSupply(client, repToken)) / 20n) * 10_000n) / STATOBLAST_SECURITY_MULTIPLIER_BPS
	const vault = await getSecurityVault(client, securityPoolAddress, client.account.address)
	const amountAttoRep = await backingUnitsToAttoRep(client, securityPoolAddress, vault.repBackingUnits)
	assert.ok(amountAttoRep >= 2n * forkThresholdAttoRep, 'not enough rep in vault to fork')
	const minRepDeposit = 10n * 10n ** 18n
	const secondEscalationDeposit = amountAttoRep - 2n * forkThresholdAttoRep < minRepDeposit ? amountAttoRep - forkThresholdAttoRep : forkThresholdAttoRep
	await depositToEscalationGame(client, securityPoolAddress, QuestionOutcome.Yes, forkThresholdAttoRep)
	await depositToEscalationGame(client, securityPoolAddress, QuestionOutcome.No, secondEscalationDeposit)
	await forkZoltarWithOwnEscalationGame(client, securityPoolAddress)
}

export const handleOracleReporting = async (client: WriteClient, mockWindow: AnvilWindowEthereum, openOraclePriceCoordinator: Address, forceRepEthPriceTo: bigint) => {
	const pendingReportId = await getPendingReportId(client, openOraclePriceCoordinator)
	if (pendingReportId === 0n) {
		// operation already executed
		return
	}
	assert.ok(pendingReportId > 0, 'Operation is not queued')

	const reportMeta = await getOpenOracleReportMeta(client, pendingReportId)
	const reportStatus = await getOpenOracleReportStatus(client, pendingReportId)
	const expectedAmount1 = reportMeta.exactToken1Report
	const expectedAmount2 = (expectedAmount1 * forceRepEthPriceTo + PRICE_PRECISION - 1n) / PRICE_PRECISION
	const expectedSettledPrice = (expectedAmount2 * PRICE_PRECISION) / expectedAmount1

	assert.strictEqual(reportStatus.currentAmount1, expectedAmount1, 'pending report should preserve the coordinator-selected token1 amount')
	assert.strictEqual(reportStatus.currentAmount2, expectedAmount2, 'pending report should already encode the forced price before settlement')
	assert.notStrictEqual(reportStatus.currentReporter, zeroAddress, 'pending report should already have an initial reporter')
	const priceFeed = await client.readContract({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, address: openOraclePriceCoordinator, functionName: 'priceFeed' })
	const reporter = priceFeed.toLowerCase() === openOraclePriceCoordinator.toLowerCase() ? priceFeed : (await client.readContract({ abi: statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi, address: priceFeed, functionName: 'reportCandidates', args: [pendingReportId] }))[0]
	assert.strictEqual(reportStatus.currentReporter, reporter, 'pending report should use its isolated reporter')
	assert.strictEqual(reportStatus.initialReporter, reporter, 'pending report should preserve its isolated reporter')
	assert.ok(reportStatus.reportTimestamp > 0n, 'pending report should already have a report timestamp')

	await mockWindow.advanceTime(BigInt(reportMeta.settlementTime) + 1n)

	await openOracleSettle(client, pendingReportId)
	assert.strictEqual(await getLastPrice(client, openOraclePriceCoordinator), expectedSettledPrice, 'settled coordinator price should match the encoded pending report price')
}

export const setVaultCapacityFixture = async (client: WriteClient, mockWindow: AnvilWindowEthereum, openOraclePriceCoordinator: Address, targetVault: Address, amount: bigint, forceRepEthPriceTo: bigint = PRICE_PRECISION) => {
	await manipulatePriceOracle(client, mockWindow, openOraclePriceCoordinator, forceRepEthPriceTo)
	assert.strictEqual(targetVault, client.account.address, 'capacity target must be the caller vault')
	const securityPool = requireAddress(
		await client.readContract({
			abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			address: openOraclePriceCoordinator,
			functionName: 'securityPool',
			args: [],
		}),
		'Coordinator security pool',
	)
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_SecurityPool_SecurityPool.abi,
			address: securityPool,
			functionName: 'updateVaultFees',
			args: [targetVault],
		}),
	)
	const [vault, totalUnderwritingLimitAttoEth, poolAccounting] = await Promise.all([
		getSecurityVault(client, securityPool, targetVault),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'totalUnderwritingLimitAttoEth', args: [] }),
		client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: securityPool, functionName: 'getPoolAccountingSnapshot', args: [] }),
	])
	// Synthetic commitment setup for accounting boundary tests, not an owner-authorized operation.
	// Production-path tests must use setUnderwritingLimit instead.
	const mappingSlot = (slot: bigint) => getAddressMappingStorageSlot(targetVault, slot)
	const storageHex = formatStorageSlot
	await mockWindow.addStateOverrides({
		[securityPool]: {
			stateDiff: {
				[storageHex(1n)]: totalUnderwritingLimitAttoEth - vault.underwritingLimitAttoEth + amount,
				[storageHex(12n)]: poolAccounting.feeEligibleUnderwritingLimitAttoEth - vault.underwritingLimitAttoEth + amount,
				[storageHex(mappingSlot(16n) + 1n)]: amount,
			},
		},
	})
}

export const manipulatePriceOracleAndPerformOperation = async (client: WriteClient, mockWindow: AnvilWindowEthereum, openOraclePriceCoordinator: Address, operation: Exclude<OperationType, OperationType.VaultOperations>, targetVault: Address, amount: bigint, forceRepEthPriceTo: bigint = PRICE_PRECISION) => {
	const costAttoEth = await getRequestPriceCostAttoEth(client, openOraclePriceCoordinator)
	await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, openOraclePriceCoordinator, operation, targetVault, amount, DEFAULT_SELF_OPERATION_VALID_FOR_SECONDS, forceRepEthPriceTo, costAttoEth)
	await handleOracleReporting(client, mockWindow, openOraclePriceCoordinator, forceRepEthPriceTo)
}

export const manipulatePriceOracle = async (client: WriteClient, mockWindow: AnvilWindowEthereum, openOraclePriceCoordinator: Address, forceRepEthPriceTo: bigint = PRICE_PRECISION, requestedInitialAttoWeth = 0n) => {
	if (await getIsPriceValid(client, openOraclePriceCoordinator)) {
		const target = { abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, address: openOraclePriceCoordinator }
		const feed = await client.readContract({ ...target, functionName: 'priceFeed' })
		if (feed.toLowerCase() === openOraclePriceCoordinator.toLowerCase()) await mockWindow.setTime((await client.readContract({ ...target, functionName: 'priceValidUntil' })) + 1n)
	}
	const costAttoEth = await getRequestPriceCostAttoEth(client, openOraclePriceCoordinator)
	await requestPriceWithValue(client, openOraclePriceCoordinator, costAttoEth, forceRepEthPriceTo, requestedInitialAttoWeth)
	await handleOracleReporting(client, mockWindow, openOraclePriceCoordinator, forceRepEthPriceTo)
}

export const canLiquidate = (lastPrice: bigint, underwritingLimitAttoEth: bigint, repClaim: bigint, statoblastSecurityMultiplierBps: bigint) => underwritingLimitAttoEth * lastPrice * statoblastSecurityMultiplierBps > repClaim * PRICE_PRECISION * 10_000n

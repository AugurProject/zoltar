import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { AnvilWindowEthereum } from '../../AnvilWindowEthereum'
import { WriteClient } from '../clients'
import assert from '../assert'
import { getIsPriceValid, getLastPrice, getOpenOracleReportMeta, getOpenOracleReportStatus, getPendingReportId, getRequestPriceCostAttoEth, openOracleSettle, requestPriceWithValue } from './statoblast'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed } from '../../../../types/contractArtifact'

const PRICE_PRECISION = 10n ** 18n

const handleOracleReporting = async (client: WriteClient, mockWindow: AnvilWindowEthereum, openOraclePriceCoordinator: Address, forceRepEthPriceTo: bigint) => {
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

import { openOraclePriceCoordinatorAbi, sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import { assertAnchoredOracleRequestFunding } from '../operations/oracle-request-funding.ts'
import type { PoolSnapshot, OracleRequestFundingSnapshot } from '../operations/types.ts'
import type { ChaosReadClient } from './discovery-client.ts'
import type { CanonicalCoordinatorReportRoute } from './protocol-index.ts'

export async function discoverPoolPriceFeed(client: ChaosReadClient, coordinator: Address, blockNumber: bigint, settlementCollateralAttoEth: bigint, funding: OracleRequestFundingSnapshot, minimumReport: bigint, requestCost: bigint, baseFee: bigint, pendingReportId: bigint, retainedReportIds: readonly bigint[] = []) {
	const priceFeed = await client.readContract({ abi: openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'priceFeed' })
	const shared = !sameAddress(priceFeed, coordinator)
	const oracleExposureAttoEth = shared ? await reportSizingExposure(client, priceFeed, blockNumber) : settlementCollateralAttoEth
	const oracleRequestFunding = shared
		? {
				...funding,
				fixedRequestPriceCostAttoEth: requestCost.toString(),
				collateralToken: getAddress(await client.readContract({ abi: sharedPoolPriceFeedAbi, address: priceFeed, blockNumber, functionName: 'collateralToken' })),
				minimumReportCollateral: (await client.readContract({ abi: sharedPoolPriceFeedAbi, address: priceFeed, blockNumber, functionName: 'minimumReportCollateral' })).toString(),
			}
		: funding
	assertAnchoredOracleRequestFunding({ baseFeePerGas: baseFee.toString(), coordinator: oracleRequestFunding, minimumToken1ReportAttoEth: minimumReport.toString(), requestPriceCostAttoEth: requestCost.toString(), settlementCollateralAttoEth: oracleExposureAttoEth.toString(), subject: `Coordinator ${coordinator}` })
	const reportEscrows: Record<string, Address> | undefined = shared ? {} : undefined
	if (reportEscrows !== undefined) {
		for (const reportId of new Set([pendingReportId, ...retainedReportIds])) {
			if (reportId === 0n) continue
			const candidate = await client.readContract({ abi: sharedPoolPriceFeedAbi, address: priceFeed, blockNumber, functionName: 'reportCandidates', args: [reportId] })
			const escrow = getAddress(candidate[0])
			if (!sameAddress(escrow, zeroAddress)) reportEscrows[reportId.toString()] = escrow
			else if (reportId === pendingReportId) throw new Error('Shared feed pending report has no authenticated escrow')
		}
	}
	return { priceFeed: getAddress(priceFeed), oracleExposureAttoEth: oracleExposureAttoEth.toString(), oracleRequestFunding, ...(reportEscrows === undefined ? {} : { reportEscrows }) }
}

/**
 * A shared feed sizes a new report for the exposure that ordinary growth can
 * reach before it settles: while the accepted price is fresh, that is at least
 * the accepted report's exposure limit.
 */
async function reportSizingExposure(client: ChaosReadClient, priceFeed: Address, blockNumber: bigint) {
	const [exposure, acceptedLimit, priceValid] = await Promise.all([
		client.readContract({ abi: sharedPoolPriceFeedAbi, address: priceFeed, blockNumber, functionName: 'aggregateExposureAttoEth' }),
		client.readContract({ abi: sharedPoolPriceFeedAbi, address: priceFeed, blockNumber, functionName: 'acceptedExposureLimitAttoEth' }),
		client.readContract({ abi: sharedPoolPriceFeedAbi, address: priceFeed, blockNumber, functionName: 'isPriceValid' }),
	])
	return sharedReportSizingExposure(exposure, acceptedLimit, priceValid)
}

/** @internal Tests verify this mirrors `SharedPoolPriceFeed.minimumToken1ReportAttoEth`'s exposure basis. */
export function sharedReportSizingExposure(aggregateExposureAttoEth: bigint, acceptedExposureLimitAttoEth: bigint, priceValid: boolean) {
	return priceValid && acceptedExposureLimitAttoEth > aggregateExposureAttoEth ? acceptedExposureLimitAttoEth : aggregateExposureAttoEth
}

/** Collapse identical question aliases before authenticating canonical report routes. */
export function canonicalPoolReportRoutes(pools: readonly PoolSnapshot[]): CanonicalCoordinatorReportRoute[] {
	const routes = new Map<string, CanonicalCoordinatorReportRoute>()
	for (const pool of pools) {
		const shared = !sameAddress(pool.priceFeed, pool.coordinator)
		if (shared && pool.pendingReportId !== '0' && pool.reportEscrows?.[pool.pendingReportId] === undefined) throw new Error('Shared feed pending report has no authenticated escrow')
		const standalone = pool.pendingReportId === '0' ? [] : [[pool.pendingReportId, pool.priceFeed] as const]
		const candidates = shared ? Object.entries(pool.reportEscrows ?? {}) : standalone
		for (const [reportId, creator] of candidates) {
			const route = { coordinator: creator, pendingReportId: reportId, repToken: pool.repToken }
			routes.set(`${pool.priceFeed.toLowerCase()}:${reportId}:${pool.repToken.toLowerCase()}`, route)
		}
	}
	return [...routes.values()]
}

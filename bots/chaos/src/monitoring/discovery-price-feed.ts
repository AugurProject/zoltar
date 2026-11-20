import { openOraclePriceCoordinatorAbi, sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import { assertAnchoredOracleRequestFunding, oracleRequestPriceCostAttoEth } from '../operations/oracle-request-funding.ts'
import type { PoolSnapshot, OracleRequestFundingSnapshot } from '../operations/types.ts'
import type { ChaosReadClient } from './discovery-client.ts'
import type { CanonicalCoordinatorReportRoute } from './protocol-index.ts'

export async function discoverPoolPriceFeed(client: ChaosReadClient, coordinator: Address, blockNumber: bigint, settlementCollateralAttoEth: bigint, funding: OracleRequestFundingSnapshot, baseFee: bigint, pendingReportId: bigint, retainedReportIds: readonly bigint[] = []) {
	const priceFeed = await client.readContract({ abi: openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'priceFeed' })
	const shared = !sameAddress(priceFeed, coordinator)
	const oracleExposureAttoEth = shared ? await client.readContract({ abi: sharedPoolPriceFeedAbi, address: priceFeed, blockNumber, functionName: 'aggregateExposureAttoEth' }) : settlementCollateralAttoEth
	const oracleRequestFunding = shared
		? {
				...funding,
				settlementBountyMultiplierBps: (await client.readContract({ abi: sharedPoolPriceFeedAbi, address: priceFeed, blockNumber, functionName: 'maxSettlementBaseFeeMultiplierBps' })).toString(),
				collateralToken: getAddress(await client.readContract({ abi: sharedPoolPriceFeedAbi, address: priceFeed, blockNumber, functionName: 'collateralToken' })),
				minimumReportCollateral: (await client.readContract({ abi: sharedPoolPriceFeedAbi, address: priceFeed, blockNumber, functionName: 'minimumReportCollateral' })).toString(),
			}
		: funding
	// Canonical shared-feed stake floors do not inspect BASEFEE. Ordinary calls
	// must work even when the public RPC client's default sender has no funds.
	const minimumReport = await client.readContract({ abi: openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'minimumToken1ReportAttoEth', ...(shared ? {} : { gasPrice: baseFee }) })
	const requestCost = oracleRequestPriceCostAttoEth({ baseFeePerGas: baseFee.toString(), coordinator: oracleRequestFunding })
	assertAnchoredOracleRequestFunding({ baseFeePerGas: baseFee.toString(), coordinator: oracleRequestFunding, minimumToken1ReportAttoEth: minimumReport.toString(), requestPriceCostAttoEth: requestCost, settlementCollateralAttoEth: oracleExposureAttoEth.toString(), subject: `Coordinator ${coordinator}` })
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
	return { minimumToken1ReportAttoEth: minimumReport.toString(), requestPriceCostAttoEth: requestCost, priceFeed: getAddress(priceFeed), oracleExposureAttoEth: oracleExposureAttoEth.toString(), oracleRequestFunding, ...(reportEscrows === undefined ? {} : { reportEscrows }) }
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

import { openOraclePriceCoordinatorAbi, sharedPoolPriceFeedAbi } from '@zoltar/bot-shared/contracts/abi'
import { getAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import { assertAnchoredOracleRequestFunding } from '../operations/oracle-request-funding.ts'
import type { PoolSnapshot, OracleRequestFundingSnapshot } from '../operations/types.ts'
import type { ChaosReadClient } from './discovery-client.ts'
import type { CanonicalCoordinatorReportRoute } from './protocol-index.ts'

export async function discoverPoolPriceFeed(client: ChaosReadClient, coordinator: Address, blockNumber: bigint, settlementCollateralAttoEth: bigint, funding: OracleRequestFundingSnapshot, minimumReport: bigint, requestCost: bigint, baseFee: bigint) {
	const priceFeed = await client.readContract({ abi: openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'priceFeed' })
	const oracleExposureAttoEth = sameAddress(priceFeed, coordinator) ? settlementCollateralAttoEth : await client.readContract({ abi: sharedPoolPriceFeedAbi, address: priceFeed, blockNumber, functionName: 'aggregateExposureAttoEth' })
	assertAnchoredOracleRequestFunding({ baseFeePerGas: baseFee.toString(), coordinator: funding, minimumToken1ReportAttoEth: minimumReport.toString(), requestPriceCostAttoEth: requestCost.toString(), settlementCollateralAttoEth: oracleExposureAttoEth.toString(), subject: `Coordinator ${coordinator}` })
	return { priceFeed: getAddress(priceFeed), oracleExposureAttoEth: oracleExposureAttoEth.toString() }
}

/** Collapse identical question aliases before authenticating canonical report routes. */
export function canonicalPoolReportRoutes(pools: readonly PoolSnapshot[]): CanonicalCoordinatorReportRoute[] {
	const routes = new Map<string, CanonicalCoordinatorReportRoute>()
	for (const pool of pools) {
		if (pool.pendingReportId === '0') continue
		const route = { coordinator: pool.priceFeed, pendingReportId: pool.pendingReportId, repToken: pool.repToken }
		routes.set(`${pool.priceFeed.toLowerCase()}:${pool.pendingReportId}:${pool.repToken.toLowerCase()}`, route)
	}
	return [...routes.values()]
}

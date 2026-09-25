import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { ListedSecurityPool, ReadClient, TradingShareBalances } from '@zoltar/ui-core-shared/types/contracts.js'
import { statoblast_SecurityPoolForker_SecurityPoolForker } from '../contractArtifact.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'
import { requireForkDataView } from './forkData.js'
import { MIGRATION_TIME_LENGTH } from './forks.js'
import { loadSecurityPoolPage } from './securityPools.js'
import { loadTradingDetails } from './trading.js'

const PORTFOLIO_POOL_PAGE_SIZE = 100

/** One pool as the connected account sees it: the pool listing (with the account's vault summary), its share balances, and the fork migration deadline when one applies. */
export type PortfolioPoolSnapshot = {
	migrationEndsAt: bigint | undefined
	pool: ListedSecurityPool
	shareBalances: TradingShareBalances | undefined
}

async function loadAllPoolsForAccount(client: ReadClient, accountAddress: Address) {
	const pools: ListedSecurityPool[] = []
	for (let pageIndex = 0; ; pageIndex += 1) {
		const page = await loadSecurityPoolPage(client, pageIndex, PORTFOLIO_POOL_PAGE_SIZE, accountAddress)
		pools.push(...page.pools)
		if (BigInt(pools.length) >= page.poolCount || page.pools.length < PORTFOLIO_POOL_PAGE_SIZE) return pools
	}
}

async function loadMigrationEndsAt(client: ReadClient, pool: ListedSecurityPool) {
	if (pool.systemState !== 'forkMigration') return undefined
	const forkData = requireForkDataView(
		await client.readContract({
			abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
			functionName: 'forkData',
			address: getInfraContractAddresses().securityPoolForker,
			args: [pool.securityPoolAddress],
		}),
	)
	return forkData.forkActivationTime === 0n ? undefined : forkData.forkActivationTime + MIGRATION_TIME_LENGTH
}

/** Loads every pool across universes with the account's vault summary, share balances, and migration deadline. */
export async function loadPortfolioSnapshots(client: ReadClient, accountAddress: Address): Promise<PortfolioPoolSnapshot[]> {
	const pools = await loadAllPoolsForAccount(client, accountAddress)
	return await Promise.all(
		pools.map(async pool => {
			const [tradingDetails, migrationEndsAt] = await Promise.all([loadTradingDetails(client, pool.securityPoolAddress, accountAddress), loadMigrationEndsAt(client, pool)])
			return { migrationEndsAt, pool, shareBalances: tradingDetails.shareBalances }
		}),
	)
}

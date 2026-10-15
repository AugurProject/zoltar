import type { TruthAuctionMetrics } from '../../../types/contracts.js'
import type { SecurityPoolLifecycleState } from './securityPoolState.js'

/** Fork-stage deadlines and auction progress for the pool header's strip; each is undefined until the pool's fork details load, and `loading` is true only while that read is in flight. */
export type PoolForkTimeline = {
	auctionEndsAt: bigint | undefined
	loading: boolean
	migrationEndsAt: bigint | undefined
	truthAuction: TruthAuctionMetrics | undefined
}

/** While the pool is forked or migrating, the strip shows its settlement collateral and migration deadline. */
export function poolStripShowsMigration(state: SecurityPoolLifecycleState | undefined) {
	return state === 'poolForked' || state === 'forkMigration'
}

/** While the pool runs its truth auction, the strip shows the auction's progress and end. */
export function poolStripShowsAuction(state: SecurityPoolLifecycleState | undefined) {
	return state === 'forkTruthAuction'
}

/** The stage deadline the strip shows, if any, so views below the header need not repeat it. */
export function getPoolStripDeadline(state: SecurityPoolLifecycleState | undefined, forkTimeline: PoolForkTimeline | undefined) {
	if (poolStripShowsMigration(state)) return forkTimeline?.migrationEndsAt
	if (poolStripShowsAuction(state)) return forkTimeline?.auctionEndsAt
	return undefined
}

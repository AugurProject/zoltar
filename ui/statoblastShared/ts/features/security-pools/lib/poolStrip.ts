import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import type { TruthAuctionMetrics } from '../../../types/contracts.js'
import type { SecurityPoolLifecycleState } from './securityPoolState.js'

/** Fork-stage deadlines and auction progress for the pool header's strip; each is undefined until the pool's fork details load, and `loading` is true only while that read is in flight. */
export type PoolForkTimeline = {
	auctionEndsAt: bigint | undefined
	loading: boolean
	migrationEndsAt: bigint | undefined
	truthAuction: TruthAuctionMetrics | undefined
}

/**
 * Which figures lead the strip: an operating pool's capacity, a forked or migrating pool's settlement collateral and
 * migration deadline, a running truth auction's progress and end, or an ended pool's outcome. The header renders from this
 * mapping and the views below it use it to leave out what the strip already shows.
 */
export function getPoolStripStage(state: SecurityPoolLifecycleState | undefined) {
	switch (state) {
		case 'ended':
			return 'ended'
		case 'poolForked':
		case 'forkMigration':
			return 'migration'
		case 'forkTruthAuction':
			return 'auction'
		case 'operational':
		case undefined:
			return 'operating'
		default:
			return assertNever(state)
	}
}

export function poolStripShowsMigration(state: SecurityPoolLifecycleState | undefined) {
	return getPoolStripStage(state) === 'migration'
}

export function poolStripShowsAuction(state: SecurityPoolLifecycleState | undefined) {
	return getPoolStripStage(state) === 'auction'
}

/** The stage deadline the strip shows, if any, so views below the header need not repeat it. */
export function getPoolStripDeadline(state: SecurityPoolLifecycleState | undefined, forkTimeline: PoolForkTimeline | undefined) {
	if (poolStripShowsMigration(state)) return forkTimeline?.migrationEndsAt
	if (poolStripShowsAuction(state)) return forkTimeline?.auctionEndsAt
	return undefined
}

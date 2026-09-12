import type { ForkOutcomeKey, SecurityPoolSystemState, TruthAuctionMetrics } from '@zoltar/ui-core-shared/types/contracts.js'
import { getTimeRemaining as getSharedTimeRemaining } from '@zoltar/ui-core-shared/lib/time.js'
import { deriveHasForkActivity } from '../../../protocol/forkActivity.js'

export { deriveHasForkActivity }

const SECONDS_PER_WEEK = 7n * 24n * 60n * 60n

export const AUCTION_TIME_SECONDS = SECONDS_PER_WEEK
export const AUCTIONED_CAPACITY_OWNERSHIP_ATTO_REP_LABEL = 'Auctioned capacity ownership'

export type ForkAuctionStageView = 'initiate' | 'migration' | 'auction' | 'settlement'

const FORK_AUCTION_STAGE_LABELS: Record<ForkAuctionStageView, string> = {
	initiate: 'Trigger',
	migration: 'Migration',
	auction: 'Truth Auction',
	settlement: 'Settlement',
}

type ForkAuctionStageSource = {
	claimingAvailable?: boolean
	forkOutcome: ForkOutcomeKey
	migratedAttoRep: bigint
	systemState: SecurityPoolSystemState
	truthAuction?: Pick<TruthAuctionMetrics, 'finalized'> | undefined
	truthAuctionStartedAt: bigint
}

export function getForkAuctionStageLabel(stage: ForkAuctionStageView) {
	return FORK_AUCTION_STAGE_LABELS[stage]
}

export function getForkAuctionStageView(source: ForkAuctionStageSource): ForkAuctionStageView {
	if (source.truthAuction !== undefined) {
		if (!source.truthAuction.finalized) return 'auction'
		return 'settlement'
	}

	if (source.systemState === 'forkTruthAuction') return 'auction'
	if (source.claimingAvailable === true) return 'settlement'
	if (source.systemState === 'operational' && deriveHasForkActivity(source)) return 'settlement'
	if (source.systemState === 'poolForked' || source.systemState === 'forkMigration' || source.migratedAttoRep > 0n) return 'migration'
	return 'initiate'
}

export function getTimeRemaining(targetTime: bigint | undefined, currentTime: bigint) {
	return getSharedTimeRemaining(targetTime, currentTime)
}

import type { ForkOutcomeKey, ReportingOutcomeKey, SecurityPoolSystemState, TruthAuctionMetrics } from '../../../types/contracts.js'
import { assertNever } from '../../../lib/assert.js'
import { getTimeRemaining as getSharedTimeRemaining } from '../../../lib/time.js'
import { getReportingOutcomeLabel } from '../../reporting/lib/reporting.js'
import { deriveHasForkActivity } from '../../../protocol/forkActivity.js'

export { deriveHasForkActivity }

const SECONDS_PER_WEEK = 7n * 24n * 60n * 60n

export const AUCTION_TIME_SECONDS = SECONDS_PER_WEEK
export const AUCTIONED_BOND_ALLOWANCE_LABEL = 'Auctioned Bond Allowance (OI Debt)'

export type ForkAuctionStageView = 'initiate' | 'migration' | 'auction' | 'settlement'

const FORK_AUCTION_STAGE_LABELS: Record<ForkAuctionStageView, string> = {
	initiate: 'Trigger',
	migration: 'Migration',
	auction: 'Truth Auction',
	settlement: 'Settlement',
}

const FORK_AUCTION_STAGE_ORDER: Record<ForkAuctionStageView, number> = {
	initiate: 0,
	migration: 1,
	auction: 2,
	settlement: 3,
}

type ForkAuctionStageSource = {
	claimingAvailable?: boolean
	forkOutcome: ForkOutcomeKey
	migratedRep: bigint
	systemState: SecurityPoolSystemState
	truthAuction?: Pick<TruthAuctionMetrics, 'finalized'> | undefined
	truthAuctionStartedAt: bigint
}

export function getOutcomeActionLabel(outcome: ReportingOutcomeKey) {
	return getReportingOutcomeLabel(outcome)
}

export function getForkStageDescriptionForState(state: SecurityPoolSystemState) {
	switch (state) {
		case 'operational':
			return 'This pool is operational. If it is a child universe, the fork and auction path has completed.'
		case 'poolForked':
			return 'The parent pool has forked. Child universes can now be created and REP can migrate.'
		case 'forkMigration':
			return 'Migration is active. Vault state and REP can move into child universes before the truth auction starts. Unresolved escalation is already represented by each child snapshot and aggregate backing; winning parent deposits may instead be claimed directly.'
		case 'forkTruthAuction':
			return `Truth auction is active. Winning bidders later claim child-pool REP plus a pro-rata share of the ${AUCTIONED_BOND_ALLOWANCE_LABEL}, which is the remaining open-interest debt carried into the child pool.`
		default:
			return assertNever(state)
	}
}

export function getForkAuctionStageLabel(stage: ForkAuctionStageView) {
	return FORK_AUCTION_STAGE_LABELS[stage]
}

export function getForkAuctionStageOrder(stage: ForkAuctionStageView) {
	return FORK_AUCTION_STAGE_ORDER[stage]
}

export function hasForkActivity(pool: Parameters<typeof deriveHasForkActivity>[0]) {
	return deriveHasForkActivity(pool)
}

export function getForkAuctionStageView(source: ForkAuctionStageSource): ForkAuctionStageView {
	if (source.truthAuction !== undefined) {
		if (!source.truthAuction.finalized) return 'auction'
		return 'settlement'
	}

	if (source.systemState === 'forkTruthAuction') return 'auction'
	if (source.claimingAvailable === true) return 'settlement'
	if (source.systemState === 'operational' && hasForkActivity(source)) return 'settlement'
	if (source.systemState === 'poolForked' || source.systemState === 'forkMigration' || source.migratedRep > 0n) return 'migration'
	return 'initiate'
}

export function getTimeRemaining(targetTime: bigint | undefined, currentTime: bigint) {
	return getSharedTimeRemaining(targetTime, currentTime)
}

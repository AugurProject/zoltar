import type { ForkOutcomeKey, ListedSecurityPool, ReportingOutcomeKey, SecurityPoolSystemState, TruthAuctionMetrics } from '../types/contracts.js'
import { assertNever } from './assert.js'
import { getTimeRemaining as getSharedTimeRemaining } from './time.js'
import { getReportingOutcomeLabel } from './reporting.js'

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

type ForkActivitySource = Pick<ListedSecurityPool, 'forkOutcome' | 'migratedRep' | 'systemState' | 'truthAuctionStartedAt'>

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
			return 'Migration is active. Vaults, escalation deposits, and REP can be moved into a child universe before the truth auction starts.'
		case 'forkTruthAuction':
			return `Truth auction is active. Winning bidders later claim child-pool REP plus a pro-rata share of the ${AUCTIONED_BOND_ALLOWANCE_LABEL}, which is the remaining open-interest debt for this repair path.`
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

export function deriveHasForkActivity(source: ForkActivitySource) {
	return source.systemState !== 'operational' || source.truthAuctionStartedAt > 0n || source.migratedRep > 0n || source.forkOutcome !== 'none'
}

export function hasForkActivity(pool: ForkActivitySource) {
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

import type { ForkAuctionDetails, ListedSecurityPool, ReportingOutcomeKey, SecurityPoolSystemState } from '../types/contracts.js'
import { assertNever } from './assert.js'
import { getTimeRemaining as getSharedTimeRemaining } from './time.js'
import { getReportingOutcomeLabel } from './reporting.js'

const SECONDS_PER_WEEK = 7n * 24n * 60n * 60n

export const MIGRATION_TIME_SECONDS = 8n * SECONDS_PER_WEEK
export const AUCTION_TIME_SECONDS = SECONDS_PER_WEEK
const PRICE_PRECISION = 10n ** 18n

export function getSystemStateLabel(state: SecurityPoolSystemState) {
	switch (state) {
		case 'operational':
			return 'Operational'
		case 'poolForked':
			return 'Pool Forked'
		case 'forkMigration':
			return 'Fork Migration'
		case 'forkTruthAuction':
			return 'Truth Auction'
		default:
			return assertNever(state)
	}
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
			return 'Migration is active. Vaults, escalation deposits, and REP can be moved into a child universe before the truth auction starts.'
		case 'forkTruthAuction':
			return 'Truth auction is active. Bidders compete to buy REP exposure for the unresolved collateral.'
		default:
			return assertNever(state)
	}
}

export function getForkStageDescription(details: ForkAuctionDetails) {
	return getForkStageDescriptionForState(details.systemState)
}

export function hasForkActivity(pool: Pick<ListedSecurityPool, 'forkOutcome' | 'migratedRep' | 'systemState' | 'truthAuctionStartedAt'>) {
	return pool.systemState !== 'operational' || pool.truthAuctionStartedAt > 0n || pool.migratedRep > 0n || pool.forkOutcome !== 'none'
}

export function getTimeRemaining(targetTime: bigint | undefined, currentTime: bigint) {
	return getSharedTimeRemaining(targetTime, currentTime)
}

export function estimateRepPurchased(ethAmount: bigint, price: bigint) {
	if (ethAmount <= 0n || price <= 0n) return 0n
	return (ethAmount * PRICE_PRECISION) / price
}

import type { ForkAuctionDetails, ReportingOutcomeKey, SecurityPoolSystemState } from '../types/contracts.js'
import { assertNever } from './assert.js'

export const MIGRATION_TIME_SECONDS = 8n * 7n * 24n * 60n * 60n
export const AUCTION_TIME_SECONDS = 7n * 24n * 60n * 60n
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
	switch (outcome) {
		case 'invalid':
			return 'Invalid'
		case 'yes':
			return 'Yes'
		case 'no':
			return 'No'
		default:
			return assertNever(outcome)
	}
}

export function getForkStageDescription(details: ForkAuctionDetails) {
	switch (details.systemState) {
		case 'operational':
			return 'This pool is operational. If it is a child universe, the fork and auction path has completed.'
		case 'poolForked':
			return 'The parent pool has forked. Child universes can now be created and REP can migrate.'
		case 'forkMigration':
			return 'Migration is active. Vaults, escalation deposits, and REP can be moved into a child universe before the truth auction starts.'
		case 'forkTruthAuction':
			return 'Truth auction is active. Bidders compete to buy REP exposure for the unresolved collateral.'
		default:
			return assertNever(details.systemState)
	}
}

export function getTimeRemaining(targetTime: bigint | undefined, currentTime: bigint) {
	if (targetTime === undefined) return undefined
	return targetTime <= currentTime ? 0n : targetTime - currentTime
}

export function estimateRepPurchased(ethAmount: bigint, price: bigint) {
	if (ethAmount <= 0n || price <= 0n) return 0n
	return (ethAmount * PRICE_PRECISION) / price
}

import type { Address } from '@zoltar/bot-shared/ethereum'
import type { Venue } from '#core/venue-strategy'

export type OpportunityDecision = 'dry-run-opportunity' | 'eligible' | 'execution-failed' | 'history-unavailable' | 'insufficient-inventory' | 'market-risk' | 'paused' | 'risk-limit' | 'selected' | 'self-report' | 'signer-unavailable' | 'submitted' | 'unprofitable'

export type EvaluatedOpportunitySnapshot = {
	centralizedPriceDeviationBps: string | undefined
	decision: OpportunityDecision
	direction: 'buy-rep' | 'sell-rep'
	estimatedNetProfitWeth: string
	estimatedNetProfitEth: string
	executablePriceRepPerEth: string
	hasRequiredInventory: boolean | undefined
	pool: Address
	poolFee: number
	reportId: string
	requiredToken: string
	requiredWeth: string
	token: Address
	tokenSymbol: string
	timeRemaining: string
	venue?: Venue | undefined
	windowUnit: 'blocks' | 'seconds'
}

/** A live report the scan declined before any venue priced it; it stays visible with the concrete reason instead of surviving only in the log. */
export type SkippedOpportunitySnapshot = {
	decision: 'skipped'
	reason: string
	reportId: string
	token: Address
	tokenSymbol: string
	timeRemaining: string
	windowUnit: 'blocks' | 'seconds'
}

export type OpportunitySnapshot = EvaluatedOpportunitySnapshot | SkippedOpportunitySnapshot

/** Projects only the documented dashboard fields so internal additions never leak through the public snapshot. */
export function publicOpportunity(opportunity: OpportunitySnapshot): OpportunitySnapshot {
	if (opportunity.decision === 'skipped') {
		return {
			decision: opportunity.decision,
			reason: opportunity.reason,
			reportId: opportunity.reportId,
			token: opportunity.token,
			tokenSymbol: opportunity.tokenSymbol,
			timeRemaining: opportunity.timeRemaining,
			windowUnit: opportunity.windowUnit,
		}
	}
	return {
		centralizedPriceDeviationBps: opportunity.centralizedPriceDeviationBps,
		decision: opportunity.decision,
		direction: opportunity.direction,
		estimatedNetProfitWeth: opportunity.estimatedNetProfitWeth,
		estimatedNetProfitEth: opportunity.estimatedNetProfitEth,
		executablePriceRepPerEth: opportunity.executablePriceRepPerEth,
		hasRequiredInventory: opportunity.hasRequiredInventory,
		pool: opportunity.pool,
		poolFee: opportunity.poolFee,
		reportId: opportunity.reportId,
		requiredToken: opportunity.requiredToken,
		requiredWeth: opportunity.requiredWeth,
		token: opportunity.token,
		tokenSymbol: opportunity.tokenSymbol,
		timeRemaining: opportunity.timeRemaining,
		venue: opportunity.venue,
		windowUnit: opportunity.windowUnit,
	}
}

/** Skipped reports are counted apart so "opportunities" keeps meaning reports that received a venue quote. */
export function countOpportunities(opportunities: readonly Pick<OpportunitySnapshot, 'decision'>[]) {
	const skipped = opportunities.filter(opportunity => opportunity.decision === 'skipped').length
	return { evaluated: opportunities.length - skipped, skipped }
}

import type { PortfolioObservation, PortfolioPosition } from '#monitoring/portfolio-monitor'
import { portfolioTakeoverSource } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'

/** Match the authenticated index's unpaid atomic cure that precedes every takeover. */
export function portfolioCureOutcome(observation: PortfolioObservation, position: PortfolioPosition) {
	return portfolioTakeoverSource(observation.snapshot, position)
}

import { outcomeLabel } from './outcomes.js'

/** Reasons a market cannot accept new risk; shown as badges and blockers, so keep them short. */
export const marketDataUnavailable = 'Market data unavailable'
export const questionEnded = 'Question ended'
export const poolInactive = 'Pool inactive'
export const awaitingForkContinuation = 'Awaiting fork continuation'
export const universeForked = 'Universe forked'
export const questionResolved = 'Question resolved'

export function resolvedOutcome(outcome: 'INVALID' | 'YES' | 'NO') {
	return `Resolved ${outcomeLabel(outcome)}`
}

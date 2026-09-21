import { invalid, no, yes } from './outcomes.js'

/** Reasons a market cannot accept new risk; shown as badges and blockers, so keep them short. */
export const marketDataUnavailable = 'Market data unavailable'
export const questionEnded = 'Question ended'
export const poolInactive = 'Pool inactive'
export const awaitingForkContinuation = 'Awaiting fork continuation'
export const universeForked = 'Universe forked'
export const questionResolved = 'Question resolved'

const outcomeLabels = { INVALID: invalid, NO: no, YES: yes } as const

export function resolvedOutcome(outcome: keyof typeof outcomeLabels) {
	return `Resolved ${outcomeLabels[outcome]}`
}

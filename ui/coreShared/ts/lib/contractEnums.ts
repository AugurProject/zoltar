import type { ReportingOutcomeKey, SecurityPoolSystemState } from '../types/contracts.js'

/** Maps a raw question outcome index to its key; anything outside the reported range means the question is still unresolved. */
export function getReportingOutcomeKey(outcome: bigint | number): ReportingOutcomeKey | 'none' {
	switch (outcome) {
		case 0:
		case 0n:
			return 'invalid'
		case 1:
		case 1n:
			return 'yes'
		case 2:
		case 2n:
			return 'no'
		default:
			return 'none'
	}
}

/** Like `getReportingOutcomeKey`, but for callers that already hold a resolved outcome and treat anything else as a programming error. */
export function requireReportingOutcomeKey(outcome: ReportingOutcomeKey | bigint | number): ReportingOutcomeKey {
	if (typeof outcome === 'string') return outcome
	const key = getReportingOutcomeKey(outcome)
	if (key === 'none') throw new Error(`Unsupported child universe outcome index: ${outcome.toString()}`)
	return key
}

export function getReportingOutcomeValue(outcome: ReportingOutcomeKey) {
	switch (outcome) {
		case 'invalid':
			return 0
		case 'yes':
			return 1
		case 'no':
			return 2
		default:
			throw new Error(`Unhandled reporting outcome: ${JSON.stringify(outcome)}`)
	}
}

/** Maps a raw system state index to its key, or undefined for values the UI does not know how to present. */
export function tryGetSecurityPoolSystemState(value: bigint | number): SecurityPoolSystemState | undefined {
	switch (value) {
		case 0:
		case 0n:
			return 'operational'
		case 1:
		case 1n:
			return 'poolForked'
		case 2:
		case 2n:
			return 'forkMigration'
		case 3:
		case 3n:
			return 'forkTruthAuction'
		default:
			return undefined
	}
}

export function getSecurityPoolSystemState(value: bigint | number): SecurityPoolSystemState {
	const state = tryGetSecurityPoolSystemState(value)
	if (state === undefined) throw new Error(`Unhandled security pool system state: ${JSON.stringify(value)}`)
	return state
}

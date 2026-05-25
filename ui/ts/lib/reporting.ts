import type { ReportingOutcomeKey } from '../types/contracts.js'
import { assertNever } from './assert.js'
import { formatRelativeTimestamp, formatTimestamp } from './formatters.js'

const REPORTING_OUTCOME_OPTIONS: { key: ReportingOutcomeKey; label: string }[] = [
	{ key: 'invalid', label: 'Invalid' },
	{ key: 'yes', label: 'Yes' },
	{ key: 'no', label: 'No' },
]

export const REPORTING_OUTCOME_DROPDOWN_OPTIONS = REPORTING_OUTCOME_OPTIONS.map(option => ({
	value: option.key,
	label: option.label,
}))

export function getReportingOutcomeLabel(outcome: ReportingOutcomeKey | 'none') {
	switch (outcome) {
		case 'invalid':
			return 'Invalid'
		case 'yes':
			return 'Yes'
		case 'no':
			return 'No'
		case 'none':
			return 'Unresolved'
		default:
			return assertNever(outcome)
	}
}

export function getReportingLockedUntilMessage(endTime: bigint, currentTimestamp: bigint | undefined) {
	if (currentTimestamp === undefined) {
		return `Reporting opens when this pool's market ends: ${formatTimestamp(endTime)}.`
	}

	return `Reporting opens when this pool's market ends: ${formatTimestamp(endTime)} (${formatRelativeTimestamp(endTime, currentTimestamp)}).`
}

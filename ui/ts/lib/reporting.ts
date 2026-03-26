import type { ReportingOutcomeKey } from '../types/contracts.js'
import { assertNever } from './assert.js'

export const REPORTING_OUTCOME_OPTIONS: { key: ReportingOutcomeKey; label: string }[] = [
	{ key: 'invalid', label: 'Invalid' },
	{ key: 'yes', label: 'Yes' },
	{ key: 'no', label: 'No' },
]

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

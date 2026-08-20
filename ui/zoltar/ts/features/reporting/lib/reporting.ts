import type { ReportingDetails, ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import { getEscalationPhase, isPoolQuestionFinalized } from './reportingDomain.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { formatTimestampWithRelative } from '@zoltar/ui-core-shared/lib/formatters.js'

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
	return `Reporting opens when this pool's underlying question ends: ${formatTimestampWithRelative(endTime, currentTimestamp)}.`
}

export function hasReportingOpened(endTime: bigint, currentTimestamp: bigint | undefined) {
	if (currentTimestamp === undefined) return undefined
	return currentTimestamp > endTime
}

export type ReportingStage = 'preOpen' | 'notStarted' | 'activeLocked' | 'activeWithdrawable' | 'resolved' | 'forkTriggered' | 'timedOut'

export function deriveReportingStage({ reportingDetails, reportingReady }: { reportingDetails: ReportingDetails | undefined; reportingReady: boolean | undefined }): ReportingStage | undefined {
	if (reportingReady === false) return 'preOpen'
	if (reportingDetails === undefined) return undefined
	if (isPoolQuestionFinalized(reportingDetails)) return 'resolved'
	if (reportingDetails.status === 'not-started') return 'notStarted'

	const escalationPhase = getEscalationPhase(reportingDetails)
	switch (escalationPhase) {
		case 'Resolved':
			return 'resolved'
		case 'Fork Triggered':
			return 'forkTriggered'
		case 'Timed Out':
			return 'timedOut'
		case 'Pending Start':
		case 'Active':
			if (reportingDetails.settlementState === 'migration-required' || reportingDetails.settlementState === 'migration-expired') return 'forkTriggered'
			return reportingDetails.parentWithdrawalEnabled ? 'activeWithdrawable' : 'activeLocked'
		default:
			return assertNever(escalationPhase)
	}
}

export function isReportingOutcomeEnabled(stage: ReportingStage | undefined) {
	return stage === 'notStarted' || stage === 'activeLocked' || stage === 'activeWithdrawable'
}

export function isWithdrawEscalationEnabled(stage: ReportingStage | undefined) {
	return stage === 'activeWithdrawable' || stage === 'resolved'
}

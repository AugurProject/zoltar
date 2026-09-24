import { getDisplayedLeadingEscalationOutcome, getReportingLockedUntilMessage, getReportingOutcomeLabel, hasReportingOpened } from './reporting.js'
import { formatReportingDeadline } from './reportingViewerStatus.js'
import { formatCurrencyInputBalance } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as reportingCopy from '../../../copy/reporting.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import type { LifecycleStagePresentation } from '@zoltar/ui-zoltar-shared/features/types.js'
import type { MarketDetails, ReportingDetails } from '@zoltar/ui-core-shared/types/contracts.js'
import { ESCALATION_GAME_ACTIVATION_DELAY, getEscalationPhase, isPoolQuestionFinalized } from './reportingDomain.js'

function getResolvedReportingOutcomeLabel(reportingDetails: ReportingDetails) {
	return reportingDetails.questionOutcome === 'none' ? reportingCopy.pendingFinalization : getReportingOutcomeLabel(reportingDetails.questionOutcome)
}

export function getReportingStagePresentation({
	effectiveCurrentTimestamp,
	forkAlreadyTriggered,
	marketDetails,
	reportingDetails,
}: {
	effectiveCurrentTimestamp: bigint | undefined
	forkAlreadyTriggered: boolean
	marketDetails: MarketDetails | undefined
	reportingDetails: ReportingDetails | undefined
}): LifecycleStagePresentation | undefined {
	if (effectiveCurrentTimestamp === undefined || marketDetails === undefined) return undefined
	if (!hasReportingOpened(marketDetails.endTime, effectiveCurrentTimestamp))
		return {
			availableActions: [],
			blockedActions: [],
			detail: getReportingLockedUntilMessage(marketDetails.endTime, effectiveCurrentTimestamp),
			key: 'reporting-not-enabled',
			label: reportingCopy.reportingNotEnabled,
			tone: 'warning',
		}
	if (reportingDetails === undefined)
		return {
			availableActions: [],
			blockedActions: [],
			detail: reportingCopy.reportingDetailsRequired,
			key: 'reporting-open',
			label: reportingCopy.reportingOpen,
			tone: 'default',
		}
	if (isPoolQuestionFinalized(reportingDetails))
		return {
			availableActions: [],
			blockedActions: [],
			detail: reportingCopy.formatReportingResolvedDetailLabel(getResolvedReportingOutcomeLabel(reportingDetails)),
			key: 'escalation-resolved',
			label: reportingCopy.resolved,
			tone: 'success',
		}
	if (reportingDetails.status === 'not-started') return { availableActions: [], blockedActions: [], detail: reportingCopy.firstReportNext(formatCurrencyInputBalance(reportingDetails.startBondAttoRep)), key: 'reporting-open', label: reportingCopy.phaseLabels[0] ?? reportingCopy.reportingOpen, tone: 'default' }
	const escalationPhase = getEscalationPhase(reportingDetails)
	const leadingOutcome = getDisplayedLeadingEscalationOutcome(reportingDetails.sides)
	switch (escalationPhase) {
		case 'Pending Start':
			return {
				availableActions: [],
				blockedActions: [],
				detail: leadingOutcome === undefined ? reportingCopy.tieStatusLead : reportingCopy.pendingStartNext({ end: formatReportingDeadline(reportingDetails.escalationEndTime, reportingDetails.currentTime), outcome: getReportingOutcomeLabel(leadingOutcome) }),
				key: 'escalation-pending',
				label: reportingCopy.phaseLabels[1] ?? reportingCopy.reportingOpen,
				tone: 'default',
			}
		case 'Active':
			return {
				availableActions: [],
				blockedActions: [],
				detail: leadingOutcome === undefined ? reportingCopy.tieStatusLead : reportingCopy.activeNext(formatReportingDeadline(reportingDetails.escalationEndTime, reportingDetails.currentTime), getReportingOutcomeLabel(leadingOutcome)),
				key: 'escalation-active',
				label: commonCopy.active,
				tone: 'default',
			}
		case 'Fork Triggered':
			return {
				availableActions: [],
				blockedActions: [],
				detail: forkAlreadyTriggered ? reportingCopy.forkAlreadyTriggeredReportReason : reportingCopy.forkTriggerInstruction,
				key: 'escalation-fork-triggered',
				label: commonCopy.forkTriggered,
				tone: 'default',
			}
		case 'Timed Out':
			return {
				availableActions: [],
				blockedActions: [],
				detail: reportingCopy.timeoutResolutionDetail,
				key: 'escalation-timed-out',
				label: reportingCopy.timedOut,
				tone: 'default',
			}
		case 'Resolved':
			return {
				availableActions: [],
				blockedActions: [],
				detail: reportingCopy.formatReportingResolvedDetailLabel(getResolvedReportingOutcomeLabel(reportingDetails)),
				key: 'escalation-resolved',
				label: reportingCopy.resolved,
				tone: 'success',
			}
		default:
			return assertNever(escalationPhase)
	}
}

export function getEscalationGameStartTimestamp(activationTime: bigint | undefined) {
	if (activationTime === undefined) return undefined
	return activationTime > ESCALATION_GAME_ACTIVATION_DELAY ? activationTime - ESCALATION_GAME_ACTIVATION_DELAY : 0n
}

export function getEffectiveReportingDetails(reportingDetails: ReportingDetails | undefined, currentTimestamp: bigint | undefined) {
	if (reportingDetails === undefined || currentTimestamp === undefined || reportingDetails.currentTime === currentTimestamp) return reportingDetails
	return {
		...reportingDetails,
		currentTime: currentTimestamp,
	}
}

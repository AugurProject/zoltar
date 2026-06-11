import { assertNever } from '../assert.js'
import type { ForkAuctionStageView } from '../forkAuction.js'
import { getEscalationPhase, isPoolQuestionFinalized } from '../reportingDomain.js'
import type { SecurityPoolForkStage, SecurityPoolLifecycleState, SecurityPoolReportingStage } from './types.js'
import type { ReportingDetails, ReportingOutcomeKey, SecurityPoolSystemState } from '../../types/contracts.js'

export function isSecurityPoolEnded({
	hasForkActivity,
	isChildPool,
	questionOutcome,
	systemState,
	universeHasForked,
}: {
	hasForkActivity?: boolean | undefined
	isChildPool?: boolean | undefined
	questionOutcome: ReportingOutcomeKey | 'none' | undefined
	systemState: SecurityPoolSystemState | undefined
	universeHasForked?: boolean | undefined
}) {
	if (universeHasForked === true && systemState === 'operational' && isChildPool !== true) return false
	return systemState === 'operational' && hasForkActivity !== true && questionOutcome !== undefined && questionOutcome !== 'none'
}

export function deriveSecurityPoolLifecycleState({
	hasForkActivity,
	isChildPool,
	questionOutcome,
	systemState,
	universeHasForked,
}: {
	hasForkActivity?: boolean | undefined
	isChildPool?: boolean | undefined
	questionOutcome: ReportingOutcomeKey | 'none' | undefined
	systemState: SecurityPoolSystemState | undefined
	universeHasForked?: boolean | undefined
}): SecurityPoolLifecycleState | undefined {
	if (systemState === undefined) return undefined
	if (universeHasForked === true && systemState === 'operational' && isChildPool !== true) return 'poolForked'
	if (isSecurityPoolEnded({ hasForkActivity, isChildPool, questionOutcome, systemState, universeHasForked })) return 'ended'
	return systemState
}

export function deriveSecurityPoolReportingStage({ reportingDetails, reportingReady }: { reportingDetails: ReportingDetails | undefined; reportingReady: boolean | undefined }): SecurityPoolReportingStage | undefined {
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

export function deriveSecurityPoolForkStage({ currentStage, workflowDisabled }: { currentStage: ForkAuctionStageView | undefined; workflowDisabled: boolean | undefined }): SecurityPoolForkStage | undefined {
	if (workflowDisabled === true) return 'disabled'
	if (currentStage === undefined) return undefined
	return currentStage
}

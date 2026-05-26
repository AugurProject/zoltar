import { assertNever } from '../assert.js'
import type { ForkAuctionStageView } from '../forkAuction.js'
import { getEscalationPhase } from '../reportingDomain.js'
import { evaluateSecurityPoolState } from './engine.js'
import type { SecurityPoolForkStage, SecurityPoolLifecycleState, SecurityPoolReportingStage, SecurityPoolStateModel } from './types.js'
import type { ReportingDetails, ReportingOutcomeKey, SecurityPoolSystemState } from '../../types/contracts.js'

export function isSecurityPoolEnded({ questionOutcome, systemState }: { questionOutcome: ReportingOutcomeKey | 'none' | undefined; systemState: SecurityPoolSystemState | undefined }) {
	return systemState === 'operational' && questionOutcome !== undefined && questionOutcome !== 'none'
}

export function deriveSecurityPoolLifecycleState({ questionOutcome, systemState }: { questionOutcome: ReportingOutcomeKey | 'none' | undefined; systemState: SecurityPoolSystemState | undefined }): SecurityPoolLifecycleState | undefined {
	if (systemState === undefined) return undefined
	if (isSecurityPoolEnded({ questionOutcome, systemState })) return 'ended'
	return systemState
}

export function deriveSecurityPoolReportingStage({ reportingDetails, reportingReady }: { reportingDetails: ReportingDetails | undefined; reportingReady: boolean | undefined }): SecurityPoolReportingStage | undefined {
	if (reportingReady === false) return 'preOpen'
	if (reportingDetails === undefined) return undefined
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
			return reportingDetails.withdrawalEnabled ? 'activeWithdrawable' : 'activeLocked'
		default:
			return assertNever(escalationPhase)
	}
}

export function deriveSecurityPoolForkStage({ currentStage, workflowDisabled }: { currentStage: ForkAuctionStageView | undefined; workflowDisabled: boolean | undefined }): SecurityPoolForkStage | undefined {
	if (workflowDisabled === true) return 'disabled'
	if (currentStage === undefined) return undefined

	switch (currentStage) {
		case 'initiate':
			return 'initiate'
		case 'migration':
			return 'migration'
		case 'auction':
			return 'auction'
		case 'settlement':
			return 'settlement'
		default:
			return assertNever(currentStage)
	}
}

export function evaluateSecurityPoolStateFromPool({ questionOutcome, systemState, universeHasForked }: { questionOutcome: ReportingOutcomeKey | 'none' | undefined; systemState: SecurityPoolSystemState | undefined; universeHasForked: boolean | undefined }): SecurityPoolStateModel {
	return evaluateSecurityPoolState({
		lifecycleState: deriveSecurityPoolLifecycleState({
			questionOutcome,
			systemState,
		}),
		universeHasForked: universeHasForked === true,
	})
}

export function evaluateSecurityPoolStateFromReporting({ reportingDetails, reportingReady }: { reportingDetails: ReportingDetails | undefined; reportingReady: boolean | undefined }): SecurityPoolStateModel {
	return evaluateSecurityPoolState({
		reportingStage: deriveSecurityPoolReportingStage({
			reportingDetails,
			reportingReady,
		}),
		universeHasForked: false,
	})
}

export function evaluateSecurityPoolStateFromFork({
	currentStage,
	questionOutcome,
	systemState,
	universeHasForked,
	workflowDisabled,
}: {
	currentStage: ForkAuctionStageView | undefined
	questionOutcome: ReportingOutcomeKey | 'none' | undefined
	systemState: SecurityPoolSystemState | undefined
	universeHasForked: boolean | undefined
	workflowDisabled: boolean | undefined
}): SecurityPoolStateModel {
	return evaluateSecurityPoolState({
		forkStage: deriveSecurityPoolForkStage({
			currentStage,
			workflowDisabled,
		}),
		lifecycleState: deriveSecurityPoolLifecycleState({
			questionOutcome,
			systemState,
		}),
		universeHasForked: universeHasForked === true,
	})
}

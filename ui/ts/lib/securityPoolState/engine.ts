import {
	ALL_SECURITY_POOL_ACTIONS,
	DISABLED_REASON_BY_FORK_STAGE,
	DISABLED_REASON_BY_LIFECYCLE,
	DISABLED_REASON_BY_REPORTING_STAGE,
	DISABLED_REASON_BY_UNIVERSE_FORKED,
	ENABLED_ACTIONS_BY_FORK_STAGE,
	ENABLED_ACTIONS_BY_LIFECYCLE,
	ENABLED_ACTIONS_BY_REPORTING_STAGE,
	FORK_ACTIONS,
	LIFECYCLE_ACTIONS,
	REPORTING_ACTIONS,
	UNIVERSE_FORKED_DISABLE,
	UNIVERSE_FORKED_ENABLE,
} from './matrix.js'
import type { SecurityPoolActionId, SecurityPoolActionState, SecurityPoolForkStage, SecurityPoolLifecycleState, SecurityPoolReportingStage, SecurityPoolStateInput, SecurityPoolStateModel } from './types.js'

function isLifecycleAction(actionId: SecurityPoolActionId) {
	return LIFECYCLE_ACTIONS.includes(actionId)
}

function isReportingAction(actionId: SecurityPoolActionId) {
	return REPORTING_ACTIONS.includes(actionId)
}

function isForkAction(actionId: SecurityPoolActionId) {
	return FORK_ACTIONS.includes(actionId)
}

function isActionEnabledForProvidedAxes({
	actionId,
	forkStage,
	lifecycleState,
	reportingStage,
	universeHasForked,
}: {
	actionId: SecurityPoolActionId
	forkStage: SecurityPoolForkStage | undefined
	lifecycleState: SecurityPoolLifecycleState | undefined
	reportingStage: SecurityPoolReportingStage | undefined
	universeHasForked: boolean
}) {
	if (universeHasForked && UNIVERSE_FORKED_DISABLE.includes(actionId)) return false
	if (universeHasForked && UNIVERSE_FORKED_ENABLE.includes(actionId)) return true
	if (lifecycleState !== undefined && isLifecycleAction(actionId) && !ENABLED_ACTIONS_BY_LIFECYCLE[lifecycleState].includes(actionId)) return false
	if (reportingStage !== undefined && isReportingAction(actionId) && !ENABLED_ACTIONS_BY_REPORTING_STAGE[reportingStage].includes(actionId)) return false
	if (forkStage !== undefined && isForkAction(actionId) && !ENABLED_ACTIONS_BY_FORK_STAGE[forkStage].includes(actionId)) return false
	return true
}

function getDisabledActionReason({
	actionId,
	forkStage,
	lifecycleState,
	reportingStage,
	universeHasForked,
}: {
	actionId: SecurityPoolActionId
	forkStage: SecurityPoolForkStage | undefined
	lifecycleState: SecurityPoolLifecycleState | undefined
	reportingStage: SecurityPoolReportingStage | undefined
	universeHasForked: boolean
}) {
	if (universeHasForked) {
		const universeForkReason = DISABLED_REASON_BY_UNIVERSE_FORKED[actionId]
		if (universeForkReason !== undefined) return universeForkReason
	}

	if (forkStage !== undefined) {
		const forkReason = DISABLED_REASON_BY_FORK_STAGE[forkStage][actionId]
		if (forkReason !== undefined) return forkReason
	}

	if (reportingStage !== undefined) {
		const reportingReason = DISABLED_REASON_BY_REPORTING_STAGE[reportingStage][actionId]
		if (reportingReason !== undefined) return reportingReason
	}

	if (lifecycleState !== undefined) {
		const lifecycleReason = DISABLED_REASON_BY_LIFECYCLE[lifecycleState][actionId]
		if (lifecycleReason !== undefined) return lifecycleReason
	}

	return `Internal error: missing state-matrix reason for ${actionId}.`
}

function createDisabledActionState({
	actionId,
	forkStage,
	lifecycleState,
	reportingStage,
	universeHasForked,
}: {
	actionId: SecurityPoolActionId
	forkStage: SecurityPoolForkStage | undefined
	lifecycleState: SecurityPoolLifecycleState | undefined
	reportingStage: SecurityPoolReportingStage | undefined
	universeHasForked: boolean
}): SecurityPoolActionState {
	return {
		enabled: false,
		reason: getDisabledActionReason({
			actionId,
			forkStage,
			lifecycleState,
			reportingStage,
			universeHasForked,
		}),
	}
}

export function evaluateSecurityPoolState(input: SecurityPoolStateInput): SecurityPoolStateModel {
	const { forkStage, lifecycleState, reportingStage, universeHasForked } = input

	const actions = {} as Record<SecurityPoolActionId, SecurityPoolActionState>
	for (const actionId of ALL_SECURITY_POOL_ACTIONS) {
		actions[actionId] = isActionEnabledForProvidedAxes({
			actionId,
			forkStage,
			lifecycleState,
			reportingStage,
			universeHasForked,
		})
			? { enabled: true, reason: undefined }
			: createDisabledActionState({
					actionId,
					forkStage,
					lifecycleState,
					reportingStage,
					universeHasForked,
				})
	}

	return {
		actions,
		forkStage,
		lifecycleState,
		reportingStage,
		universeHasForked,
	}
}

import { ALL_SECURITY_POOL_ACTIONS, ENABLED_ACTIONS_BY_FORK_STAGE, ENABLED_ACTIONS_BY_LIFECYCLE, ENABLED_ACTIONS_BY_REPORTING_STAGE, FORK_ACTIONS, LIFECYCLE_ACTIONS, REPORTING_ACTIONS, UNIVERSE_FORKED_DISABLE, UNIVERSE_FORKED_ENABLE } from './matrix.js'
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

export function evaluateSecurityPoolState(input: SecurityPoolStateInput): SecurityPoolStateModel {
	const { forkStage, lifecycleState, reportingStage, universeHasForked } = input

	const actions = {} as Record<SecurityPoolActionId, SecurityPoolActionState>
	for (const actionId of ALL_SECURITY_POOL_ACTIONS) {
		actions[actionId] = {
			enabled: isActionEnabledForProvidedAxes({
				actionId,
				forkStage,
				lifecycleState,
				reportingStage,
				universeHasForked,
			}),
		}
	}

	return {
		actions,
		forkStage,
		lifecycleState,
		reportingStage,
		universeHasForked,
	}
}

import type { Address } from '@zoltar/bot-shared/ethereum'
import { resetRuntimeStateForProfile, type RuntimeState } from '../state/operator-state.ts'

function isPristineBootstrapState(state: RuntimeState) {
	const schedulerIsPristine = (state.scheduler.status === 'idle' || state.scheduler.status === 'paused') && state.scheduler.lastDelaySeconds === undefined && state.scheduler.lastRunAt === undefined && state.scheduler.nextRunAt === undefined && state.scheduler.selectedOperationId === undefined
	return (
		state.signerAddress === undefined &&
		state.activities.length === 0 &&
		state.lifecyclePresenceBlocker === undefined &&
		state.obligationTombstones.length === 0 &&
		state.obligations.length === 0 &&
		state.pendingTransactions.length === 0 &&
		state.protocolIndex === undefined &&
		state.retirement.status === 'inactive' &&
		state.retirement.positions.length === 0 &&
		!state.safetyPaused &&
		schedulerIsPristine &&
		state.workflows.length === 0
	)
}

export function resetPristineStateForDeploymentProfile(state: RuntimeState, expectedProfileId: string, paused: boolean, wallet: Address | undefined, stateFile: string) {
	if (state.profileId === expectedProfileId) return false
	if (!isPristineBootstrapState(state)) {
		const evidence = state.retirement.completionEvidence
		const override = state.retirement.profileReplacementOverride
		const residualOverrideMatches =
			state.retirement.status === 'drained-with-residuals' &&
			evidence !== undefined &&
			override !== undefined &&
			state.retirement.recipient !== undefined &&
			override.sourceProfileId === state.profileId &&
			override.targetProfileId === expectedProfileId &&
			override.recipient.toLowerCase() === state.retirement.recipient.toLowerCase() &&
			override.completionBlockHash.toLowerCase() === evidence.blockHash.toLowerCase() &&
			override.completionBlockNumber === evidence.blockNumber
		const retirementAllowsReplacement = state.retirement.status === 'drained' || residualOverrideMatches
		if (!retirementAllowsReplacement) throw new Error(`Durable state ${stateFile} contains signer, workflow, obligation, recovery, or audit history for deployment profile ${state.profileId}; drain it first or configure a distinct state file for the new deployment profile ${expectedProfileId}`)
	}
	resetRuntimeStateForProfile(state, expectedProfileId, paused, wallet)
	return true
}

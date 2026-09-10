import type { Address } from '@zoltar/bot-shared/ethereum'
import type { SignerOperationGate } from '@zoltar/bot-shared/execution/signer-operation-gate'
import { CONFIGURATION_REVISION_CONFLICT, type OperatorSettings } from '../config/settings.ts'
import { setRuntimeExecutionAddress, bindRuntimeStateToSigner, recordActivity, type RuntimeState } from '../state/operator-state.ts'

export const CONFIGURATION_COMMIT_INDETERMINATE = 'ConfigurationCommitIndeterminate'
export const CONFIGURATION_COMMITTED_SAFELY_PAUSED = 'ConfigurationCommittedSafelyPaused'

export class SignerOperationBusy extends Error {
	constructor() {
		super('The operator is completing a transaction boundary; retry the configuration request')
		this.name = 'SignerOperationBusy'
	}
}

export class ConfigurationCommitIndeterminate extends Error {
	constructor(cause: unknown) {
		super('The configuration commit outcome is indeterminate. Treat the requested configuration as committed. Execution is safety-paused in this process; inspect and reload the owner configuration and runtime-state files before retry or restart.', { cause })
		this.name = CONFIGURATION_COMMIT_INDETERMINATE
	}
}

export class ConfigurationCommittedSafelyPaused extends Error {
	constructor(stage: string, cause: unknown) {
		super(`The configuration was committed, but ${stage} failed. The bot remains durably safety-paused; reload the committed configuration and explicitly resume after recovery.`, { cause })
		this.name = CONFIGURATION_COMMITTED_SAFELY_PAUSED
	}
}

export function acquireConfigurationGate(gate: SignerOperationGate) {
	if (!gate.acquire('configuration')) throw new SignerOperationBusy()
}

export function runtimeStateCandidate(state: RuntimeState): RuntimeState {
	return {
		...state,
		activities: [...state.activities],
		scheduler: { ...state.scheduler },
		topology:
			state.topology === undefined
				? undefined
				: {
						...state.topology,
						auctions: state.topology.auctions.map(auction => ({ ...auction })),
						pairs: state.topology.pairs.map(pair => ({ ...pair })),
						pools: state.topology.pools.map(pool => ({ ...pool })),
						reports: state.topology.reports.map(report => ({ ...report })),
						universes: state.topology.universes.map(universe => ({ ...universe })),
					},
	}
}

export function latchSafetyPause(state: RuntimeState) {
	state.paused = true
	state.safetyPaused = true
	state.scheduler.status = 'paused'
	state.status = 'paused'
}

export function safelyPausedSettings(settings: OperatorSettings): OperatorSettings {
	return {
		...settings,
		paused: true,
		runtime: { ...settings.runtime, execute: false },
	}
}

export function safetyFailureCheckpoint(checkpoint: RuntimeState, message: string) {
	const failed = runtimeStateCandidate(checkpoint)
	failed.error = message
	recordActivity(failed, {
		message,
		status: 'failed',
		type: 'error',
	})
	return failed
}

export function applyRuntimeSettings(state: RuntimeState, settings: OperatorSettings, address: Address | undefined) {
	if (address !== undefined) bindRuntimeStateToSigner(state, address)
	state.paused = settings.paused || state.safetyPaused
	setRuntimeExecutionAddress(state, address ?? state.signerAddress)
	if (state.paused) state.status = 'paused'
	else state.status = settings.runtime.execute ? 'running' : 'dry-run'
}

export function commitRuntimeState(target: RuntimeState, candidate: RuntimeState) {
	Object.assign(target, candidate)
}

export function isConfigurationRevisionConflict(error: unknown) {
	return error instanceof Error && error.name === CONFIGURATION_REVISION_CONFLICT
}

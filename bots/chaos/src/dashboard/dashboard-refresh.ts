import { CONFIGURATION_REQUEST_TIMEOUT_MS, STATE_REQUEST_TIMEOUT_MS } from '@zoltar/bot-shared/dashboard/polling'
import { type Configuration, parseConfiguration, parseSnapshot, type Snapshot } from './dashboard-data.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import type { MutationLatches, MutationReconciliationTarget } from './dashboard-mutation-latches.ts'
import type { RecoveryContextRefresh } from './dashboard-recovery-contexts.ts'
import { requestJson } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'

type ReconciliationScope = 'configuration and state' | 'state'

export type ReconcileUnknownMutation = (error: unknown, status: HTMLElement, scope: ReconciliationScope, target?: MutationReconciliationTarget) => Promise<{ handled: boolean; reconciled: boolean }>

type DashboardRefreshContext = {
	state: DashboardState
	elements: DashboardElements
	latches: MutationLatches
	renderSnapshot: (value: Snapshot) => void
	renderHeader: (value: Snapshot) => void
	renderHealth: (value: Snapshot) => void
	renderUnavailableRpcHealth: (previousResultIsStale: boolean) => void
	renderUnavailableSubmissionHealth: (previousResultIsStale: boolean) => void
	renderConfiguration: (value: Configuration, force?: boolean) => void
}

/** Loads state and configuration together, renders them, and settles recovery-form and unknown-mutation reconciliation. */
export function createDashboardRefresh(context: DashboardRefreshContext) {
	const { state, elements, latches } = context
	const pendingRecoveryContextRefreshes = new Set<RecoveryContextRefresh>()

	function markRecoveryContextRefreshesLoading() {
		for (const recoveryContext of pendingRecoveryContextRefreshes) {
			recoveryContext.fields.disabled = true
			recoveryContext.retryButton.classList.remove('hidden')
			recoveryContext.retryButton.disabled = true
			recoveryContext.retryButton.textContent = 'Refreshing…'
			recoveryContext.status.textContent = `Loading the current ${recoveryContext.name}…`
		}
	}

	function settleRecoveryContextRefreshes(value: Snapshot | undefined) {
		for (const recoveryContext of pendingRecoveryContextRefreshes) {
			if (value === undefined) {
				recoveryContext.fields.disabled = true
				recoveryContext.retryButton.classList.remove('hidden')
				recoveryContext.retryButton.disabled = false
				recoveryContext.retryButton.textContent = 'Retry'
				recoveryContext.status.textContent = `The current ${recoveryContext.name} is unavailable because dashboard state could not be refreshed.`
				continue
			}
			recoveryContext.retryButton.classList.add('hidden')
			recoveryContext.retryButton.disabled = false
			recoveryContext.retryButton.textContent = 'Retry'
			if (recoveryContext.available(value)) recoveryContext.status.textContent = recoveryContext.loadedMessage
			else {
				recoveryContext.fields.disabled = true
				recoveryContext.status.textContent = recoveryContext.missingMessage
			}
			pendingRecoveryContextRefreshes.delete(recoveryContext)
		}
	}

	async function requestRecoveryContextRefresh(recoveryContext: RecoveryContextRefresh) {
		pendingRecoveryContextRefreshes.add(recoveryContext)
		recoveryContext.fields.disabled = true
		recoveryContext.status.textContent = `Loading the current ${recoveryContext.name}…`
		await refresh()
	}

	function resolveMutationReconciliations() {
		if (state.configurationCommitIndeterminate) {
			latches.applyMutationControlLatches()
			return
		}
		const reconciliationMessage = 'The request outcome was unknown. Current configuration and state were reloaded; review it before another mutation.'
		if (state.pauseMutationUnreconciled) {
			state.pauseMutationUnreconciled = false
			elements.pauseStatus.textContent = reconciliationMessage
		}
		if (state.settingsMutationUnreconciled) {
			state.settingsMutationUnreconciled = false
			elements.settingsSaveStatus.textContent = reconciliationMessage
		}
		if (state.connectivityMutationUnreconciled) {
			state.connectivityMutationUnreconciled = false
			elements.connectivityStatus.textContent = reconciliationMessage
		}
		if (state.signerMutationUnreconciled) {
			state.signerMutationUnreconciled = false
			elements.signerStatus.textContent = reconciliationMessage
		}
		if (state.snapshot !== undefined) context.renderHeader(state.snapshot)
		if (state.configuration !== undefined) context.renderConfiguration(state.configuration)
	}

	function refresh() {
		if (state.refreshPromise !== undefined) return state.refreshPromise
		markRecoveryContextRefreshesLoading()
		elements.rpcHealthRetryButton.disabled = true
		elements.rpcHealthRetryButton.textContent = 'Refreshing…'
		let stateAvailable = false
		let configurationAvailable = false
		state.refreshPromise = (async () => {
			const [stateResult, configurationResult] = await Promise.allSettled([requestJson('/api/state', STATE_REQUEST_TIMEOUT_MS), requestJson('/api/configuration', CONFIGURATION_REQUEST_TIMEOUT_MS)])
			// Transaction explorer links come from the configuration, so it must be current before the state renders.
			const parsedConfiguration = configurationResult.status === 'fulfilled' ? parseConfiguration(configurationResult.value) : undefined
			if (parsedConfiguration !== undefined) state.configuration = parsedConfiguration
			if (stateResult.status === 'fulfilled') {
				const snapshot = parseSnapshot(stateResult.value)
				state.snapshot = snapshot
				state.snapshotStale = false
				context.renderSnapshot(snapshot)
				stateAvailable = true
				elements.globalError.classList.add('hidden')
				settleRecoveryContextRefreshes(snapshot)
			} else {
				state.snapshotStale = true
				if (state.snapshot !== undefined) context.renderHealth(state.snapshot)
				context.renderUnavailableRpcHealth(state.snapshot !== undefined)
				context.renderUnavailableSubmissionHealth(state.snapshot !== undefined)
				elements.globalError.textContent = stateResult.reason instanceof Error ? stateResult.reason.message : 'Dashboard state is unavailable.'
				elements.globalError.classList.remove('hidden')
				settleRecoveryContextRefreshes(undefined)
			}
			if (parsedConfiguration !== undefined) {
				context.renderConfiguration(parsedConfiguration)
				configurationAvailable = true
				if (!state.configurationCommitIndeterminate) elements.configurationStatus.classList.add('hidden')
			} else {
				elements.settingsFields.disabled = true
				elements.configurationStatus.textContent = configurationResult.status === 'rejected' && configurationResult.reason instanceof Error ? configurationResult.reason.message : 'Configuration is unavailable.'
				elements.configurationStatus.className = 'notice error'
			}
			state.selectionControlsAvailable = stateAvailable && configurationAvailable
			if (stateAvailable && configurationAvailable) {
				resolveMutationReconciliations()
			}
			latches.applyMutationControlLatches()
			return { configurationAvailable, stateAvailable }
		})().finally(() => {
			state.refreshPromise = undefined
			elements.rpcHealthRetryButton.disabled = false
			elements.rpcHealthRetryButton.textContent = 'Retry'
		})
		return state.refreshPromise
	}

	const reconcileUnknownMutation: ReconcileUnknownMutation = async (error, status, scope, target) => {
		if (error instanceof Error && error.name === 'ConfigurationCommitIndeterminate') {
			latches.latchConfigurationCommitIndeterminate(status, error.message)
			return { handled: true, reconciled: false }
		}
		if (!(error instanceof Error) || error.name !== 'MutationOutcomeUnknown') return { handled: false, reconciled: false }
		if (target !== undefined) latches.setMutationReconciliationPending(target)
		status.textContent = `${error.message} Controls remain frozen while the dashboard reloads current ${scope}.`
		const activeRefresh = state.refreshPromise
		if (activeRefresh !== undefined) await activeRefresh
		const result = await refresh()
		const reconciled = scope === 'state' ? result.stateAvailable : result.configurationAvailable && result.stateAvailable
		const verb = scope === 'configuration and state' ? 'were' : 'was'
		status.textContent = reconciled ? `The request outcome was unknown. Current ${scope} ${verb} reloaded; review it before another mutation.` : `The request outcome is still unknown because current ${scope} could not be reloaded. Controls remain frozen while automatic refresh retries.`
		return { handled: true, reconciled }
	}

	return { reconcileUnknownMutation, refresh, requestRecoveryContextRefresh }
}

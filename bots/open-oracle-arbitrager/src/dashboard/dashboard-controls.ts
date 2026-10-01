import { formIsSubmitting, refreshAllFormButtons } from '@zoltar/bot-shared/dashboard/form-state'
import { closeResumePreflight } from '@zoltar/bot-shared/dashboard/resume-preflight'
import { connectivityControlsDisabled, networkTargetStatus, pauseControlState } from './dashboard-format.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import type { DashboardState, NetworkProfile } from './dashboard-state.ts'
import { setText } from './dom.ts'

function pauseButtonLabel(pausing: boolean, paused: boolean) {
	if (pausing) return 'Pausing…'
	return paused ? 'Resume bot' : 'Pause bot'
}

/** A save in flight keeps its fieldset locked regardless of the connection state so later edits cannot be lost. */
function lockWhileSubmitting(fieldset: HTMLFieldSetElement, formId: string, disabled: boolean) {
	fieldset.disabled = disabled || formIsSubmitting(formId)
}

/** Derives every control's enabled state from the connection, configuration, profile-switch, and request latches. */
export function createDashboardControls(state: DashboardState, elements: DashboardElements) {
	function updateConfigurationControls() {
		elements.configurationFieldset.disabled = !state.connected || state.pendingNetworkProfile !== undefined || !state.configurationLoaded || state.latestSnapshot?.networkConfigured !== true || state.configurationLoading
		elements.reloadConfigurationButton.disabled = !state.connected || (state.pendingNetworkProfile !== undefined && !state.profileSwitchTimedOut) || state.configurationLoading
		elements.profileSwitchRetryButton.hidden = !state.profileSwitchTimedOut
		elements.profileSwitchRetryButton.disabled = !state.connected || state.configurationLoading
		elements.profileSwitchRetryActions.hidden = !state.profileSwitchTimedOut
	}

	function renderPauseControls(mutationsEnabled: boolean) {
		const snapshot = state.latestSnapshot
		const pauseControls = pauseControlState({
			connected: mutationsEnabled,
			networkConfigured: snapshot?.networkConfigured === true,
			paused: snapshot?.paused === true,
			snapshotAvailable: snapshot !== undefined,
		})
		const { pauseButton, confirmResume } = elements
		pauseButton.disabled = state.pauseRequestPending !== undefined || pauseControls.pauseDisabled
		pauseButton.textContent = pauseButtonLabel(state.pauseRequestPending === 'pause', snapshot?.paused === true)
		if (state.pauseRequestPending === 'pause') pauseButton.setAttribute('aria-busy', 'true')
		else pauseButton.removeAttribute('aria-busy')
		confirmResume.disabled = state.pauseRequestPending !== undefined || pauseControls.confirmDisabled
		confirmResume.textContent = state.pauseRequestPending === 'resume' ? 'Resuming…' : 'Resume bot'
		if (state.pauseRequestPending === 'resume') confirmResume.setAttribute('aria-busy', 'true')
		else confirmResume.removeAttribute('aria-busy')
	}

	function setControlsEnabled(enabled: boolean) {
		state.connected = enabled
		const mutationsEnabled = enabled && state.pendingNetworkProfile === undefined
		const configurationEnabled = mutationsEnabled && state.configurationLoaded
		const focusedSettingsEnabled = configurationEnabled && state.latestSnapshot?.networkConfigured === true
		renderPauseControls(mutationsEnabled)
		if (!mutationsEnabled) closeResumePreflight()
		lockWhileSubmitting(elements.strategyFieldset, 'strategy-form', !focusedSettingsEnabled || !state.settingsLoaded)
		lockWhileSubmitting(elements.submissionFieldset, 'submission-form', !focusedSettingsEnabled || !state.submissionLoaded)
		lockWhileSubmitting(elements.connectivityFieldset, 'connectivity-form', connectivityControlsDisabled(configurationEnabled, state.connectivityRequestPending) || !state.connectivityLoaded)
		lockWhileSubmitting(elements.deploymentFieldset, 'deployment-form', !focusedSettingsEnabled || !state.deploymentLoaded)
		lockWhileSubmitting(elements.create2Fieldset, 'create2-form', !focusedSettingsEnabled || !state.deploymentLoaded)
		lockWhileSubmitting(elements.signerFieldset, 'signer-form', !focusedSettingsEnabled)
		lockWhileSubmitting(elements.tokensFieldset, 'tokens-form', !focusedSettingsEnabled || !state.tokensLoaded || state.universeSavePending)
		for (const [fieldset, formId] of [
			[elements.runtimeFieldset, 'runtime-form'],
			[elements.settlementFieldset, 'settlement-form'],
			[elements.executionFieldset, 'execution-form'],
			[elements.marketFieldset, 'market-form'],
		] as const) {
			lockWhileSubmitting(fieldset, formId, !focusedSettingsEnabled || !state.focusedRuntimeLoaded)
		}
		elements.networkName.disabled = !enabled || state.pendingNetworkProfile !== undefined || state.persistedNetwork === undefined
		updateConfigurationControls()
		refreshAllFormButtons()
	}

	/** Re-derives control state from the current connection after a latch changed. */
	function syncControls() {
		setControlsEnabled(state.connected)
	}

	function updateSettingsLoadState() {
		const container = elements.settingsLoadState
		const retry = elements.retrySettingsButton
		if (state.configurationLoading) {
			container.hidden = false
			setText('settings-load-status', 'Loading operator configuration…')
			retry.hidden = true
			retry.disabled = true
			return
		}
		if (state.configurationLoaded) {
			container.hidden = true
			retry.hidden = true
			retry.disabled = false
			return
		}
		container.hidden = false
		setText('settings-load-status', state.configurationLoadError === undefined ? 'Operator configuration is unavailable.' : `${state.configurationLoadError} Editable settings remain locked.`)
		retry.hidden = false
		retry.disabled = false
	}

	function updateNetworkTargetStatus() {
		const target = elements.networkTargetStatus
		if (state.pendingNetworkProfile !== undefined) {
			target.hidden = false
			setText('network-target-status', `Switching from ${state.persistedNetwork ?? 'the active chain'} to ${state.pendingNetworkProfile}. Existing chain settings remain visible until the new profile loads.`)
			return
		}
		const status = networkTargetStatus(state.latestSnapshot?.network, state.persistedNetwork)
		target.hidden = status === undefined
		if (status !== undefined) setText('network-target-status', status)
	}

	/** Shows `network` as the saved chain profile that the Settings page edits. */
	function showPersistedNetwork(network: NetworkProfile) {
		elements.networkName.value = network
		elements.networkName.disabled = false
		state.persistedNetwork = network
		setText('settings-chain-scope', `Editing the ${network === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'} profile.`)
	}

	/** Completes a profile switch once both the state poll and the saved configuration report the requested chain. */
	function finishPendingProfileIfReady(network: NetworkProfile) {
		if (state.pendingNetworkProfile !== network || !state.pendingProfileStateConfirmed || state.persistedNetwork !== network) return false
		state.pendingNetworkProfile = undefined
		state.pendingProfileStateConfirmed = false
		state.profileSwitchTimedOut = false
		updateNetworkTargetStatus()
		setText('connectivity-status', 'Chain profile loaded. All settings shown belong to this chain.')
		syncControls()
		return true
	}

	return { setControlsEnabled, syncControls, updateConfigurationControls, updateSettingsLoadState, updateNetworkTargetStatus, showPersistedNetwork, finishPendingProfileIfReady }
}

export type DashboardControls = ReturnType<typeof createDashboardControls>

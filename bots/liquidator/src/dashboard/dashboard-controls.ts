import type { DashboardElements } from './dashboard-elements.ts'
import type { DashboardState } from './dashboard-state.ts'
import type { registerGoLiveForms } from './go-live-forms.ts'
import type { PoolSelection } from './pool-selection.ts'

type GoLiveForms = ReturnType<typeof registerGoLiveForms>

type MutationControlsContext = {
	state: DashboardState
	elements: DashboardElements
	pools: PoolSelection
	/** The Go live forms register after the shared settings forms, so the controls read them lazily. */
	goLiveForms: () => GoLiveForms
}

function pauseButtonLabel(pauseRequestPending: boolean | undefined, paused: boolean | undefined) {
	if (pauseRequestPending !== undefined) return pauseRequestPending ? 'Pausing…' : 'Resuming…'
	return paused === true ? 'Resume' : 'Pause'
}

/** Derives every mutation control's enabled state from the connection, configuration, profile-switch, and request latches. */
export function createMutationControls({ state, elements, pools, goLiveForms }: MutationControlsContext) {
	function renderPauseControls(resumeAvailable: boolean) {
		const { pauseButton, confirmResume } = elements
		const paused = state.snapshot?.paused
		pauseButton.textContent = pauseButtonLabel(state.pauseRequestPending, paused)
		pauseButton.disabled = state.pauseRequestPending !== undefined || state.snapshot === undefined || (paused === true && !resumeAvailable)
		pauseButton.toggleAttribute('aria-busy', state.pauseRequestPending !== undefined)
		if (state.pauseRequestPending !== undefined) pauseButton.setAttribute('aria-busy', 'true')
		confirmResume.textContent = state.pauseRequestPending === false ? 'Resuming…' : 'Resume bot'
		confirmResume.disabled = state.pauseRequestPending !== undefined || !resumeAvailable
		confirmResume.toggleAttribute('aria-busy', state.pauseRequestPending === false)
		if (state.pauseRequestPending === false) confirmResume.setAttribute('aria-busy', 'true')
	}

	function setMutationControlsEnabled(enabled: boolean) {
		pools.updatePoolBrowser()
		const configuration = state.configuration
		const configurationAvailable = enabled && configuration !== undefined
		const chainSettingsAvailable = configurationAvailable && state.pendingNetworkProfile === undefined && configuration?.networkConfigured === true
		const resumeAvailable = configurationAvailable && state.pendingNetworkProfile === undefined && state.configurationConnected && configuration?.networkConfigured === true
		renderPauseControls(resumeAvailable)
		elements.networkFields.disabled = !configurationAvailable || state.pendingNetworkProfile !== undefined
		elements.marketConfigurationFields.disabled = !chainSettingsAvailable
		elements.strategyFields.disabled = !chainSettingsAvailable
		// Execution mode is judged against the live snapshot, so it stays locked until one has arrived.
		goLiveForms().setEnabled(chainSettingsAvailable, state.snapshot !== undefined)
		elements.testMarketSourcesButton.disabled = !chainSettingsAvailable
		elements.recheckRecovery.disabled = !chainSettingsAvailable
		if (!chainSettingsAvailable) {
			for (const control of document.querySelectorAll<HTMLInputElement | HTMLButtonElement>('#recovery-list input, #recovery-list button')) control.disabled = true
		}
		if (state.snapshot !== undefined) pools.renderUniverses(state.snapshot, !chainSettingsAvailable)
		goLiveForms().render(state.snapshot, state.configuration)
	}

	/** Re-derives control state from the current state connection after a latch changed. */
	function syncControls() {
		setMutationControlsEnabled(state.stateConnected)
	}

	/** Whether chain-specific controls stay locked: a profile switch is pending, state is disconnected, or the chain is not configured. */
	function chainSettingsLocked() {
		return state.pendingNetworkProfile !== undefined || !state.stateConnected || state.configuration?.networkConfigured !== true
	}

	return { setMutationControlsEnabled, syncControls, chainSettingsLocked }
}

export type MutationControls = ReturnType<typeof createMutationControls>

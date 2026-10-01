import { renderBlockStatus as renderSharedBlockStatus } from '@zoltar/bot-shared/dashboard/block-status'
import { endpointHealthDetail, endpointRow } from '@zoltar/bot-shared/dashboard/components'
import { renderRepMarketConsensus, renderRepMarketConsensusError } from '@zoltar/bot-shared/dashboard/rep-market-consensus'
import { renderActivities } from './activity-panel.tsx'
import type { Snapshot } from './api-validation.ts'
import { blockStatusText, scanStatusText } from './block-status.ts'
import type { MutationControls } from './dashboard-controls.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import type { HeaderView } from './dashboard-header-view.ts'
import type { DashboardState } from './dashboard-state.ts'
import { renderMarketSources } from './market-source-panel.tsx'
import { renderOverviewAlerts, renderOverviewHealth, renderOverviewMetrics } from './overview-panels.ts'
import type { PoolSelection } from './pool-selection.ts'
import { createRecoveryPanel } from './recovery-panel.ts'

type SnapshotViewContext = {
	state: DashboardState
	elements: DashboardElements
	controls: MutationControls
	header: HeaderView
	pools: PoolSelection
	refresh: () => Promise<void>
	/** Scrolls to the section named by the page's URL fragment; called once, after the first snapshot renders. */
	applyInitialFragment: (fragment: string) => void
}

function pauseButtonAction(snapshot: Snapshot) {
	if (!snapshot.paused) return 'pause'
	return snapshot.execute ? 'confirm-resume' : 'resume'
}

/** Renders a state snapshot into every dashboard panel, and the last known snapshot as stale once polling fails. */
export function createSnapshotView({ state, elements, controls, header, pools, refresh, applyInitialFragment }: SnapshotViewContext) {
	const recovery = createRecoveryPanel({ state, elements, refresh })

	function renderBlockStatus(snapshot = state.snapshot) {
		renderSharedBlockStatus(blockStatusText(snapshot), [elements.blockStatus])
	}

	/** Shows live RPC health only while the snapshot belongs to the configured chain. */
	function renderCurrentRpcEndpointHealth(snapshot = state.snapshot) {
		const configuredNetwork = state.configuration?.network?.name
		const health = snapshot !== undefined && state.configuration?.networkConfigured === true && snapshot.network === configuredNetwork ? snapshot.rpcEndpointHealth : undefined
		elements.rpcEndpointHealth.replaceChildren(...(health ?? []).map(endpoint => endpointRow('rpc-health-item', endpoint, endpointHealthDetail(endpoint))))
	}

	function render(snapshot: Snapshot) {
		state.snapshot = snapshot
		renderBlockStatus(snapshot)
		state.stateConnected = true
		elements.pauseButton.dataset['action'] = pauseButtonAction(snapshot)
		controls.setMutationControlsEnabled(true)
		header.renderNetworkBadge()
		header.renderHeader(snapshot)
		elements.recoveryGuidance.hidden = snapshot.paused
		elements.lastScan.textContent = scanStatusText(snapshot)
		header.renderGlobalNotice(snapshot)
		renderOverviewMetrics(snapshot, state.configuration)
		renderOverviewAlerts(snapshot)
		renderRepMarketConsensus(document, snapshot.centralizedMarket, snapshot.marketConsensus)
		renderMarketSources(state.marketSourceProbeRows ?? snapshot.marketSources)
		recovery.renderRecovery(snapshot)
		pools.renderUniverses(snapshot)
		pools.updatePoolBrowser()
		renderActivities(snapshot.activities, state.configuration?.network?.explorerUrl)
		renderCurrentRpcEndpointHealth(snapshot)
		if (!state.initialFragmentApplied) {
			state.initialFragmentApplied = true
			const fragment = decodeURIComponent(window.location.hash.slice(1))
			if (fragment !== '') applyInitialFragment(fragment)
		}
	}

	function renderConnectionFailure() {
		const snapshot = state.snapshot
		if (snapshot !== undefined) renderOverviewHealth(snapshot, state.configuration, true)
		state.stateConnected = false
		header.renderNetworkBadge()
		renderRepMarketConsensusError(document)
		header.renderDisconnected(snapshot)
		elements.recoveryGuidance.hidden = true
		controls.setMutationControlsEnabled(false)
	}

	/** Re-renders the snapshot-dependent panels after a configuration load changed what they show. */
	function renderConfigurationChange() {
		if (state.snapshot !== undefined) {
			renderOverviewMetrics(state.snapshot, state.configuration, !state.stateConnected)
			header.renderAttention(state.snapshot)
			pools.renderUniverses(state.snapshot)
			pools.updatePoolBrowser()
		}
		renderCurrentRpcEndpointHealth()
	}

	function registerActivityFilter() {
		elements.activityFilter.addEventListener('change', () => renderActivities(state.snapshot?.activities ?? [], state.configuration?.network?.explorerUrl))
	}

	return { render, renderBlockStatus, renderConnectionFailure, renderConfigurationChange, registerActivityFilter }
}

export type SnapshotView = ReturnType<typeof createSnapshotView>

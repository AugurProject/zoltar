import { singleFlight, STATE_REQUEST_TIMEOUT_MS } from '@zoltar/bot-shared/dashboard/polling'
import { decodeSnapshot, type Snapshot } from './api-validation.ts'
import { api, INVALID_RESPONSE } from './dashboard-requests.ts'
import type { SnapshotView } from './dashboard-snapshot-view.ts'
import type { DashboardState } from './dashboard-state.ts'

type StateRefreshContext = {
	state: DashboardState
	view: SnapshotView
	loadConfiguration: (options?: { background?: boolean }) => Promise<boolean>
	/** Asks the bot which profile it runs after a switch outlived its reconnect wait. */
	settleStalledProfileSwitch: () => Promise<void>
}

/**
 * Polls the bot state once at a time and renders it. Responses for an abandoned profile request, or for the old chain while a
 * profile switch is pending, are ignored; once the new chain's state arrives the switch reloads its configuration. A poll
 * also reloads the configuration in the background when its first load failed or the bot reports a newer operator file.
 */
export function createStateRefresh({ state, view, loadConfiguration, settleStalledProfileSwitch }: StateRefreshContext) {
	async function followConfiguration(snapshot: Snapshot) {
		const revision = snapshot.configurationRevision
		if (!state.configurationConnected) {
			if (await loadConfiguration({ background: true })) state.configurationRevision = revision
			return
		}
		if (revision === undefined || revision === state.configurationRevision) return
		// The first snapshot only records the revision; later changes come from this dashboard, another one, or the scan loop.
		if (state.configurationRevision === undefined || (await loadConfiguration({ background: true }))) state.configurationRevision = revision
	}

	return singleFlight(async () => {
		const requestEpoch = state.profileRequestEpoch
		let snapshot: Snapshot
		try {
			const value = await api('/api/state', undefined, STATE_REQUEST_TIMEOUT_MS)
			if (requestEpoch !== state.profileRequestEpoch) return
			try {
				snapshot = decodeSnapshot(value)
			} catch (error) {
				// The bot answered, but not with a snapshot this page understands: retrying cannot fix a version mismatch.
				console.error('The bot returned a state snapshot this dashboard cannot read', error)
				view.renderConnectionFailure('incompatible')
				return
			}
		} catch (error) {
			if (requestEpoch !== state.profileRequestEpoch) return
			// The disconnected header shows a fixed public message, so the failure detail is intentionally not rendered.
			view.renderConnectionFailure(error instanceof Error && error.name === INVALID_RESPONSE ? 'incompatible' : 'unreachable')
			return
		}
		if (state.pendingNetworkProfile !== undefined && snapshot.network !== state.pendingNetworkProfile) {
			if (state.profileSwitchStalled) await settleStalledProfileSwitch()
			return
		}
		view.render(snapshot)
		if (state.pendingNetworkProfile !== undefined) {
			state.pendingProfileStateConfirmed = true
			if (await loadConfiguration()) state.configurationRevision = snapshot.configurationRevision
			return
		}
		await followConfiguration(snapshot)
	})
}

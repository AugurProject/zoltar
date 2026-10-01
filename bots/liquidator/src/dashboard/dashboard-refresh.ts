import { singleFlight, STATE_REQUEST_TIMEOUT_MS } from '@zoltar/bot-shared/dashboard/polling'
import { decodeSnapshot } from './api-validation.ts'
import { api } from './dashboard-requests.ts'
import type { SnapshotView } from './dashboard-snapshot-view.ts'
import type { DashboardState } from './dashboard-state.ts'

type StateRefreshContext = {
	state: DashboardState
	view: SnapshotView
	loadConfiguration: () => Promise<boolean>
}

/**
 * Polls the bot state once at a time and renders it. Responses for an abandoned profile request, or for the old chain while a
 * profile switch is pending, are ignored; once the new chain's state arrives the switch reloads its configuration.
 */
export function createStateRefresh({ state, view, loadConfiguration }: StateRefreshContext) {
	return singleFlight(async () => {
		const requestEpoch = state.profileRequestEpoch
		try {
			const snapshot = decodeSnapshot(await api('/api/state', undefined, STATE_REQUEST_TIMEOUT_MS))
			if (requestEpoch !== state.profileRequestEpoch) return
			if (state.pendingNetworkProfile !== undefined && snapshot.network !== state.pendingNetworkProfile) return
			view.render(snapshot)
			if (state.pendingNetworkProfile !== undefined) {
				state.pendingProfileStateConfirmed = true
				await loadConfiguration()
			}
		} catch (error) {
			if (requestEpoch !== state.profileRequestEpoch) return
			// The disconnected header shows a fixed public message, so the failure detail is intentionally not rendered.
			void error
			view.renderConnectionFailure()
		}
	})
}

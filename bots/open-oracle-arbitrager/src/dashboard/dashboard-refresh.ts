import { requestWithTimeout, singleFlight, STATE_REQUEST_TIMEOUT_MS } from '@zoltar/bot-shared/dashboard/polling'
import type { DashboardControls } from './dashboard-controls.ts'
import { api } from './dashboard-requests.ts'
import type { SnapshotView } from './dashboard-snapshot-view.ts'
import type { DashboardState } from './dashboard-state.ts'
import { isSnapshot } from './snapshot-validation.ts'

type StateRefreshContext = {
	state: DashboardState
	controls: DashboardControls
	view: SnapshotView
}

/**
 * Polls the bot state once at a time and renders it. Responses that belong to an abandoned profile request, or to the old chain
 * while a profile switch is pending, are ignored; a failed poll keeps the last snapshot visible as stale.
 */
export function createStateRefresh({ state, controls, view }: StateRefreshContext) {
	return singleFlight(async () => {
		const requestEpoch = state.profileRequestEpoch
		try {
			const value: unknown = await requestWithTimeout(signal => api('/api/state', { signal }), STATE_REQUEST_TIMEOUT_MS)
			if (requestEpoch !== state.profileRequestEpoch) return
			if (!isSnapshot(value)) throw new Error('Bot returned an invalid state snapshot')
			if (state.pendingNetworkProfile !== undefined && value.network !== state.pendingNetworkProfile) return
			view.render(value)
			if (state.pendingNetworkProfile !== undefined) {
				state.pendingProfileStateConfirmed = true
				controls.finishPendingProfileIfReady(value.network)
			}
		} catch (error) {
			if (requestEpoch !== state.profileRequestEpoch) return
			view.renderPollFailure(error)
		}
	})
}

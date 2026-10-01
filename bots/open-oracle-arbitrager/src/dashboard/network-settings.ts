import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { markFormClean } from '@zoltar/bot-shared/dashboard/form-state'
import { urlLines } from '@zoltar/bot-shared/dashboard/forms'
import { PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE, PROFILE_SWITCH_REQUEST_TIMEOUT_MS, requestWithTimeout } from '@zoltar/bot-shared/dashboard/polling'
import { decodeConnectivity } from './api-validation.ts'
import type { ConfigurationLoader } from './dashboard-configuration.ts'
import type { DashboardControls } from './dashboard-controls.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { api, sendJson } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import { setText } from './dom.ts'
import { applyQuorumRpcUrls, setLoadedRpcQuorum } from './settings-forms.ts'

type NetworkSettingsContext = {
	state: DashboardState
	elements: DashboardElements
	controls: DashboardControls
	configuration: ConfigurationLoader
	refresh: () => Promise<void>
}

/** Wires configuration reloads and the chain-profile switch, which locks every setting until the bot reopens on the selected chain. */
export function registerProfileControls({ state, elements, controls, configuration, refresh }: NetworkSettingsContext) {
	elements.reloadConfigurationButton.addEventListener('click', () => void configuration.loadCompleteConfiguration())
	elements.profileSwitchRetryButton.addEventListener('click', async event => {
		const button = event.currentTarget
		if (!(button instanceof HTMLButtonElement) || state.pendingNetworkProfile === undefined || !state.profileSwitchTimedOut || button.disabled) return
		button.disabled = true
		button.setAttribute('aria-busy', 'true')
		button.textContent = 'Retrying profile load…'
		try {
			await refresh()
			await configuration.loadCompleteConfiguration()
		} finally {
			button.removeAttribute('aria-busy')
			button.textContent = 'Retry profile load'
			controls.updateConfigurationControls()
		}
	})

	elements.networkName.addEventListener('change', async event => {
		const select = event.currentTarget
		if (!(select instanceof HTMLSelectElement) || state.pendingNetworkProfile !== undefined || (select.value !== 'mainnet' && select.value !== 'sepolia') || select.value === state.persistedNetwork) return
		const previousNetwork = state.persistedNetwork
		const requestedNetwork = select.value
		state.profileRequestEpoch += 1
		state.pendingNetworkProfile = requestedNetwork
		state.pendingProfileStateConfirmed = false
		state.profileSwitchTimedOut = false
		select.value = previousNetwork ?? requestedNetwork
		select.disabled = true
		controls.updateNetworkTargetStatus()
		controls.syncControls()
		setText('connectivity-status', '')
		try {
			await requestWithTimeout(signal => api('/api/network-profile', { body: JSON.stringify({ network: requestedNetwork }), headers: { 'content-type': 'application/json' }, method: 'PUT', signal }), PROFILE_SWITCH_REQUEST_TIMEOUT_MS, PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE)
			setText('connectivity-status', 'Profile saved. The bot is switching chains in place; settings will reload automatically.')
			void configuration.waitForNetworkProfile(requestedNetwork)
		} catch (error) {
			if (error instanceof Error && error.message === PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE) {
				setText('connectivity-status', 'The switch request timed out with an unknown outcome. Existing settings remain locked while the dashboard checks the selected profile.')
				void configuration.waitForNetworkProfile(requestedNetwork)
				return
			}
			state.profileRequestEpoch += 1
			state.pendingNetworkProfile = undefined
			state.pendingProfileStateConfirmed = false
			state.profileSwitchTimedOut = false
			setText('connectivity-status', errorMessage(error))
			select.value = previousNetwork ?? 'mainnet'
			controls.updateNetworkTargetStatus()
			controls.syncControls()
		}
	})
	elements.retrySettingsButton.addEventListener('click', () => void configuration.loadCompleteConfiguration())
}

/** Wires the connectivity form, which validates every endpoint for the selected chain before the bot saves it. */
export function registerConnectivityForm({ state, elements, controls, configuration, refresh }: NetworkSettingsContext) {
	elements.connectivityForm.addEventListener('submit', async event => {
		event.preventDefault()
		if (state.connectivityRequestPending) return
		const selectedNetwork = elements.networkName.value
		const selectedNetworkLabel = elements.networkName.selectedOptions.item(0)?.textContent?.trim() ?? 'the selected chain'
		state.connectivityRequestPending = true
		elements.connectivityFieldset.disabled = true
		setText('connectivity-status', `Checking every endpoint for ${selectedNetworkLabel}…`)
		try {
			const connectivity = {
				publicRpcUrls: urlLines(elements.publicRpcUrls.value),
				readRpcUrl: elements.readRpcUrl.value.trim(),
			}
			const rpcQuorum = Number(elements.rpcQuorum.value)
			const quorumRpcUrls = urlLines(elements.quorumRpcUrls.value)
			const response = decodeConnectivity(await sendJson('/api/connectivity', 'PUT', { connectivity, network: selectedNetwork, quorumRpcUrls, rpcQuorum }))
			configuration.loadConnectivity(response.connectivity)
			controls.showPersistedNetwork(response.network)
			elements.rpcQuorum.value = response.rpcQuorum.toString()
			setLoadedRpcQuorum(response.rpcQuorum)
			applyQuorumRpcUrls(response.quorumRpcUrls)
			markFormClean('connectivity-form')
			controls.updateNetworkTargetStatus()
			await refresh()
			setText('connectivity-status', 'Chain and RPCs passed validation and were saved.')
		} catch (error) {
			await refresh()
			setText('connectivity-status', errorMessage(error))
		} finally {
			state.connectivityRequestPending = false
			controls.syncControls()
		}
	})
}

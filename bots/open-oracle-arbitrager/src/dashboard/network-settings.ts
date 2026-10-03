import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { confirmOperatorAction, reviewChangeRows } from '@zoltar/bot-shared/dashboard/confirmation'
import { markFormClean } from '@zoltar/bot-shared/dashboard/form-state'
import { urlLines } from '@zoltar/bot-shared/dashboard/forms'
import { PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE, PROFILE_SWITCH_REQUEST_TIMEOUT_MS, requestWithTimeout } from '@zoltar/bot-shared/dashboard/polling'
import { decodeConnectivity } from './api-validation.ts'
import type { ConfigurationLoader } from './dashboard-configuration.ts'
import type { DashboardControls } from './dashboard-controls.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { api, sendJson } from './dashboard-requests.ts'
import type { DashboardState, NetworkProfile } from './dashboard-state.ts'
import { setStatus } from './dom.ts'
import { applyQuorumRpcUrls, dirtySettingsPanels, setLoadedRpcQuorum } from './settings-forms.ts'

type NetworkSettingsContext = {
	state: DashboardState
	elements: DashboardElements
	controls: DashboardControls
	configuration: ConfigurationLoader
	refresh: () => Promise<void>
}

function chainLabel(network: NetworkProfile) {
	return network === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'
}

/** What a chain switch does, stated before the operator commits to it: the pause, the chain left unmanaged, and the edits it discards. */
function chainSwitchDescription(from: NetworkProfile, to: NetworkProfile, dirtyPanels: readonly string[]) {
	const discarded = dirtyPanels.length === 0 ? '' : ` Unsaved edits will be lost in: ${dirtyPanels.join(', ')}.`
	return `The bot pauses and loads the saved ${chainLabel(to)} profile with its own settings and journals. It works on one chain at a time: positions, settlements, and withdrawals on ${chainLabel(from)} are not managed until you switch back.${discarded}`
}

/** Wires configuration reloads and the chain-profile switch, which locks every setting until the bot reopens on the selected chain. */
export function registerProfileControls({ state, elements, controls, configuration, refresh }: NetworkSettingsContext) {
	elements.reloadConfigurationButton.addEventListener('click', () => void configuration.reloadDiscardingEdits())
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
		// The selector keeps showing the saved chain until the operator confirms and the bot reports the new profile.
		select.value = previousNetwork ?? requestedNetwork
		if (previousNetwork !== undefined) {
			const confirmed = await confirmOperatorAction({
				title: 'Switch chain profile',
				description: chainSwitchDescription(previousNetwork, requestedNetwork, dirtySettingsPanels()),
				changes: [{ label: 'Chain', before: chainLabel(previousNetwork), after: chainLabel(requestedNetwork) }],
				// A live operator may hold funded positions on the chain it is about to stop managing.
				phrase: state.latestSnapshot?.execute === true ? 'SWITCH CHAIN' : undefined,
				confirmLabel: 'Pause and switch chain',
			})
			if (!confirmed) {
				setStatus('connectivity-status', 'Chain switch canceled.')
				return
			}
			if (state.pendingNetworkProfile !== undefined || state.persistedNetwork !== previousNetwork) return
		}
		state.profileRequestEpoch += 1
		state.pendingNetworkProfile = requestedNetwork
		state.pendingProfileStateConfirmed = false
		state.profileSwitchTimedOut = false
		select.disabled = true
		controls.updateNetworkTargetStatus()
		controls.syncControls()
		setStatus('connectivity-status', '')
		try {
			await requestWithTimeout(signal => api('/api/network-profile', { body: JSON.stringify({ network: requestedNetwork }), headers: { 'content-type': 'application/json' }, method: 'PUT', signal }), PROFILE_SWITCH_REQUEST_TIMEOUT_MS, PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE)
			setStatus('connectivity-status', 'Profile saved. The bot is switching chains in place; settings will reload automatically.')
			void configuration.waitForNetworkProfile(requestedNetwork)
		} catch (error) {
			if (error instanceof Error && error.message === PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE) {
				setStatus('connectivity-status', 'The switch request timed out with an unknown outcome. Existing settings remain locked while the dashboard checks the selected profile.')
				void configuration.waitForNetworkProfile(requestedNetwork)
				return
			}
			state.profileRequestEpoch += 1
			state.pendingNetworkProfile = undefined
			state.pendingProfileStateConfirmed = false
			state.profileSwitchTimedOut = false
			setStatus('connectivity-status', errorMessage(error), true)
			select.value = previousNetwork ?? 'mainnet'
			controls.updateNetworkTargetStatus()
			controls.syncControls()
		}
	})
	elements.retrySettingsButton.addEventListener('click', () => void configuration.reloadDiscardingEdits())
}

/** Wires the connectivity form, which validates every endpoint for the selected chain before the bot saves it. */
export function registerConnectivityForm({ state, elements, controls, configuration, refresh }: NetworkSettingsContext) {
	elements.connectivityForm.addEventListener('submit', async event => {
		event.preventDefault()
		if (state.connectivityRequestPending) return
		const selectedNetwork = elements.networkName.value
		const selectedNetworkLabel = elements.networkName.selectedOptions.item(0)?.textContent?.trim() ?? 'the selected chain'
		const connectivity = {
			publicRpcUrls: urlLines(elements.publicRpcUrls.value),
			readRpcUrl: elements.readRpcUrl.value.trim(),
		}
		const rpcQuorum = Number(elements.rpcQuorum.value)
		const quorumRpcUrls = urlLines(elements.quorumRpcUrls.value)
		// A first save has nothing to compare against; later saves show which endpoints the bot would read from and submit to.
		if (state.savedConnectivity !== undefined) {
			const changes = reviewChangeRows(state.savedConnectivity, { ...connectivity, quorumRpcUrls, rpcQuorum })
			if (
				changes.length !== 0 &&
				!(await confirmOperatorAction({ title: 'Review RPC endpoints', description: 'These endpoints supply the chain state the bot trades on and receive its signed transactions. Each one is checked against the selected chain before it is saved.', changes, confirmLabel: 'Check and save endpoints' }))
			) {
				setStatus('connectivity-status', 'Save canceled.')
				return
			}
			if (state.connectivityRequestPending) return
		}
		state.connectivityRequestPending = true
		elements.connectivityFieldset.disabled = true
		setStatus('connectivity-status', `Checking every endpoint for ${selectedNetworkLabel}…`)
		try {
			const response = decodeConnectivity(await sendJson('/api/connectivity', 'PUT', { connectivity, network: selectedNetwork, quorumRpcUrls, rpcQuorum }))
			configuration.loadConnectivity(response.connectivity)
			controls.showPersistedNetwork(response.network)
			elements.rpcQuorum.value = response.rpcQuorum.toString()
			setLoadedRpcQuorum(response.rpcQuorum)
			applyQuorumRpcUrls(response.quorumRpcUrls)
			state.savedConnectivity = { ...response.connectivity, quorumRpcUrls: response.quorumRpcUrls, rpcQuorum: response.rpcQuorum }
			markFormClean('connectivity-form')
			controls.updateNetworkTargetStatus()
			await refresh()
			void configuration.refreshConfigurationView()
			setStatus('connectivity-status', 'Chain and RPCs passed validation and were saved.')
		} catch (error) {
			await refresh()
			setStatus('connectivity-status', errorMessage(error), true)
		} finally {
			state.connectivityRequestPending = false
			controls.syncControls()
		}
	})
}

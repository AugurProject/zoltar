import { urlLines } from '@zoltar/bot-shared/dashboard/forms'
import { PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE, PROFILE_SWITCH_REQUEST_TIMEOUT_MS, waitForProfileReconnect } from '@zoltar/bot-shared/dashboard/polling'
import { decodeConfiguration } from './api-validation.ts'
import type { ConfigurationLoader } from './dashboard-configuration.ts'
import type { MutationControls } from './dashboard-controls.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { actionStatus, put } from './dashboard-requests.ts'
import type { DashboardState } from './dashboard-state.ts'
import { publicFailure } from './pool-presentation.ts'

type NetworkSettingsContext = {
	state: DashboardState
	elements: DashboardElements
	controls: MutationControls
	configuration: ConfigurationLoader
	refresh: () => Promise<void>
	/** Drops a market-source probe taken on the previous chain. */
	clearMarketSourceProbe: () => void
}

function profileLabel(network: string) {
	return network === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'
}

/** Wires the chain-profile switch and the connectivity form; a switch locks every setting until the bot reopens on the selected chain. */
export function registerNetworkSettings({ state, elements, controls, configuration, refresh, clearMarketSourceProbe }: NetworkSettingsContext) {
	const { networkName, networkFields, networkStatus, networkScopeSummary } = elements

	function networkFieldsLocked() {
		return state.pendingNetworkProfile !== undefined || !state.stateConnected || state.configuration === undefined
	}

	async function waitForNetworkProfile(network: string) {
		await waitForProfileReconnect(
			async () => {
				await refresh()
				return state.pendingNetworkProfile === undefined && state.configuration?.network?.name === network ? 'reconnected' : 'waiting'
			},
			() => actionStatus(networkStatus, 'The profile was saved, but the dashboard did not reconnect in time. It keeps retrying automatically.', true),
		)
	}

	networkName.addEventListener('change', async () => {
		if (state.configuration?.network?.name === networkName.value) return
		if (networkName.value !== 'mainnet' && networkName.value !== 'sepolia') return
		const requestedNetwork = networkName.value
		const activeNetwork = state.configuration?.network?.name
		state.profileRequestEpoch += 1
		state.pendingNetworkProfile = requestedNetwork
		state.pendingProfileStateConfirmed = false
		if (activeNetwork !== undefined) networkName.value = activeNetwork
		if (activeNetwork !== undefined) networkScopeSummary.textContent = `${profileLabel(activeNetwork)} profile · switching to ${profileLabel(requestedNetwork)}`
		clearMarketSourceProbe()
		networkFields.disabled = true
		controls.syncControls()
		actionStatus(networkStatus, `Switching to the ${profileLabel(requestedNetwork)} profile…`)
		try {
			await put('/api/network-profile', { network: requestedNetwork }, PROFILE_SWITCH_REQUEST_TIMEOUT_MS, PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE)
			networkFields.disabled = true
			actionStatus(networkStatus, 'Profile saved. The bot is switching chains in place; settings will reload automatically.')
			await waitForNetworkProfile(requestedNetwork)
		} catch (error) {
			if (error instanceof Error && error.message === PROFILE_SWITCH_REQUEST_TIMEOUT_MESSAGE) {
				actionStatus(networkStatus, 'The switch request timed out with an unknown outcome. Existing settings remain locked while the dashboard checks the selected profile.')
				await waitForNetworkProfile(requestedNetwork)
				return
			}
			if (state.pendingNetworkProfile === requestedNetwork) {
				state.profileRequestEpoch += 1
				state.pendingNetworkProfile = undefined
				state.pendingProfileStateConfirmed = false
			}
			actionStatus(networkStatus, publicFailure(error, 'Could not switch chain profiles.'), true)
			if (state.configuration?.network !== undefined) {
				networkName.value = state.configuration.network.name
				networkScopeSummary.textContent = `${profileLabel(state.configuration.network.name)} profile · switchable`
			}
			networkFields.disabled = networkFieldsLocked()
		}
	})

	elements.networkForm.addEventListener('submit', async event => {
		event.preventDefault()
		networkFields.disabled = true
		actionStatus(networkStatus, 'Checking every RPC against the selected chain…')
		try {
			const next = decodeConfiguration(
				await put('/api/network-connectivity', {
					connectivity: { publicRpcUrls: urlLines(elements.publicRpcUrls.value), quorumRpcUrls: urlLines(elements.quorumRpcUrls.value), readRpcUrl: elements.readRpcUrl.value.trim(), rpcQuorum: Number(elements.rpcQuorum.value) },
					network: networkName.value,
				}),
			)
			configuration.populateConfiguration(next)
			actionStatus(networkStatus, 'Chain and RPCs passed validation, were saved, and apply to the next scan.')
		} catch (error) {
			actionStatus(networkStatus, publicFailure(error, 'Could not apply the chain and RPC settings.', true), true)
		} finally {
			networkFields.disabled = networkFieldsLocked()
		}
	})
}

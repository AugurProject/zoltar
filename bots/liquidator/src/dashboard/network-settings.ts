import { confirmOperatorAction } from '@zoltar/bot-shared/dashboard/confirmation'
import { formIsSubmitting, setFormSubmitting } from '@zoltar/bot-shared/dashboard/form-state'
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

	/** Reports what the bot says about a switch that outlived its reconnect wait, unlocking the dashboard when it never happened. */
	async function settleStalledProfileSwitch() {
		const requestedNetwork = state.pendingNetworkProfile
		if (requestedNetwork === undefined) return
		const outcome = await configuration.settleStalledProfileSwitch()
		if (outcome === 'settled') return
		if (outcome === 'saved') {
			actionStatus(networkStatus, `The ${profileLabel(requestedNetwork)} profile was saved, but the bot has not reopened on it yet. The dashboard keeps retrying automatically.`, true)
			return
		}
		if (outcome === 'unreachable') {
			actionStatus(networkStatus, `The switch to the ${profileLabel(requestedNetwork)} profile has an unknown outcome because the bot could not be reached. Settings stay locked while the dashboard keeps retrying.`, true)
			return
		}
		const activeNetwork = state.configuration?.network?.name
		actionStatus(networkStatus, `The switch to the ${profileLabel(requestedNetwork)} profile did not take effect${activeNetwork === undefined ? '' : `; the bot still runs the ${profileLabel(activeNetwork)} profile`}. Check the bot logs before retrying.`, true)
		await refresh()
	}

	async function waitForNetworkProfile(network: string) {
		await waitForProfileReconnect(
			async () => {
				await refresh()
				return state.pendingNetworkProfile === undefined && state.configuration?.network?.name === network ? 'reconnected' : 'waiting'
			},
			() => void settleStalledProfileSwitch(),
		)
	}

	networkName.addEventListener('change', async () => {
		const activeNetwork = state.configuration?.network?.name
		const requestedNetwork = networkName.value
		if (activeNetwork === requestedNetwork) return
		if (requestedNetwork !== 'mainnet' && requestedNetwork !== 'sepolia') return
		// The select keeps naming the active profile until the bot has reopened on the requested one.
		if (activeNetwork !== undefined) networkName.value = activeNetwork
		const live = state.snapshot?.execute === true
		const confirmed = await confirmOperatorAction({
			title: 'Switch chain profile',
			description: `Switching pauses the bot and restarts it on the ${profileLabel(requestedNetwork)} profile${live ? ' while live execution is armed' : ''}. Unsaved settings edits are discarded.`,
			phrase: live ? 'SWITCH CHAIN' : undefined,
			confirmLabel: `Switch to ${profileLabel(requestedNetwork)}`,
		})
		// The dialog can outlive a disconnect, another switch, or a configuration reload that already changed the profile.
		if (!confirmed || state.pendingNetworkProfile !== undefined || state.configuration?.network?.name !== activeNetwork || networkFields.disabled) return
		state.profileRequestEpoch += 1
		state.pendingNetworkProfile = requestedNetwork
		state.pendingProfileStateConfirmed = false
		state.profileSwitchStalled = false
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
			controls.syncControls()
		}
	})

	elements.networkForm.addEventListener('submit', async event => {
		event.preventDefault()
		if (formIsSubmitting('network-form')) return
		// The submitting latch keeps the form locked across polls until the request settles.
		setFormSubmitting('network-form', true)
		actionStatus(networkStatus, 'Checking every RPC against the selected chain…')
		try {
			const next = decodeConfiguration(
				await put('/api/network-connectivity', {
					connectivity: { publicRpcUrls: urlLines(elements.publicRpcUrls.value), quorumRpcUrls: urlLines(elements.quorumRpcUrls.value), readRpcUrl: elements.readRpcUrl.value.trim(), rpcQuorum: Number(elements.rpcQuorum.value) },
					network: networkName.value,
				}),
			)
			configuration.populateConfiguration(next, 'network-form')
			actionStatus(networkStatus, 'Chain and RPCs passed validation, were saved, and apply to the next scan.')
		} catch (error) {
			actionStatus(networkStatus, publicFailure(error, 'Could not apply the chain and RPC settings.', true), true)
		} finally {
			setFormSubmitting('network-form', false)
			controls.syncControls()
		}
	})

	return { settleStalledProfileSwitch }
}

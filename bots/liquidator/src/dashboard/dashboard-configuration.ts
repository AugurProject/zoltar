import { markFormClean } from '@zoltar/bot-shared/dashboard/form-state'
import { CONFIGURATION_REQUEST_TIMEOUT_MS } from '@zoltar/bot-shared/dashboard/polling'
import { type Configuration, decodeConfiguration } from './api-validation.ts'
import type { MutationControls } from './dashboard-controls.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import type { HeaderView } from './dashboard-header-view.ts'
import { actionStatus, api } from './dashboard-requests.ts'
import type { SnapshotView } from './dashboard-snapshot-view.ts'
import type { DashboardState } from './dashboard-state.ts'
import type { registerGoLiveForms } from './go-live-forms.ts'
import { renderMarketConfiguration } from './market-configuration-editor.tsx'
import { publicFailure } from './pool-presentation.ts'
import { loadStrategyForm, updateHealthPolicyPreview } from './strategy-form.ts'

/** Each focused form diffs against the loaded configuration; its save button unlocks on edits and the panel shows an Unsaved badge. */
export const TRACKED_FORMS = ['network-form', 'market-configuration-form', 'strategy-form'] as const

type ConfigurationContext = {
	state: DashboardState
	elements: DashboardElements
	controls: MutationControls
	header: HeaderView
	view: SnapshotView
	/** The Go live forms register after the shared settings forms, so the loader reads them lazily. */
	goLiveForms: () => ReturnType<typeof registerGoLiveForms>
	/** Re-applies the section navigation once a load reveals settings the URL fragment may target. */
	syncSectionNavigation: (scrollToTarget: boolean) => void
}

function profileLabel(network: string) {
	return network === 'mainnet' ? 'Ethereum mainnet' : 'Sepolia'
}

/** Loads the configuration document into the Settings forms and completes a chain-profile switch once the new profile arrives. */
export function createConfigurationLoader({ state, elements, controls, header, view, goLiveForms, syncSectionNavigation }: ConfigurationContext) {
	function populateNetworkFields(configuration: Configuration) {
		const { settingsChainScope, networkScopeSummary, networkName, readRpcUrl, publicRpcUrls, quorumRpcUrls, rpcQuorum } = elements
		if (configuration.network !== undefined) {
			const networkLabel = profileLabel(configuration.network.name)
			settingsChainScope.textContent = `Editing the ${networkLabel} profile. Every setting and durable recovery record is retained only for this chain; selecting another chain loads its separate profile.`
			networkScopeSummary.textContent = `${networkLabel} profile · switchable`
			networkName.value = configuration.network.name
			networkName.disabled = false
			readRpcUrl.value = configuration.connectivity?.readRpcUrl ?? ''
			publicRpcUrls.value = configuration.connectivity?.publicRpcUrls.join('\n') ?? ''
			quorumRpcUrls.value = configuration.connectivity?.quorumRpcUrls.join('\n') ?? ''
			rpcQuorum.value = configuration.connectivity?.rpcQuorum?.toString() ?? '1'
		} else {
			settingsChainScope.textContent = 'Select a chain profile first. Every other setting is locked until its chain is verified, and the saved configuration and recovery state belong only to that chain.'
			networkScopeSummary.textContent = 'No profile selected'
			networkName.disabled = false
			readRpcUrl.value = ''
			publicRpcUrls.value = ''
			quorumRpcUrls.value = ''
			rpcQuorum.value = '1'
		}
	}

	function populateConfiguration(configuration: Configuration) {
		if (state.pendingNetworkProfile !== undefined && configuration.network?.name !== state.pendingNetworkProfile) return
		state.configuration = configuration
		state.configurationConnected = true
		header.renderNetworkBadge()
		state.approvedUniverses = new Set(configuration.approvedUniverses)
		state.selectedPools = new Set(configuration.selectedPools.map(pool => pool.toLowerCase()))
		loadStrategyForm(elements, configuration)
		populateNetworkFields(configuration)
		elements.networkFields.disabled = state.pendingNetworkProfile !== undefined
		renderMarketConfiguration(elements.marketConfigurationEditor, configuration)
		elements.marketConfigurationFields.disabled = configuration.networkConfigured !== true
		elements.strategyFields.disabled = configuration.networkConfigured !== true
		goLiveForms().load(configuration)
		elements.configurationStatus.classList.add('hidden')
		elements.configurationStatus.replaceChildren()
		updateHealthPolicyPreview(elements)
		for (const formId of TRACKED_FORMS) markFormClean(formId)
		view.renderConfigurationChange()
		controls.syncControls()
		if (window.location.hash !== '') syncSectionNavigation(true)
	}

	function renderConfigurationFailure(error: unknown) {
		const { configurationStatus, networkBadge } = elements
		state.configuration = undefined
		state.configurationConnected = false
		networkBadge.textContent = 'Network unavailable'
		networkBadge.className = 'badge warning'
		configurationStatus.classList.add('error')
		const message = document.createElement('span')
		message.textContent = publicFailure(error, 'Configuration is unavailable. Check the bot connection, then retry. ')
		const retry = document.createElement('button')
		retry.className = 'secondary compact'
		retry.type = 'button'
		retry.textContent = 'Retry configuration'
		retry.addEventListener('click', loadConfiguration)
		configurationStatus.replaceChildren(message, retry)
		controls.syncControls()
	}

	/** Resolves true once the configuration loaded; a switch in progress keeps the network fields locked on the requested profile. */
	async function loadConfiguration() {
		const expectedNetwork = state.pendingNetworkProfile
		const requestEpoch = state.profileRequestEpoch
		const { configurationStatus, networkName, networkFields } = elements
		elements.strategyFields.disabled = true
		if (expectedNetwork === undefined) {
			configurationStatus.classList.remove('hidden')
			configurationStatus.classList.remove('error')
			configurationStatus.textContent = 'Loading pool selection and strategy…'
		}
		try {
			const configuration = decodeConfiguration(await api('/api/configuration', undefined, CONFIGURATION_REQUEST_TIMEOUT_MS))
			if (state.profileRequestEpoch !== requestEpoch || state.pendingNetworkProfile !== expectedNetwork) return false
			if (expectedNetwork !== undefined && configuration.network?.name !== expectedNetwork) {
				networkName.value = expectedNetwork
				networkFields.disabled = true
				return false
			}
			if (expectedNetwork !== undefined && !state.pendingProfileStateConfirmed) return false
			if (expectedNetwork !== undefined) {
				state.pendingNetworkProfile = undefined
				state.pendingProfileStateConfirmed = false
			}
			populateConfiguration(configuration)
			// A fresh load, including another chain profile, restarts every Go live form from the file.
			goLiveForms().load(configuration, 'all')
			if (expectedNetwork !== undefined) {
				const networkLabel = profileLabel(expectedNetwork)
				actionStatus(elements.networkStatus, configuration.networkConfigured === true ? `${networkLabel} profile loaded. Its saved settings are active.` : `${networkLabel} profile loaded; RPC setup required.`)
			}
			return true
		} catch (error) {
			if (state.profileRequestEpoch !== requestEpoch || state.pendingNetworkProfile !== expectedNetwork) return false
			if (expectedNetwork !== undefined) {
				networkName.value = expectedNetwork
				networkFields.disabled = true
				return false
			}
			renderConfigurationFailure(error)
			return false
		}
	}

	return { populateConfiguration, loadConfiguration }
}

export type ConfigurationLoader = ReturnType<typeof createConfigurationLoader>

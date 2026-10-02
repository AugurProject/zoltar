import { formIsDirty, markFormClean } from '@zoltar/bot-shared/dashboard/form-state'
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

/** Which forms take the loaded values even when they hold unsaved edits: the form that just saved, or every form on a fresh load. */
export type ConfigurationSource = 'all' | (typeof TRACKED_FORMS)[number]

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
	function describeNetworkScope(configuration: Configuration) {
		const { settingsChainScope, networkScopeSummary, networkName } = elements
		networkName.disabled = false
		if (configuration.network === undefined) {
			settingsChainScope.textContent = 'Select a chain profile first. Every other setting is locked until its chain is verified, and the saved configuration and recovery state belong only to that chain.'
			networkScopeSummary.textContent = 'No profile selected'
			return
		}
		const networkLabel = profileLabel(configuration.network.name)
		settingsChainScope.textContent = `Editing the ${networkLabel} profile. Every setting and durable recovery record is retained only for this chain; selecting another chain loads its separate profile.`
		networkScopeSummary.textContent = `${networkLabel} profile · switchable`
	}

	function populateNetworkFields(configuration: Configuration) {
		const { networkName, readRpcUrl, publicRpcUrls, quorumRpcUrls, rpcQuorum } = elements
		if (configuration.network !== undefined) networkName.value = configuration.network.name
		const connectivity = configuration.network === undefined ? undefined : configuration.connectivity
		readRpcUrl.value = connectivity?.readRpcUrl ?? ''
		publicRpcUrls.value = connectivity?.publicRpcUrls.join('\n') ?? ''
		quorumRpcUrls.value = connectivity?.quorumRpcUrls.join('\n') ?? ''
		rpcQuorum.value = connectivity?.rpcQuorum?.toString() ?? '1'
	}

	/**
	 * Installs a configuration the bot returned. A form holding unsaved edits keeps them unless it is the `source` that
	 * just saved or the load is a fresh one (`'all'`), so saving one panel never discards work in another.
	 */
	function populateConfiguration(configuration: Configuration, source?: ConfigurationSource) {
		if (state.pendingNetworkProfile !== undefined && configuration.network?.name !== state.pendingNetworkProfile) return
		// Another chain profile replaces every form: edits made for the previous chain cannot apply to it.
		const fresh = source === 'all' || state.configuration === undefined || state.configuration.network?.name !== configuration.network?.name
		const takesLoadedValues = (formId: (typeof TRACKED_FORMS)[number]) => fresh || source === formId || !formIsDirty(formId)
		state.configuration = configuration
		state.configurationConnected = true
		header.renderNetworkBadge()
		state.approvedUniverses = new Set(configuration.approvedUniverses)
		state.selectedPools = new Set(configuration.selectedPools.map(pool => pool.toLowerCase()))
		describeNetworkScope(configuration)
		if (takesLoadedValues('strategy-form')) {
			loadStrategyForm(elements, configuration)
			markFormClean('strategy-form')
		}
		if (takesLoadedValues('network-form')) {
			populateNetworkFields(configuration)
			markFormClean('network-form')
		}
		if (takesLoadedValues('market-configuration-form')) {
			renderMarketConfiguration(elements.marketConfigurationEditor, configuration)
			markFormClean('market-configuration-form')
		}
		goLiveForms().load(configuration, fresh ? 'all' : undefined)
		elements.configurationStatus.classList.add('hidden')
		elements.configurationStatus.replaceChildren()
		updateHealthPolicyPreview(elements)
		view.renderConfigurationChange()
		controls.syncControls()
		if (fresh && window.location.hash !== '') syncSectionNavigation(true)
	}

	function renderConfigurationFailure(error: unknown) {
		const { configurationStatus, networkBadge } = elements
		state.configuration = undefined
		state.configurationConnected = false
		networkBadge.textContent = 'Network unavailable'
		networkBadge.className = 'badge warning'
		configurationStatus.classList.remove('hidden')
		configurationStatus.classList.add('error')
		const message = document.createElement('span')
		message.textContent = publicFailure(error, 'Configuration is unavailable, so settings are locked. The dashboard retries automatically. ')
		const retry = document.createElement('button')
		retry.className = 'secondary compact'
		retry.type = 'button'
		retry.textContent = 'Retry configuration'
		retry.addEventListener('click', () => void loadConfiguration())
		configurationStatus.replaceChildren(message, retry)
		controls.syncControls()
	}

	/**
	 * Resolves true once the configuration loaded; a switch in progress keeps the network fields locked on the requested
	 * profile. A background load, as a poll starts after a failed load or a newer operator file, leaves the status line and
	 * unsaved edits alone.
	 */
	async function loadConfiguration({ background = false }: { background?: boolean } = {}) {
		const expectedNetwork = state.pendingNetworkProfile
		const requestEpoch = state.profileRequestEpoch
		const { configurationStatus, networkName, networkFields } = elements
		if (!background) elements.strategyFields.disabled = true
		if (expectedNetwork === undefined && !background) {
			configurationStatus.classList.remove('hidden')
			configurationStatus.classList.remove('error')
			configurationStatus.textContent = 'Loading configuration…'
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
				state.profileSwitchStalled = false
			}
			// A fresh load, including another chain profile, restarts every form from the file.
			populateConfiguration(configuration, background ? undefined : 'all')
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
			// A background reload of a configuration that is already loaded keeps it: the next poll tries again.
			if (background && state.configurationConnected) return false
			renderConfigurationFailure(error)
			return false
		}
	}

	/**
	 * Called once a profile switch outlived its reconnect wait: asks the bot which profile it runs. When it still runs the
	 * previous one the switch is abandoned and the dashboard unlocks on that profile.
	 */
	async function settleStalledProfileSwitch(): Promise<'abandoned' | 'saved' | 'settled' | 'unreachable'> {
		const expectedNetwork = state.pendingNetworkProfile
		const requestEpoch = state.profileRequestEpoch
		if (expectedNetwork === undefined) return 'settled'
		let configuration: Configuration
		try {
			configuration = decodeConfiguration(await api('/api/configuration', undefined, CONFIGURATION_REQUEST_TIMEOUT_MS))
		} catch (error) {
			void error
			if (state.profileRequestEpoch === requestEpoch && state.pendingNetworkProfile === expectedNetwork) state.profileSwitchStalled = true
			return state.pendingNetworkProfile === undefined ? 'settled' : 'unreachable'
		}
		if (state.profileRequestEpoch !== requestEpoch || state.pendingNetworkProfile !== expectedNetwork) return 'settled'
		if (configuration.network?.name === expectedNetwork) {
			state.profileSwitchStalled = false
			return 'saved'
		}
		state.profileRequestEpoch += 1
		state.pendingNetworkProfile = undefined
		state.pendingProfileStateConfirmed = false
		state.profileSwitchStalled = false
		populateConfiguration(configuration, 'all')
		return 'abandoned'
	}

	return { populateConfiguration, loadConfiguration, settleStalledProfileSwitch }
}

export type ConfigurationLoader = ReturnType<typeof createConfigurationLoader>

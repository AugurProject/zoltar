import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { markFormClean } from '@zoltar/bot-shared/dashboard/form-state'
import { CONFIGURATION_REQUEST_TIMEOUT_MS, requestWithTimeout, waitForProfileReconnect } from '@zoltar/bot-shared/dashboard/polling'
import type { ConnectivitySettings } from '#monitoring/connectivity'
import { isDeploymentSettings, isRuntimeLimits, isSettlementSettings, isStrategySettings, isStringArray, isSubmissionSettings } from './api-validation.ts'
import type { DashboardControls } from './dashboard-controls.ts'
import type { DashboardElements } from './dashboard-elements.ts'
import { configurationNetwork, isConfigurationEnvelope, persistedConnectivity } from './dashboard-format.ts'
import { api } from './dashboard-requests.ts'
import type { DashboardState, NetworkProfile } from './dashboard-state.ts'
import { setText } from './dom.ts'
import { renderHealth } from './overview-panels.ts'
import { loadCentralizedMarkets, loadDeployment, loadExecutionMode, loadRuntimeLimits, loadSettings, loadSettlement, loadSubmission, setLoadedRpcQuorum } from './settings-forms.ts'
import { renderSettingsInsights } from './settings-insights.ts'

type ConfigurationContext = {
	state: DashboardState
	elements: DashboardElements
	controls: DashboardControls
	refresh: () => Promise<void>
}

function prettyJson(value: unknown) {
	const serialized = JSON.stringify(value, undefined, 2)
	if (serialized === undefined) throw new Error('Configuration cannot be represented as JSON')
	return serialized
}

function configurationField(configuration: unknown, name: string) {
	return typeof configuration === 'object' && configuration !== null && !Array.isArray(configuration) ? Reflect.get(configuration, name) : undefined
}

/** Loads the complete operator configuration into the Settings forms and follows a chain-profile switch until the new profile loads. */
export function createConfigurationLoader({ state, elements, controls, refresh }: ConfigurationContext) {
	function loadConnectivity(connectivity: ConnectivitySettings) {
		elements.readRpcUrl.value = connectivity.readRpcUrl
		elements.publicRpcUrls.value = connectivity.publicRpcUrls.join('\n')
	}

	function synchronizePersistedConnectivity(configuration: unknown) {
		const selectedNetwork = configurationField(configuration, 'network')
		if (selectedNetwork !== 'mainnet' && selectedNetwork !== 'sepolia') throw new Error('Bot returned an invalid active chain profile')
		const rpcQuorum = configurationField(configuration, 'rpcQuorum')
		if (rpcQuorum !== 1 && rpcQuorum !== 2) throw new Error('Bot returned an invalid RPC quorum setting')
		elements.rpcQuorum.value = rpcQuorum.toString()
		setLoadedRpcQuorum(rpcQuorum)
		const focused = persistedConnectivity(configuration)
		if (focused === undefined) {
			elements.readRpcUrl.value = ''
			elements.publicRpcUrls.value = ''
			controls.showPersistedNetwork(selectedNetwork)
		} else {
			loadConnectivity(focused.connectivity)
			controls.showPersistedNetwork(focused.network)
		}
		state.connectivityLoaded = true
		controls.updateNetworkTargetStatus()
	}

	function synchronizeFocusedConfiguration(configuration: unknown) {
		if (typeof configuration !== 'object' || configuration === null || Array.isArray(configuration)) throw new Error('Bot returned an invalid configuration document')
		const strategy = Reflect.get(configuration, 'strategy')
		const submission = Reflect.get(configuration, 'submission')
		const deployment = Reflect.get(configuration, 'deployment')
		const approvedUniverses = Reflect.get(configuration, 'approvedUniverses')
		const runtime = Reflect.get(configuration, 'runtime')
		const settlement = Reflect.get(configuration, 'settlement')
		const centralizedMarkets = Reflect.get(configuration, 'centralizedMarkets')
		if (!isStrategySettings(strategy) || !isSubmissionSettings(submission) || !isDeploymentSettings(deployment) || !isStringArray(approvedUniverses)) throw new Error('Bot returned an invalid configuration document')
		const execute = typeof runtime === 'object' && runtime !== null ? Reflect.get(runtime, 'execute') : undefined
		if (!isRuntimeLimits(runtime) || typeof execute !== 'boolean' || !isSettlementSettings(settlement) || typeof centralizedMarkets !== 'object' || centralizedMarkets === null || Array.isArray(centralizedMarkets)) throw new Error('Bot returned an invalid configuration document')
		state.configuredScanIntervalMilliseconds = strategy.pollMilliseconds
		if (state.latestSnapshot !== undefined) renderHealth(state.latestSnapshot, state.configuredScanIntervalMilliseconds, !state.connected)
		loadSettings(strategy)
		state.settingsLoaded = true
		loadSubmission(submission)
		state.submissionLoaded = true
		synchronizePersistedConnectivity(configuration)
		loadDeployment(deployment, 'configuration')
		state.deploymentLoaded = true
		state.approvedUniverseIds = new Set(approvedUniverses)
		state.tokensLoaded = true
		markFormClean('tokens-form')
		loadRuntimeLimits(runtime)
		loadSettlement(settlement)
		loadExecutionMode(execute)
		loadCentralizedMarkets({ ...centralizedMarkets })
		state.focusedRuntimeLoaded = true
		markFormClean('connectivity-form')
		if (state.latestSnapshot !== undefined) renderSettingsInsights(state.latestSnapshot)
	}

	async function loadCompleteConfiguration() {
		if (state.configurationLoading) return
		const requestEpoch = state.profileRequestEpoch
		state.configurationLoading = true
		state.configurationLoaded = false
		state.configurationLoadError = undefined
		controls.updateConfigurationControls()
		controls.updateSettingsLoadState()
		controls.syncControls()
		setText('configuration-status', 'Loading complete configuration…')
		try {
			const envelope = await requestWithTimeout(signal => api('/api/configuration', { signal }), CONFIGURATION_REQUEST_TIMEOUT_MS, 'Configuration request timed out.')
			if (requestEpoch !== state.profileRequestEpoch) return
			if (!isConfigurationEnvelope(envelope)) throw new Error('Bot returned an invalid configuration document')
			const network = configurationNetwork(envelope.configuration)
			if (state.pendingNetworkProfile !== undefined && network !== state.pendingNetworkProfile) return
			elements.configurationJson.value = prettyJson(envelope.configuration)
			synchronizeFocusedConfiguration(envelope.configuration)
			state.configurationLoaded = true
			state.configurationLoadError = undefined
			setText('configuration-status', '')
			if (network !== undefined) controls.finishPendingProfileIfReady(network)
		} catch (error) {
			if (requestEpoch !== state.profileRequestEpoch) return
			state.configurationLoaded = false
			state.configurationLoadError = errorMessage(error)
			setText('configuration-status', `${state.configurationLoadError} Use Reload configuration to retry.`)
		} finally {
			state.configurationLoading = false
			if (requestEpoch === state.profileRequestEpoch) {
				controls.updateSettingsLoadState()
				controls.syncControls()
			}
		}
	}

	async function waitForNetworkProfile(network: NetworkProfile) {
		const requestEpoch = state.profileRequestEpoch
		await waitForProfileReconnect(
			async () => {
				if (requestEpoch !== state.profileRequestEpoch || state.pendingNetworkProfile !== network) return 'abandoned'
				try {
					await refresh()
					if (state.pendingProfileStateConfirmed) await loadCompleteConfiguration()
					if (state.pendingNetworkProfile === undefined) return 'reconnected'
				} catch (error) {
					// The dashboard is briefly unavailable while the bot releases the old
					// chain's resources and reopens them for the selected profile.
					void error
				}
				return 'waiting'
			},
			() => {
				state.profileSwitchTimedOut = true
				setText('connectivity-status', 'The profile was saved, but the dashboard did not reconnect in time. Retry the profile load when the dashboard is available.')
				controls.updateConfigurationControls()
			},
		)
	}

	return { loadCompleteConfiguration, waitForNetworkProfile, loadConnectivity }
}

export type ConfigurationLoader = ReturnType<typeof createConfigurationLoader>

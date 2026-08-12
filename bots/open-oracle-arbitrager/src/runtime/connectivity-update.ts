import { networkConfiguration, parseNetworkName } from '#config/network'
import type { DeploymentSettings } from '#config/deployment-settings'
import type { PersistedOperatorSettings } from '#config/settings-store'
import type { SubmissionSettings } from '#execution/transaction-submission'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, readRpcChainId, updateConnectivityEndpointChecks, validateConnectivitySettingsForQuorum, validateIndependentReadRpcUrls, type EndpointCheck, type NetworkName } from '#monitoring/connectivity'

export async function checkIndependentRpcChains(rpcUrls: readonly string[], expectedChainId: number, readChainId: typeof readRpcChainId = readRpcChainId) {
	for (const rpcUrl of rpcUrls) {
		const chainId = await readChainId(rpcUrl)
		if (chainId !== expectedChainId) throw new Error(`${endpointLabel(rpcUrl)} returned chain ${chainId.toString()}; expected chain ${expectedChainId.toString()}`)
	}
}

export async function updateOperatorConnectivity(parameters: {
	activeNetwork: NetworkName
	check?: typeof checkConnectivity
	deployment: DeploymentSettings
	endpointState: { endpointChecks: EndpointCheck[] }
	execute: boolean
	persist: (update: (settings: PersistedOperatorSettings) => PersistedOperatorSettings) => Promise<void>
	readChainId?: typeof readRpcChainId
	submission: SubmissionSettings
	value: unknown
}) {
	const { value } = parameters
	if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 2 || !('connectivity' in value) || !('network' in value) || typeof value.network !== 'string') throw new Error('Network and RPC settings are required')
	const networkName = parseNetworkName(value.network)
	const restartRequired = networkName !== parameters.activeNetwork
	if (parameters.execute && restartRequired) throw new Error('Disable live execution and restart before changing chains')
	const selectedNetwork = networkConfiguration(networkName, {
		factory: parameters.deployment.uniswapFactory,
		quoter: parameters.deployment.uniswapQuoter,
		rep: parameters.deployment.rep,
		weth: parameters.deployment.weth,
	})
	const connectivity = validateConnectivitySettingsForQuorum(value.connectivity, parameters.deployment.quorumRpcUrls)
	const runCheck = () => (parameters.check ?? checkConnectivity)(connectivity, selectedNetwork.chain.id)
	if (restartRequired) await runCheck()
	else await updateConnectivityEndpointChecks(parameters.endpointState, runCheck)
	await checkIndependentRpcChains(parameters.deployment.quorumRpcUrls, selectedNetwork.chain.id, parameters.readChainId ?? readRpcChainId)
	await checkSubmissionEndpoints(parameters.submission, selectedNetwork.chain.id)
	await parameters.persist(settings => {
		validateIndependentReadRpcUrls(connectivity.readRpcUrl, settings.deployment.quorumRpcUrls)
		return { ...settings, centralizedMarkets: { ...settings.centralizedMarkets, assetChainId: selectedNetwork.chain.id }, connectivity, network: networkName }
	})
	return { connectivity, network: networkName, restartRequired }
}

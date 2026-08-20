import { networkConfiguration, parseNetworkName } from '#config/network'
import type { DeploymentSettings } from '#config/deployment-settings'
import type { PersistedOperatorSettings } from '#config/settings-store'
import type { SubmissionSettings } from '#execution/transaction-submission'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, readRpcChainId, updateConnectivityEndpointChecks, validateConnectivitySettingsForQuorum, validateIndependentReadRpcUrls, type EndpointCheck, type NetworkName } from '#monitoring/connectivity'
import { configuredQuorumRpcUrlMinimum, type RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'

export async function checkIndependentRpcChains(rpcUrls: readonly string[], expectedChainId: number, readChainId: typeof readRpcChainId = readRpcChainId) {
	for (const rpcUrl of rpcUrls) {
		const chainId = await readChainId(rpcUrl)
		if (chainId !== expectedChainId) throw new Error(`${endpointLabel(rpcUrl)} returned chain ${chainId.toString()}; expected chain ${expectedChainId.toString()}`)
	}
}

export async function updateOperatorConnectivity(parameters: {
	activeNetwork: NetworkName | undefined
	activeRpcQuorum: RpcQuorumRequirement
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
	if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 3 || !('connectivity' in value) || !('network' in value) || !('rpcQuorum' in value) || typeof value.network !== 'string') throw new Error('Network, RPC, and quorum settings are required')
	if (value.rpcQuorum !== 1 && value.rpcQuorum !== 2) throw new Error('RPC quorum must be 1 or 2')
	const rpcQuorum: RpcQuorumRequirement = value.rpcQuorum === 2 ? 2 : 1
	const networkName = parseNetworkName(value.network)
	const initializesNetwork = parameters.activeNetwork === undefined
	if (parameters.activeNetwork !== undefined && networkName !== parameters.activeNetwork) throw new Error('Use a separate operator configuration and durable journal paths to change chains')
	const selectedNetwork = networkConfiguration(networkName, {
		factory: parameters.deployment.uniswapFactory,
		quoter: parameters.deployment.uniswapQuoter,
		rep: parameters.deployment.rep,
		weth: parameters.deployment.weth,
	})
	const connectivity = validateConnectivitySettingsForQuorum(value.connectivity, parameters.deployment.quorumRpcUrls)
	if (parameters.execute && parameters.deployment.quorumRpcUrls.length < configuredQuorumRpcUrlMinimum(rpcQuorum)) throw new Error('Live execution requires at least two independent quorum RPCs (three read endpoints total)')
	const runCheck = () => (parameters.check ?? checkConnectivity)(connectivity, selectedNetwork.chain.id)
	const rpcQuorumChanged = rpcQuorum !== parameters.activeRpcQuorum
	if (initializesNetwork || rpcQuorumChanged) await runCheck()
	else await updateConnectivityEndpointChecks(parameters.endpointState, runCheck)
	await checkIndependentRpcChains(parameters.deployment.quorumRpcUrls, selectedNetwork.chain.id, parameters.readChainId ?? readRpcChainId)
	await checkSubmissionEndpoints(parameters.submission, selectedNetwork.chain.id)
	await parameters.persist(settings => {
		validateIndependentReadRpcUrls(connectivity.readRpcUrl, settings.deployment.quorumRpcUrls)
		return { ...settings, centralizedMarkets: { ...settings.centralizedMarkets, assetChainId: selectedNetwork.chain.id }, connectivity, network: networkName, networkConfigured: true, rpcQuorum }
	})
	return { connectivity, network: networkName, rpcQuorum, rpcQuorumChanged }
}

import { networkConfiguration, parseNetworkName } from '#config/network'
import { validateDeploymentSettings, type DeploymentSettings } from '#config/deployment-settings'
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

/**
 * The RPC endpoints form also owns the independent quorum RPC URLs, which the operator file stores under `deployment`.
 * Splits them off the connectivity request and rebuilds the deployment with the new URLs; identities never change here.
 */
export function splitQuorumRpcUrls(value: unknown, deployment: DeploymentSettings, network: NetworkName) {
	if (typeof value !== 'object' || value === null || Array.isArray(value) || !('quorumRpcUrls' in value)) return { deployment, deploymentChanged: false, value }
	const { quorumRpcUrls, ...connectivityValue } = value
	if (!Array.isArray(quorumRpcUrls) || quorumRpcUrls.some(url => typeof url !== 'string')) throw new Error('Quorum RPC URLs must be an array of URLs')
	const { uniswapV2Enabled, uniswapV3Enabled, uniswapV4Enabled } = deployment
	const next = validateDeploymentSettings({ quorumRpcUrls, uniswapV2Enabled, uniswapV3Enabled, uniswapV4Enabled }, network)
	const deploymentChanged = next.quorumRpcUrls.length !== deployment.quorumRpcUrls.length || next.quorumRpcUrls.some((url, index) => url !== deployment.quorumRpcUrls[index])
	return { deployment: deploymentChanged ? next : deployment, deploymentChanged, value: connectivityValue }
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
	if (parameters.activeNetwork !== undefined && networkName !== parameters.activeNetwork) throw new Error('Select the chain profile before saving its RPC settings')
	const selectedNetwork = networkConfiguration(networkName)
	const connectivity = validateConnectivitySettingsForQuorum(value.connectivity, parameters.deployment.quorumRpcUrls)
	if (parameters.execute && parameters.deployment.quorumRpcUrls.length < configuredQuorumRpcUrlMinimum(rpcQuorum)) throw new Error('Live execution requires at least two independent quorum RPCs (three read endpoints total)')
	const runCheck = () => (parameters.check ?? checkConnectivity)(connectivity, selectedNetwork.chain.id)
	const rpcQuorumChanged = rpcQuorum !== parameters.activeRpcQuorum
	if (initializesNetwork || rpcQuorumChanged) await runCheck()
	else await updateConnectivityEndpointChecks(parameters.endpointState, runCheck)
	await checkIndependentRpcChains(parameters.deployment.quorumRpcUrls, selectedNetwork.chain.id, parameters.readChainId ?? readRpcChainId)
	await checkSubmissionEndpoints(parameters.submission, selectedNetwork.chain.id)
	let centralizedMarkets: PersistedOperatorSettings['centralizedMarkets'] | undefined
	await parameters.persist(settings => {
		validateIndependentReadRpcUrls(connectivity.readRpcUrl, settings.deployment.quorumRpcUrls)
		centralizedMarkets = { ...settings.centralizedMarkets, assetAddress: selectedNetwork.rep, assetChainId: selectedNetwork.chain.id }
		return { ...settings, centralizedMarkets, connectivity, network: networkName, networkConfigured: true, rpcQuorum }
	})
	if (centralizedMarkets === undefined) throw new Error('Connectivity persistence did not apply the operator settings update')
	return { centralizedMarkets, connectivity, network: networkName, rpcQuorum, rpcQuorumChanged }
}

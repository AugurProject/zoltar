import { networkConfiguration, parseNetworkName } from '#config/network'
import type { PersistedOperatorSettings } from '#config/settings-store'
import type { SubmissionSettings } from '#execution/transaction-submission'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, readRpcChainId, updateConnectivityEndpointChecks, validateConnectivitySettings, type EndpointCheck, type NetworkName } from '@zoltar/bot-shared/monitoring/connectivity'
import { parseQuorumConnectivitySettings } from '@zoltar/bot-shared/monitoring/quorum-connectivity'
import { configuredQuorumRpcUrlMinimum, type RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'

export async function checkIndependentRpcChains(rpcUrls: readonly string[], expectedChainId: number, readChainId: typeof readRpcChainId = readRpcChainId) {
	for (const rpcUrl of rpcUrls) {
		const chainId = await readChainId(rpcUrl)
		if (chainId !== expectedChainId) throw new Error(`${endpointLabel(rpcUrl)} returned chain ${chainId.toString()}; expected chain ${expectedChainId.toString()}`)
	}
}

/** The RPC endpoints form sends the primary and public RPCs, the chain, the agreement requirement, and optionally the quorum readers. */
const CONNECTIVITY_REQUEST_KEYS = ['connectivity', 'network', 'quorumRpcUrls', 'rpcQuorum']

export async function updateOperatorConnectivity(parameters: {
	activeNetwork: NetworkName | undefined
	activeRpcQuorum: RpcQuorumRequirement
	check?: typeof checkConnectivity
	endpointState: { endpointChecks: EndpointCheck[] }
	execute: boolean
	persist: (update: (settings: PersistedOperatorSettings) => PersistedOperatorSettings) => Promise<void>
	readChainId?: typeof readRpcChainId
	/** The saved quorum readers, kept when the request omits `quorumRpcUrls`. */
	savedQuorumRpcUrls: readonly string[]
	submission: SubmissionSettings
	value: unknown
}) {
	const { value } = parameters
	if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).some(key => !CONNECTIVITY_REQUEST_KEYS.includes(key)) || !('connectivity' in value) || !('network' in value) || !('rpcQuorum' in value) || typeof value.network !== 'string')
		throw new Error('Network, RPC, and quorum settings are required')
	if (value.rpcQuorum !== 1 && value.rpcQuorum !== 2) throw new Error('RPC quorum must be 1 or 2')
	const rpcQuorum: RpcQuorumRequirement = value.rpcQuorum === 2 ? 2 : 1
	const networkName = parseNetworkName(value.network)
	const initializesNetwork = parameters.activeNetwork === undefined
	if (parameters.activeNetwork !== undefined && networkName !== parameters.activeNetwork) throw new Error('Select the chain profile before saving its RPC settings')
	const selectedNetwork = networkConfiguration(networkName)
	const endpoints = validateConnectivitySettings(value.connectivity)
	const connectivity = parseQuorumConnectivitySettings({ ...endpoints, quorumRpcUrls: 'quorumRpcUrls' in value ? value.quorumRpcUrls : parameters.savedQuorumRpcUrls, rpcQuorum })
	if (parameters.execute && connectivity.quorumRpcUrls.length < configuredQuorumRpcUrlMinimum(rpcQuorum)) throw new Error('Live execution requires at least two independent quorum RPCs (three read endpoints total)')
	const runCheck = () => (parameters.check ?? checkConnectivity)(endpoints, selectedNetwork.chain.id)
	const rpcQuorumChanged = rpcQuorum !== parameters.activeRpcQuorum
	if (initializesNetwork || rpcQuorumChanged) await runCheck()
	else await updateConnectivityEndpointChecks(parameters.endpointState, runCheck)
	await checkIndependentRpcChains(connectivity.quorumRpcUrls, selectedNetwork.chain.id, parameters.readChainId ?? readRpcChainId)
	await checkSubmissionEndpoints(parameters.submission, selectedNetwork.chain.id)
	let centralizedMarkets: PersistedOperatorSettings['centralizedMarkets'] | undefined
	await parameters.persist(settings => {
		centralizedMarkets = { ...settings.centralizedMarkets, assetAddress: selectedNetwork.rep, assetChainId: selectedNetwork.chain.id }
		return { ...settings, centralizedMarkets, connectivity, network: networkName, networkConfigured: true }
	})
	if (centralizedMarkets === undefined) throw new Error('Connectivity persistence did not apply the operator settings update')
	return { centralizedMarkets, connectivity, network: networkName, rpcQuorum, rpcQuorumChanged }
}

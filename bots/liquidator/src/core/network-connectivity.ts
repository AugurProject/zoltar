import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, readRpcChainId, validateConnectivitySettings, validateIndependentReadRpcUrls } from '@zoltar/bot-shared/monitoring/connectivity'
import { configuredQuorumRpcUrlMinimum } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import type { OperatorSettings } from '#config/settings'

type ConnectivityChecks = {
	checkConnectivity: typeof checkConnectivity
	checkSubmissionEndpoints?: typeof checkSubmissionEndpoints
	readRpcChainId: typeof readRpcChainId
}

const defaultChecks: ConnectivityChecks = { checkConnectivity, readRpcChainId }

export async function updateNetworkConnectivity(parameters: { apply: (settings: OperatorSettings) => void; checks?: ConnectivityChecks; persist: (update: (current: OperatorSettings) => OperatorSettings) => Promise<OperatorSettings>; settings: OperatorSettings; value: unknown }) {
	const { settings, value } = parameters
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Network and RPC settings must be an object')
	const networkName = Reflect.get(value, 'network')
	if (networkName !== 'mainnet' && networkName !== 'sepolia') throw new Error('Network must be mainnet or sepolia')
	const rawConnectivity = Reflect.get(value, 'connectivity')
	if (typeof rawConnectivity !== 'object' || rawConnectivity === null || Array.isArray(rawConnectivity)) throw new Error('RPC connectivity settings must be an object')
	const connectivity = validateConnectivitySettings({ publicRpcUrls: Reflect.get(rawConnectivity, 'publicRpcUrls'), readRpcUrl: Reflect.get(rawConnectivity, 'readRpcUrl') })
	const rawQuorumRpcUrls = Reflect.get(rawConnectivity, 'quorumRpcUrls')
	if (!Array.isArray(rawQuorumRpcUrls) || rawQuorumRpcUrls.some(url => typeof url !== 'string')) throw new Error('Independent quorum RPC URLs must be an array of strings')
	const quorumRpcUrls = validateIndependentReadRpcUrls(connectivity.readRpcUrl, rawQuorumRpcUrls.map(String))
	const rawRpcQuorum = Reflect.get(rawConnectivity, 'rpcQuorum') ?? settings.connectivity.rpcQuorum
	if (rawRpcQuorum !== 1 && rawRpcQuorum !== 2) throw new Error('RPC quorum must be 1 or 2')
	const network: OperatorSettings['network'] = networkName === 'mainnet' ? { chainId: 1, explorerUrl: 'https://etherscan.io', name: networkName } : { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: networkName }
	if (network.chainId !== settings.network.chainId) throw new Error('Select the chain profile before saving its RPC settings')
	if (settings.runtime.execute && quorumRpcUrls.length < configuredQuorumRpcUrlMinimum(rawRpcQuorum)) throw new Error('Live execution with RPC quorum 2 requires at least two independent quorum RPCs (three read endpoints total)')
	const checks = parameters.checks ?? defaultChecks
	await checks.checkConnectivity(connectivity, network.chainId)
	for (const rpcUrl of quorumRpcUrls) {
		const chainId = await checks.readRpcChainId(rpcUrl)
		if (chainId !== network.chainId) throw new Error(`${endpointLabel(rpcUrl)} returned chain ${chainId.toString()}`)
	}
	await (checks.checkSubmissionEndpoints ?? checkSubmissionEndpoints)(settings.submission, network.chainId)
	const next = await parameters.persist(current => ({
		...current,
		centralizedMarkets: { ...current.centralizedMarkets, assetChainId: network.chainId },
		childMarketConfigurations: current.childMarketConfigurations.map(configuration => ({ ...configuration, assetChainId: network.chainId })),
		connectivity: { ...connectivity, quorumRpcUrls, rpcQuorum: rawRpcQuorum },
		network,
		networkConfigured: true,
	}))
	parameters.apply(next)
	return next
}

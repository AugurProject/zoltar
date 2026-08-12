import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, readRpcChainId, validateConnectivitySettings, validateIndependentReadRpcUrls } from '@zoltar/bot-shared/monitoring/connectivity'
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
	if (settings.runtime.execute && quorumRpcUrls.length === 0) throw new Error('Live execution requires at least one independent quorum RPC')
	if (settings.runtime.execute && networkName !== settings.network.name) throw new Error('Disable live execution and restart before changing chains')
	const network: OperatorSettings['network'] = networkName === 'mainnet' ? { chainId: 1, explorerUrl: 'https://etherscan.io', name: networkName } : { chainId: 11_155_111, explorerUrl: 'https://sepolia.etherscan.io', name: networkName }
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
		connectivity: { ...connectivity, quorumRpcUrls },
		network,
	}))
	parameters.apply(next)
	return next
}

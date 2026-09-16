import type { StrategySettings } from '#state/operator-state'
import type { SubmissionSettings } from '#execution/transaction-submission'
import type { ConnectivitySettings } from '#monitoring/connectivity'
import { array, booleanValue, decode, numberValue, object, oneOf, optional, stringValue } from '@zoltar/bot-shared/dashboard/response-validation'

export type DashboardDeployment = {
	coordinatorAddresses: readonly string[]
	quorumRpcUrls: readonly string[]
	uniswapFactory: string
	uniswapQuoter: string
	executor?: string | null | undefined
	uniswapRouter?: string | null | undefined
	uniswapV2Router?: string | null | undefined
	uniswapV4PoolManager?: string | null | undefined
	uniswapV4Quoter?: string | null | undefined
	deploymentManifest?: unknown
}

export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every(item => typeof item === 'string')
}

export function isStrategySettings(value: unknown): value is StrategySettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	return (
		typeof Reflect.get(value, 'maxSpotTwapTicks') === 'string' &&
		typeof Reflect.get(value, 'minimumProfitBps') === 'string' &&
		typeof Reflect.get(value, 'minimumProfitWeth') === 'string' &&
		typeof Reflect.get(value, 'minimumRemainingBlocks') === 'string' &&
		typeof Reflect.get(value, 'minimumRemainingSeconds') === 'string' &&
		numberValue(Reflect.get(value, 'pollMilliseconds')) &&
		numberValue(Reflect.get(value, 'twapSeconds'))
	)
}

export function isSubmissionSettings(value: unknown): value is SubmissionSettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	const mode = Reflect.get(value, 'mode')
	return (mode === 'private' || mode === 'public') && numberValue(Reflect.get(value, 'minimumBundleRelaySuccesses')) && isStringArray(Reflect.get(value, 'relayUrls'))
}

export function isDeploymentSettings(value: unknown): value is DashboardDeployment {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
	for (const key of ['uniswapFactory', 'uniswapQuoter']) {
		if (typeof Reflect.get(value, key) !== 'string') return false
	}
	for (const key of ['executor', 'uniswapRouter', 'uniswapV2Router', 'uniswapV4PoolManager', 'uniswapV4Quoter']) {
		const candidate = Reflect.get(value, key)
		if (candidate !== undefined && candidate !== null && typeof candidate !== 'string') return false
	}
	return isStringArray(Reflect.get(value, 'coordinatorAddresses')) && isStringArray(Reflect.get(value, 'quorumRpcUrls'))
}

const isConnectivity = object<ConnectivitySettings>({ publicRpcUrls: array(stringValue), readRpcUrl: stringValue })
export const decodeSettings = (value: unknown) => decode(value, object<{ settings: StrategySettings }>({ settings: isStrategySettings }), 'strategy response')
export const decodeSubmission = (value: unknown) => decode(value, object<{ submission: SubmissionSettings }>({ submission: isSubmissionSettings }), 'submission response')
export const decodeDeployment = (value: unknown) => decode(value, object<{ deployment: DashboardDeployment }>({ deployment: isDeploymentSettings }), 'deployment response')
export const decodeConnectivity = (value: unknown) => decode(value, object<{ connectivity: ConnectivitySettings; network: 'mainnet' | 'sepolia'; rpcQuorum: 1 | 2 }>({ connectivity: isConnectivity, network: oneOf('mainnet', 'sepolia'), rpcQuorum: oneOf(1, 2) }), 'connectivity response')
const addressValue = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
const hashValue = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
export const decodePrediction = (value: unknown) => decode(value, object<{ address: string }>({ address: addressValue }), 'executor prediction')
export const decodeExecutorDeployment = (value: unknown) => decode(value, object<{ address: string; alreadyDeployed: boolean; transactionHash?: string }>({ address: addressValue, alreadyDeployed: booleanValue, transactionHash: optional(hashValue) }), 'executor deployment response')

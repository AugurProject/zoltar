import type { StrategySettings } from '#state/operator-state'
import type { SubmissionSettings } from '#execution/transaction-submission'
import type { ConnectivitySettings } from '#monitoring/connectivity'
import type { StoredRuntimeLimits } from '#config/settings-store'
import type { SettlementSettings } from '#state/settlement-store'
import { array, booleanValue, decode, numberValue, object, oneOf, optional, stringValue } from '@zoltar/bot-shared/dashboard/response-validation'

export type DashboardDeployment = {
	quorumRpcUrls: readonly string[]
	uniswapV2Enabled: boolean
	uniswapV3Enabled: boolean
	uniswapV4Enabled: boolean
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

export const isDeploymentSettings = object<DashboardDeployment>({
	quorumRpcUrls: array(stringValue),
	uniswapV2Enabled: booleanValue,
	uniswapV3Enabled: booleanValue,
	uniswapV4Enabled: booleanValue,
})

export const isSettlementSettings = object<SettlementSettings>({ enabled: booleanValue, maxGasPriceNanoEth: stringValue, minimumProfitWeth: stringValue, rewardWithdrawThresholdEth: stringValue })
export const isRuntimeLimits = object<StoredRuntimeLimits>({
	lookbackBlocks: stringValue,
	maxHedgeSlippageBps: stringValue,
	riskLimits: object<StoredRuntimeLimits['riskLimits']>({ lifecycleGasReserveWeth: stringValue, maxConcurrentPositions: numberValue, maxDailyGasSpendWeth: stringValue, maxPositionNotionalWeth: stringValue, maxTotalLockedWeth: stringValue }),
})
const isExecutionMode = object<{ execute: boolean }>({ execute: booleanValue })
const isRecordValue = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)
const isConnectivity = object<ConnectivitySettings>({ publicRpcUrls: array(stringValue), readRpcUrl: stringValue })
export const decodeSettings = (value: unknown) => decode(value, object<{ settings: StrategySettings }>({ settings: isStrategySettings }), 'strategy response')
export const decodeSettlement = (value: unknown) => decode(value, object<{ settlement: SettlementSettings }>({ settlement: isSettlementSettings }), 'settlement response')
export const decodeRuntimeLimits = (value: unknown) => decode(value, object<{ runtime: StoredRuntimeLimits }>({ runtime: isRuntimeLimits }), 'risk limit response')
export const decodeCentralizedMarkets = (value: unknown) => decode(value, object<{ centralizedMarkets: Record<string, unknown> }>({ centralizedMarkets: isRecordValue }), 'market source response')
export const decodeExecution = (value: unknown) => decode(value, isExecutionMode, 'execution mode response')
export const decodeSubmission = (value: unknown) => decode(value, object<{ submission: SubmissionSettings }>({ submission: isSubmissionSettings }), 'submission response')
export const decodeDeployment = (value: unknown) => decode(value, object<{ deployment: DashboardDeployment }>({ deployment: isDeploymentSettings }), 'deployment response')
export const decodeConnectivity = (value: unknown) =>
	decode(value, object<{ connectivity: ConnectivitySettings; network: 'mainnet' | 'sepolia'; quorumRpcUrls: string[]; rpcQuorum: 1 | 2 }>({ connectivity: isConnectivity, network: oneOf('mainnet', 'sepolia'), quorumRpcUrls: array(stringValue), rpcQuorum: oneOf(1, 2) }), 'connectivity response')
const addressValue = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
const hashValue = (value: unknown): value is string => typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
export const decodePrediction = (value: unknown) => decode(value, object<{ address: string }>({ address: addressValue }), 'executor prediction')
export const decodeExecutorDeployment = (value: unknown) => decode(value, object<{ address: string; alreadyDeployed: boolean; transactionHash?: string }>({ address: addressValue, alreadyDeployed: booleanValue, transactionHash: optional(hashValue) }), 'executor deployment response')

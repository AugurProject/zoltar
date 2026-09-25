import type { MonitoredPool } from './pool-presentation.ts'
import { array, booleanValue, decode, dictionary, numberValue, object, oneOf, optional, stringValue, unknownValue } from '@zoltar/bot-shared/dashboard/response-validation'

export type Activity = {
	at: string
	details?: string
	hash?: string
	message: string
	status: string
}

export type Universe = {
	repToken?: string

	forkedPoolCount: number
	forkQuestionId: string
	id: string
	migratableVaultCount: number
	operationalPoolCount: number
	outcomeIndex?: string
	parentId?: string
	poolCount: number
	selectedPoolCount: number
}

type CentralizedMarket = {
	askDepthEth: string
	bidDepthEth: string
	observations: {
		askDepthEth: string
		bidDepthEth: string
		exchangeId: string
		observedAt: string
		priceRepPerEth: string
		repMarket: string
	}[]
	priceRepPerEth: string
	reasons: string[]
	reliable: boolean
}

type MarketConsensus = {
	cex: { askDepthEth: string; bidDepthEth: string; priceRepPerEth: string; reliable: boolean; sourceCount: number }
	dex: { askDepthEth: string; bidDepthEth: string; priceRepPerEth: string; reliable: boolean; sourceCount: number }
	priceRepPerEth?: string
	reasons: string[]
	reliable: boolean
}

export type MarketSourceRow = {
	assetId: string
	id: string
	kind: 'cex' | 'dex'
	market: string
	reason?: string
	status: 'admitted' | 'excluded' | 'failed' | 'observed'
}

export type Snapshot = {
	activities: Activity[]
	alerts: { message: string; severity: 'error' | 'warning' }[]
	centralizedMarket?: CentralizedMarket
	marketConsensus?: MarketConsensus
	error?: string
	execute: boolean
	deploymentMissingName?: string
	deploymentCheckedBlock?: string
	deploymentCheckedTimestamp?: string
	lastScanAt?: string
	lastScannedBlock?: string
	lastScannedTimestamp?: string
	metrics: {
		approvedUniverseCount: number
		assumedOpenInterestEth: string
		candidateCount: number
		deployedRep: string
		eligiblePoolCount: number
		poolCount: number
		selectedPoolCount: number
		walletEth: string
		walletRep: string
	}
	network?: 'mainnet' | 'sepolia'
	paused: boolean
	rpcEndpointHealth?: { consecutiveFailures: number; error?: string; latencyMilliseconds?: number; nextRetryAt?: string; status: string; target: string }[]
	pendingStagedOperations: { candidateBlock?: string; coordinator: string; historicalRecoveryComplete: boolean; latestRecoveryBlock?: string; nextHistoricalBlock?: string; operationId: string; queuedBlock: string; target: string }[]
	pendingTransactions: { hash: string; label: string; mode: 'private' | 'public'; nonce: string; submissionBlock: string }[]
	operatorCapable: boolean
	pools: MonitoredPool[]
	scanning: boolean
	status: 'connectivity-degraded' | 'dry-run' | 'error' | 'paused' | 'running' | 'starting'
	marketSources: MarketSourceRow[]
	universes: Universe[]
	wallet?: string
}

export type Configuration = {
	approvedUniverses: string[]
	childMarketConfigurations: unknown[]
	centralizedMarkets: unknown
	connectivity?: { publicRpcUrls: string[]; quorumRpcUrls: string[]; readRpcUrl: string; rpcQuorum: 1 | 2 } | undefined
	desiredPools: unknown[]
	network?: { chainId: number; explorerUrl: string; name: 'mainnet' | 'sepolia' } | undefined
	networkConfigured?: boolean | undefined
	runtime: { execute: boolean; historicalLogRecovery: boolean; logLookbackBlocks: number }
	selectedPools: string[]
	strategy: Record<string, string | number | boolean>
	submission: { minimumBundleRelaySuccesses: number; mode: 'private' | 'public'; relayUrls: string[] }
}

const strings = array(stringValue)
const optionalString = optional(stringValue)
const unsignedInteger = (value: unknown): value is string => stringValue(value) && /^\d+$/.test(value)
const address = (value: unknown): value is string => stringValue(value) && /^0x[0-9a-fA-F]{40}$/.test(value)
const network = oneOf('mainnet', 'sepolia')
const marketSource = object<MarketSourceRow>({ assetId: stringValue, id: stringValue, kind: oneOf('cex', 'dex'), market: stringValue, reason: optionalString, status: oneOf('admitted', 'excluded', 'failed', 'observed') })
const marketGroup = object<MarketConsensus['cex']>({ askDepthEth: stringValue, bidDepthEth: stringValue, priceRepPerEth: stringValue, reliable: booleanValue, sourceCount: numberValue })
const pool = object<MonitoredPool>({
	knownVaultCount: stringValue,
	address: stringValue,
	approvedUniverse: booleanValue,
	bestCandidateBonusValueEth: optionalString,
	botVault: object<MonitoredPool['botVault']>({ obligationUnitsDisplay: stringValue, openInterestDisplay: stringValue, healthBps: optional(unsignedInteger), vaultRepBacking: stringValue, claimableFeesEth: stringValue }),
	candidateCount: numberValue,
	centralizedPriceAllowed: booleanValue,
	centralizedPriceDeviationBps: optionalString,
	isPriceValid: booleanValue,
	lastPrice: stringValue,
	multiplierBps: unsignedInteger,
	parent: optional(address),
	universeId: stringValue,
	questionId: stringValue,
	selected: booleanValue,
	systemState: stringValue,
	totalObligationUnitsDisplay: stringValue,
	totalPoolHeldRep: stringValue,
})
const snapshot = object<Snapshot>({
	activities: array(object<Activity>({ at: stringValue, details: optionalString, hash: optional((value: unknown): value is string => stringValue(value) && /^0x[0-9a-fA-F]{64}$/.test(value)), message: stringValue, status: stringValue })),
	alerts: array(object<Snapshot['alerts'][number]>({ message: stringValue, severity: oneOf('error', 'warning') })),
	centralizedMarket: optional(
		object<CentralizedMarket>({
			askDepthEth: stringValue,
			bidDepthEth: stringValue,
			priceRepPerEth: stringValue,
			reasons: strings,
			reliable: booleanValue,
			observations: array(object<CentralizedMarket['observations'][number]>({ askDepthEth: stringValue, bidDepthEth: stringValue, exchangeId: stringValue, observedAt: stringValue, priceRepPerEth: stringValue, repMarket: stringValue })),
		}),
	),
	marketConsensus: optional(object<MarketConsensus>({ cex: marketGroup, dex: marketGroup, priceRepPerEth: optionalString, reasons: strings, reliable: booleanValue })),
	error: optionalString,
	execute: booleanValue,
	deploymentMissingName: optionalString,
	deploymentCheckedBlock: optionalString,
	deploymentCheckedTimestamp: optionalString,
	lastScanAt: optionalString,
	lastScannedBlock: optionalString,
	lastScannedTimestamp: optionalString,
	metrics: object<Snapshot['metrics']>({ approvedUniverseCount: numberValue, assumedOpenInterestEth: stringValue, candidateCount: numberValue, deployedRep: stringValue, eligiblePoolCount: numberValue, poolCount: numberValue, selectedPoolCount: numberValue, walletEth: stringValue, walletRep: stringValue }),
	network: optional(network),
	paused: booleanValue,
	rpcEndpointHealth: optional(array(object<NonNullable<Snapshot['rpcEndpointHealth']>[number]>({ consecutiveFailures: numberValue, error: optionalString, latencyMilliseconds: optional(numberValue), nextRetryAt: optionalString, status: stringValue, target: stringValue }))),
	pendingStagedOperations: array(
		object<Snapshot['pendingStagedOperations'][number]>({ candidateBlock: optionalString, coordinator: stringValue, historicalRecoveryComplete: booleanValue, latestRecoveryBlock: optionalString, nextHistoricalBlock: optionalString, operationId: stringValue, queuedBlock: stringValue, target: stringValue }),
	),
	pendingTransactions: array(object<Snapshot['pendingTransactions'][number]>({ hash: stringValue, label: stringValue, mode: oneOf('private', 'public'), nonce: stringValue, submissionBlock: stringValue })),
	operatorCapable: booleanValue,
	pools: array(pool),
	scanning: booleanValue,
	status: oneOf('connectivity-degraded', 'dry-run', 'error', 'paused', 'running', 'starting'),
	marketSources: array(marketSource),
	universes: array(
		object<Universe>({ repToken: optionalString, forkedPoolCount: numberValue, forkQuestionId: stringValue, id: stringValue, migratableVaultCount: numberValue, operationalPoolCount: numberValue, outcomeIndex: optionalString, parentId: optionalString, poolCount: numberValue, selectedPoolCount: numberValue }),
	),
	wallet: optionalString,
})
const configuration = object<Configuration>({
	approvedUniverses: strings,
	childMarketConfigurations: array(unknownValue),
	centralizedMarkets: unknownValue,
	connectivity: optional(object<NonNullable<Configuration['connectivity']>>({ publicRpcUrls: strings, quorumRpcUrls: strings, readRpcUrl: stringValue, rpcQuorum: oneOf(1, 2) })),
	desiredPools: array(unknownValue),
	network: optional(object<NonNullable<Configuration['network']>>({ chainId: numberValue, explorerUrl: stringValue, name: network })),
	networkConfigured: optional(booleanValue),
	runtime: object<Configuration['runtime']>({ execute: booleanValue, historicalLogRecovery: booleanValue, logLookbackBlocks: numberValue }),
	selectedPools: strings,
	strategy: dictionary((value): value is string | number | boolean => stringValue(value) || numberValue(value) || booleanValue(value)),
	submission: object<Configuration['submission']>({ minimumBundleRelaySuccesses: numberValue, mode: oneOf('private', 'public'), relayUrls: strings }),
})
type MarketProbe = { assets: { assetId: string; sources: { id: string; kind: 'cex' | 'dex'; market: string; reason?: string; status: 'failed' | 'observed' }[] }[]; blockNumber: string }
const marketProbe = object<MarketProbe>({
	blockNumber: stringValue,
	assets: array(object<MarketProbe['assets'][number]>({ assetId: stringValue, sources: array(object<MarketProbe['assets'][number]['sources'][number]>({ id: stringValue, kind: oneOf('cex', 'dex'), market: stringValue, reason: optionalString, status: oneOf('failed', 'observed') })) })),
})

export const decodeSnapshot = (value: unknown) => decode(value, snapshot, 'state snapshot')
export const decodeConfiguration = (value: unknown) => decode(value, configuration, 'configuration document')
export const decodeMarketProbe = (value: unknown) => decode(value, marketProbe, 'market source response')
export const decodeSigner = (value: unknown) => decode(value, object<{ wallet?: string }>({ wallet: optionalString }), 'signer response')

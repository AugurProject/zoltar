import { parsePortfolioPolicy, parsePortfolioSelections, serializePortfolioPolicy, type PortfolioPolicy, type PortfolioSelection } from './portfolio-policy.ts'
import { signerCandidate } from '@zoltar/bot-shared/config/signer'
import { type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { validateSubmissionSettings, type SubmissionSettings } from '@zoltar/bot-shared/execution/transaction-submission'
import { boolean, formatDecimalAmount, integer, parseDecimalAmount, record, nonemptyString as string } from '@zoltar/bot-shared/infrastructure/json-validation'
import { parseCentralizedMarketSettings, serializeCentralizedMarketSettings, type CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { presetNetworkChainId, type NetworkName } from '@zoltar/bot-shared/monitoring/connectivity'
import { parseQuorumConnectivitySettings, unconfiguredQuorumConnectivity, type QuorumConnectivitySettings } from '@zoltar/bot-shared/monitoring/quorum-connectivity'
import { configuredQuorumRpcUrlMinimum } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { parseApprovedUniverses } from '@zoltar/bot-shared/monitoring/universe-policy'
import { resolve } from 'node:path'
import { canonicalDeployment, parseRootMarketSettings, presetNetwork } from './canonical-deployment.ts'

export type StrategySettings = {
	maximumGasCostAttoEth: bigint
	walletAttoRepReserve: bigint
}

/** Operator settings use decimal strings for token amounts and numbers for basis points. */
const SETTINGS_VERSION = 2

export type OperatorSettings = {
	approvedUniverses: bigint[]
	childMarketConfigurations: CentralizedMarketSettings[]
	centralizedMarkets: CentralizedMarketSettings
	connectivity: QuorumConnectivitySettings
	deployment: {
		multicall3: Address
		securityPoolFactory: Address
		weth: Address
		zoltar: Address
	}
	network: {
		chainId: number
		explorerUrl: string
		name: NetworkName
	}
	networkConfigured: boolean
	paused: boolean
	privateKey: Hex | undefined
	runtime: {
		execute: boolean
		historicalLogRecovery: boolean
		logLookbackBlocks: number
		once: boolean
		pollMilliseconds: number
		stateFile: string
		ui: boolean
		uiHost: '0.0.0.0' | '127.0.0.1'
		uiPort: number
	}
	selectedPortfolios: PortfolioSelection[]
	portfolioPolicy: PortfolioPolicy
	strategy: StrategySettings
	submission: SubmissionSettings
	version: typeof SETTINGS_VERSION
}

function uiHost(value: unknown): '0.0.0.0' | '127.0.0.1' {
	if (value === '0.0.0.0' || value === '127.0.0.1') return value
	throw new Error('runtime.uiHost must be 127.0.0.1 or 0.0.0.0')
}

function parseNetworkName(value: unknown): NetworkName {
	if (value === 'mainnet' || value === 'sepolia') return value
	throw new Error('network.name must be mainnet or sepolia')
}

export function parseStrategy(value: unknown): StrategySettings {
	const strategy = record(value, 'strategy')
	return {
		maximumGasCostAttoEth: parseDecimalAmount(strategy['maximumGasCostEth'], 'strategy.maximumGasCostEth'),
		walletAttoRepReserve: parseDecimalAmount(strategy['walletReserveRep'], 'strategy.walletReserveRep'),
	}
}

export function parseSettings(value: unknown): OperatorSettings {
	const root = record(value, 'operator settings')
	if (root['version'] !== SETTINGS_VERSION) throw new Error('operator settings version must be 2')
	const networkConfigured = root['networkConfigured'] === undefined ? root['connectivity'] !== undefined : boolean(root['networkConfigured'], 'networkConfigured')
	if (networkConfigured && (root['network'] === undefined || root['connectivity'] === undefined)) throw new Error('A configured operator requires network and connectivity')
	if (!networkConfigured && root['connectivity'] !== undefined) throw new Error('An unconfigured operator cannot retain RPC connectivity')
	const network = root['network'] === undefined ? presetNetwork('mainnet') : record(root['network'], 'network')
	const chainId = integer(network['chainId'], 'network.chainId', 1, 2 ** 31 - 1)
	const runtime = record(root['runtime'], 'runtime')
	const connectivity = networkConfigured ? parseQuorumConnectivitySettings(root['connectivity']) : unconfiguredQuorumConnectivity()
	const parsedApprovedUniverses = parseApprovedUniverses(root['approvedUniverses'])
	const privateKey = signerCandidate(root['privateKey']).privateKey
	const settings: OperatorSettings = {
		approvedUniverses: parsedApprovedUniverses,
		childMarketConfigurations: (() => {
			const values = root['childMarketConfigurations'] ?? []
			if (!Array.isArray(values)) throw new Error('childMarketConfigurations must be an array')
			return values.map(parseCentralizedMarketSettings)
		})(),
		centralizedMarkets: parseRootMarketSettings(root['centralizedMarkets'], chainId),
		connectivity,
		deployment: canonicalDeployment(chainId),
		network: {
			chainId,
			explorerUrl: string(network['explorerUrl'], 'network.explorerUrl'),
			name: parseNetworkName(network['name']),
		},
		paused: boolean(root['paused'], 'paused'),
		networkConfigured,
		privateKey,
		runtime: {
			execute: boolean(runtime['execute'], 'runtime.execute'),
			historicalLogRecovery: runtime['historicalLogRecovery'] === undefined ? false : boolean(runtime['historicalLogRecovery'], 'runtime.historicalLogRecovery'),
			logLookbackBlocks: integer(runtime['logLookbackBlocks'] ?? 256, 'runtime.logLookbackBlocks', 1, 256),
			once: boolean(runtime['once'], 'runtime.once'),
			pollMilliseconds: integer(runtime['pollMilliseconds'], 'runtime.pollMilliseconds', 1_000, 3_600_000),
			stateFile: resolve(string(runtime['stateFile'], 'runtime.stateFile')),
			ui: boolean(runtime['ui'], 'runtime.ui'),
			uiHost: uiHost(runtime['uiHost']),
			uiPort: integer(runtime['uiPort'], 'runtime.uiPort', 1, 65_535),
		},
		selectedPortfolios: parsePortfolioSelections(root['selectedPortfolios']),
		portfolioPolicy: parsePortfolioPolicy(root['portfolioPolicy']),
		strategy: parseStrategy(root['strategy']),
		submission: validateSubmissionSettings(root['submission']),
		version: SETTINGS_VERSION,
	}
	const canonicalChainId = presetNetworkChainId(settings.network.name)
	if (settings.network.chainId !== canonicalChainId) throw new Error('network name and chainId must identify the same supported chain')
	if (settings.networkConfigured && settings.childMarketConfigurations.some(configuration => configuration.assetChainId !== settings.network.chainId)) throw new Error('Child market configurations must target the configured chain')
	const marketAssetIds = [settings.centralizedMarkets, ...settings.childMarketConfigurations].map(configuration => configuration.assetAddress.toLowerCase())
	if (new Set(marketAssetIds).size !== marketAssetIds.length) throw new Error('Market configurations must target distinct REP assets')
	if (settings.runtime.execute && settings.privateKey === undefined) throw new Error('Live execution requires privateKey')
	if (settings.runtime.execute && settings.connectivity.quorumRpcUrls.length < configuredQuorumRpcUrlMinimum(settings.connectivity.rpcQuorum)) throw new Error('Live execution with RPC quorum 2 requires at least two independent quorum RPCs (three read endpoints total)')
	if (!settings.networkConfigured && (!settings.paused || settings.runtime.execute)) throw new Error('An unconfigured network requires paused dry-run mode')
	return settings
}

export function serializedSettings(settings: OperatorSettings, redactPrivateKey = false) {
	const { assetAddress: _assetAddress, assetChainId: _assetChainId, ...centralizedMarkets } = serializeCentralizedMarketSettings(settings.centralizedMarkets)
	return {
		approvedUniverses: settings.approvedUniverses.map(value => value.toString()),
		childMarketConfigurations: settings.childMarketConfigurations.map(serializeCentralizedMarketSettings),
		centralizedMarkets,
		connectivity: settings.networkConfigured ? { ...settings.connectivity } : undefined,
		network: settings.network,
		networkConfigured: settings.networkConfigured,
		paused: settings.paused,
		privateKey: redactPrivateKey || settings.privateKey === undefined ? null : settings.privateKey,
		runtime: settings.runtime,
		selectedPortfolios: settings.selectedPortfolios.map(selection => ({ address: selection.address, universeId: selection.universeId.toString() })),
		portfolioPolicy: serializePortfolioPolicy(settings.portfolioPolicy),
		strategy: {
			maximumGasCostEth: formatDecimalAmount(settings.strategy.maximumGasCostAttoEth),
			walletReserveRep: formatDecimalAmount(settings.strategy.walletAttoRepReserve),
		},
		submission: settings.submission,
		version: SETTINGS_VERSION,
	}
}

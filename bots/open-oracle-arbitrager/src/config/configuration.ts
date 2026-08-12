import { resolve } from 'node:path'
import type { Address, Hex } from '#ethereum'
import type { DeploymentManifest } from '#config/deployment-auth'
import { validateIndependentReadRpcUrls, type ConnectivitySettings } from '#monitoring/connectivity'
import { type MutableStrategy } from '#state/operator-state'
import { networkConfiguration, type NetworkConfiguration } from '#config/network'
import type { RiskLimits } from '#core/safety-controls'
import { loadOperatorSettings, type PersistedOperatorSettings } from '#config/settings-store'
import type { SubmissionSettings } from '#execution/transaction-submission'
import type { CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'

const defaultConfigurationFile = resolve(import.meta.dir, '..', '..', '.state', 'operator.json')

export function assertDistinctPersistentPaths(settingsFile: string, runtime: Pick<PersistedOperatorSettings['runtime'], 'historyFile' | 'positionFile' | 'priceHistoryFile'>) {
	const persistentPaths = [settingsFile, runtime.historyFile, runtime.positionFile, runtime.priceHistoryFile].map(path => resolve(path))
	if (new Set(persistentPaths).size !== persistentPaths.length) throw new Error('Operator settings and runtime persistence files must use distinct paths')
}

export type Configuration = MutableStrategy & {
	centralizedMarkets: CentralizedMarketSettings
	connectivity: ConnectivitySettings
	coordinatorAddresses: Address[]
	deploymentManifest: DeploymentManifest | undefined
	execute: boolean
	executor: Address | undefined
	historyFile: string
	lookbackBlocks: bigint
	maxHedgeSlippageBps: bigint
	network: NetworkConfiguration
	networkConfigured: boolean
	once: boolean
	openOracle: Address
	operatorSettings: PersistedOperatorSettings
	paused: boolean
	persistedPrivateKey: Hex | undefined
	priceHistoryFile: string
	privateKey: Hex | undefined
	positionFile: string
	quorumRpcUrls: string[]
	riskLimits: RiskLimits
	router: Address | undefined
	settingsFile: string
	submission: SubmissionSettings
	tokenAddresses: Address[]
	ui: boolean
	uiHost: '0.0.0.0' | '127.0.0.1'
	uiPort: number
	v2Router: Address | undefined
	v4PoolManager: Address | undefined
	v4Quoter: Address | undefined
}

export async function loadConfiguration(): Promise<Configuration> {
	const arguments_ = process.argv.slice(2)
	if (arguments_.length > 0) throw new Error(`The arbitrager accepts no command-line arguments. Edit ${process.env['OPEN_ORACLE_ARBITRAGER_CONFIG'] ?? defaultConfigurationFile} or use the operator UI.`)
	const settingsFile = resolve(process.env['OPEN_ORACLE_ARBITRAGER_CONFIG'] ?? defaultConfigurationFile)
	const saved = await loadOperatorSettings(settingsFile)
	if (saved === undefined) throw new Error(`Missing operator configuration at ${settingsFile}. Copy config/operator.example.json there, edit it, and start the bot again.`)
	const deployment = saved.deployment
	const network = networkConfiguration(saved.network, {
		factory: deployment.uniswapFactory,
		quoter: deployment.uniswapQuoter,
		rep: deployment.rep,
		weth: deployment.weth,
	})
	const savedQuorumRpcUrls = validateIndependentReadRpcUrls(saved.connectivity.readRpcUrl, deployment.quorumRpcUrls)
	const quorumRpcUrls = [...savedQuorumRpcUrls]
	if (saved.runtime.execute && quorumRpcUrls.length === 0) throw new Error('Execution is enabled, but the effective RPC configuration has no independent quorum reader')
	if (saved.runtime.execute && deployment.executor === undefined) throw new Error('Execution is enabled, but deployment.executor is not configured')
	if (saved.runtime.execute && deployment.uniswapRouter === undefined) throw new Error('Execution is enabled, but deployment.uniswapRouter is not configured')
	if (saved.runtime.execute && deployment.coordinatorAddresses.length === 0) throw new Error('Execution is enabled, but deployment.coordinatorAddresses is empty')
	if (saved.runtime.execute && deployment.deploymentManifest === undefined) throw new Error('Execution is enabled, but deployment.deploymentManifest is not configured')
	assertDistinctPersistentPaths(settingsFile, saved.runtime)
	return {
		...saved.strategy,
		centralizedMarkets: saved.centralizedMarkets,
		connectivity: saved.connectivity,
		coordinatorAddresses: [...deployment.coordinatorAddresses],
		deploymentManifest: deployment.deploymentManifest,
		execute: saved.runtime.execute,
		executor: deployment.executor,
		historyFile: resolve(saved.runtime.historyFile),
		lookbackBlocks: saved.runtime.lookbackBlocks,
		maxHedgeSlippageBps: saved.runtime.maxHedgeSlippageBps,
		network,
		networkConfigured: saved.networkConfigured,
		once: saved.runtime.once,
		openOracle: deployment.openOracle,
		operatorSettings: saved,
		paused: saved.paused,
		persistedPrivateKey: saved.privateKey,
		priceHistoryFile: resolve(saved.runtime.priceHistoryFile),
		privateKey: saved.privateKey,
		positionFile: resolve(saved.runtime.positionFile),
		quorumRpcUrls,
		riskLimits: saved.runtime.riskLimits,
		router: deployment.uniswapRouter,
		settingsFile,
		submission: saved.submission,
		tokenAddresses: [...new Set([network.rep, ...saved.tokenAddresses])],
		ui: saved.runtime.ui,
		uiHost: saved.runtime.uiHost,
		uiPort: saved.runtime.uiPort,
		v2Router: deployment.uniswapV2Router,
		v4PoolManager: deployment.uniswapV4PoolManager,
		v4Quoter: deployment.uniswapV4Quoter,
	}
}

export function mutableStrategy(config: MutableStrategy): MutableStrategy {
	return {
		maxSpotTwapTicks: config.maxSpotTwapTicks,
		minimumProfitBps: config.minimumProfitBps,
		minimumProfitAttoWeth: config.minimumProfitAttoWeth,
		minimumRemainingBlocks: config.minimumRemainingBlocks,
		minimumRemainingSeconds: config.minimumRemainingSeconds,
		pollMilliseconds: config.pollMilliseconds,
		twapSeconds: config.twapSeconds,
	}
}

export function applyStrategy(target: MutableStrategy, source: MutableStrategy) {
	target.maxSpotTwapTicks = source.maxSpotTwapTicks
	target.minimumProfitBps = source.minimumProfitBps
	target.minimumProfitAttoWeth = source.minimumProfitAttoWeth
	target.minimumRemainingBlocks = source.minimumRemainingBlocks
	target.minimumRemainingSeconds = source.minimumRemainingSeconds
	target.pollMilliseconds = source.pollMilliseconds
	target.twapSeconds = source.twapSeconds
}

import { resolve } from 'node:path'
import { parseApprovedUniverses } from '@zoltar/bot-shared/monitoring/universe-policy'
import { canonicalDeployment, parseRootMarketSettings } from './canonical-deployment.ts'
import { bigintToSafeNumber, getAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { signerCandidate } from '@zoltar/bot-shared/config/signer'
import { validateConnectivitySettings, validateIndependentReadRpcUrls, type ConnectivitySettings, type NetworkName } from '@zoltar/bot-shared/monitoring/connectivity'
import { validateSubmissionSettings, type SubmissionSettings } from '@zoltar/bot-shared/execution/transaction-submission'
import { parseCentralizedMarketSettings, serializeCentralizedMarketSettings, type CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { configuredQuorumRpcUrlMinimum, rpcQuorumRequirement, type RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'

export type CandidatePriority = 'largest-bonus' | 'largest-debt' | 'lowest-top-up'

export type DesiredPoolSettings = {
	initialReportPriorityFeeAttoEthPerGas: bigint
	questionId: bigint
	statoblastSecurityMultiplierBps: bigint
	universeId: bigint
}

export type StrategySettings = {
	allowAutomaticDeposits: boolean
	allowAutomaticPoolCreation: boolean
	allowAutomaticVaultMigrations: boolean
	allowAutomaticWithdrawals: boolean
	candidatePriority: CandidatePriority
	fallbackRepPerEthPrice: bigint
	maximumGasCostAttoEth: bigint
	maximumLiquidationDebtAttoEth: bigint
	maximumOracleRequestCostAttoEth: bigint
	maximumAttoRepPerPool: bigint
	maximumTotalDeployedRep: bigint
	minimumLiquidationDebtAttoEth: bigint
	minimumRepWithdrawalAttoRep: bigint
	minimumRewardValueAttoEth: bigint
	redeemFeesAboveAttoEth: bigint
	stalePriceFundingBufferBps: bigint
	stagedOperationValidForSeconds: bigint
	vaultTargetHealthBps: bigint
	vaultTopUpHealthBps: bigint
	vaultWithdrawHealthBps: bigint
	walletAttoRepReserve: bigint
}

export type OperatorSettings = {
	approvedUniverses: bigint[]
	childMarketConfigurations: CentralizedMarketSettings[]
	centralizedMarkets: CentralizedMarketSettings
	connectivity: ConnectivitySettings & {
		quorumRpcUrls: string[]
		rpcQuorum: RpcQuorumRequirement
	}
	deployment: {
		securityPoolFactory: Address
		weth: Address
		zoltar: Address
	}
	desiredPools: DesiredPoolSettings[]
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
	selectedPools: Address[]
	strategy: StrategySettings
	submission: SubmissionSettings
	version: 1
}

type JsonRecord = Record<string, unknown>

const UNIT = 10n ** 18n

function record(value: unknown, label: string): JsonRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
	return value as JsonRecord
}

function boolean(value: unknown, label: string) {
	if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
	return value
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${label} must be an integer from ${minimum.toString()} through ${maximum.toString()}`)
	return value
}

function string(value: unknown, label: string) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
	return value
}

function parseDecimalAmount(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`${label} must be a non-negative decimal with at most 18 places`)
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * UNIT + BigInt(fraction.padEnd(18, '0'))
}

export function formatDecimalAmount(value: bigint) {
	const whole = value / UNIT
	const fraction = (value % UNIT).toString().padStart(18, '0').replace(/0+$/, '')
	return fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`
}

function parseNetworkName(value: unknown): NetworkName {
	if (value === 'mainnet' || value === 'sepolia') return value
	throw new Error('network.name must be mainnet or sepolia')
}

function parseCandidatePriority(value: unknown): CandidatePriority {
	if (value === 'largest-bonus' || value === 'largest-debt' || value === 'lowest-top-up') return value
	throw new Error('strategy.candidatePriority is invalid')
}

function universeId(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be a non-negative integer string`)
	const parsed = BigInt(value)
	if (parsed >= 2n ** 248n) throw new Error(`${label} must fit in uint248`)
	return parsed
}

function uint256(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be a non-negative integer string`)
	const parsed = BigInt(value)
	if (parsed >= 2n ** 256n) throw new Error(`${label} must fit in uint256`)
	return parsed
}

export function parseDesiredPools(value: unknown): DesiredPoolSettings[] {
	if (!Array.isArray(value)) throw new Error('desiredPools must be an array')
	const parsed = value.map((entry, index) => {
		const desired = record(entry, `desiredPools[${index.toString()}]`)
		const pool = {
			initialReportPriorityFeeAttoEthPerGas: uint256(desired['initialReportPriorityFeeAttoEthPerGas'], `desiredPools[${index.toString()}].initialReportPriorityFeeAttoEthPerGas`),
			questionId: uint256(desired['questionId'], `desiredPools[${index.toString()}].questionId`),
			statoblastSecurityMultiplierBps: uint256(desired['statoblastSecurityMultiplierBps'], `desiredPools[${index.toString()}].statoblastSecurityMultiplierBps`),
			universeId: universeId(desired['universeId'], `desiredPools[${index.toString()}].universeId`),
		}
		if (pool.statoblastSecurityMultiplierBps <= 10_000n) throw new Error(`desiredPools[${index.toString()}].statoblastSecurityMultiplierBps must exceed 10000`)
		return pool
	})
	const ids = parsed.map(pool => `${pool.universeId.toString()}:${pool.questionId.toString()}:${pool.statoblastSecurityMultiplierBps.toString()}:${pool.initialReportPriorityFeeAttoEthPerGas.toString()}`)
	if (new Set(ids).size !== ids.length) throw new Error('desiredPools must not contain duplicates')
	return parsed
}

export function parseStrategy(value: unknown): StrategySettings {
	const strategy = record(value, 'strategy')
	const parsed: StrategySettings = {
		allowAutomaticDeposits: boolean(strategy['allowAutomaticDeposits'], 'strategy.allowAutomaticDeposits'),
		allowAutomaticPoolCreation: strategy['allowAutomaticPoolCreation'] === undefined ? false : boolean(strategy['allowAutomaticPoolCreation'], 'strategy.allowAutomaticPoolCreation'),
		allowAutomaticVaultMigrations: boolean(strategy['allowAutomaticVaultMigrations'], 'strategy.allowAutomaticVaultMigrations'),
		allowAutomaticWithdrawals: boolean(strategy['allowAutomaticWithdrawals'], 'strategy.allowAutomaticWithdrawals'),
		candidatePriority: parseCandidatePriority(strategy['candidatePriority']),
		fallbackRepPerEthPrice: parseDecimalAmount(strategy['fallbackRepPerEthPrice'], 'strategy.fallbackRepPerEthPrice'),
		maximumGasCostAttoEth: parseDecimalAmount(strategy['maximumGasCostEth'], 'strategy.maximumGasCostEth'),
		maximumLiquidationDebtAttoEth: parseDecimalAmount(strategy['maximumLiquidationDebtEth'], 'strategy.maximumLiquidationDebtEth'),
		maximumOracleRequestCostAttoEth: parseDecimalAmount(strategy['maximumOracleRequestCostEth'], 'strategy.maximumOracleRequestCostEth'),
		maximumAttoRepPerPool: parseDecimalAmount(strategy['maximumPerPoolRep'], 'strategy.maximumPerPoolRep'),
		maximumTotalDeployedRep: parseDecimalAmount(strategy['maximumTotalDeployedRep'], 'strategy.maximumTotalDeployedRep'),
		minimumLiquidationDebtAttoEth: parseDecimalAmount(strategy['minimumLiquidationDebtEth'], 'strategy.minimumLiquidationDebtEth'),
		minimumRepWithdrawalAttoRep: parseDecimalAmount(strategy['minimumRepWithdrawalRep'], 'strategy.minimumRepWithdrawalRep'),
		minimumRewardValueAttoEth: parseDecimalAmount(strategy['minimumRewardValueEth'], 'strategy.minimumRewardValueEth'),
		redeemFeesAboveAttoEth: parseDecimalAmount(strategy['redeemFeesAboveEth'], 'strategy.redeemFeesAboveEth'),
		stalePriceFundingBufferBps: BigInt(integer(strategy['stalePriceFundingBufferBps'], 'strategy.stalePriceFundingBufferBps', 10_000, 1_000_000)),
		stagedOperationValidForSeconds: BigInt(integer(strategy['stagedOperationValidForSeconds'], 'strategy.stagedOperationValidForSeconds', 1, 300)),
		vaultTargetHealthBps: BigInt(integer(strategy['vaultTargetHealthBps'], 'strategy.vaultTargetHealthBps', 10_001, 1_000_000)),
		vaultTopUpHealthBps: BigInt(integer(strategy['vaultTopUpHealthBps'], 'strategy.vaultTopUpHealthBps', 10_000, 1_000_000)),
		vaultWithdrawHealthBps: BigInt(integer(strategy['vaultWithdrawHealthBps'], 'strategy.vaultWithdrawHealthBps', 10_001, 1_000_000)),
		walletAttoRepReserve: parseDecimalAmount(strategy['walletReserveRep'], 'strategy.walletReserveRep'),
	}
	if (parsed.minimumLiquidationDebtAttoEth > parsed.maximumLiquidationDebtAttoEth) throw new Error('Minimum liquidation debt cannot exceed the maximum')
	if (parsed.vaultTopUpHealthBps > parsed.vaultTargetHealthBps) throw new Error('Top-up health must not exceed target health')
	if (parsed.vaultTargetHealthBps >= parsed.vaultWithdrawHealthBps) throw new Error('Withdrawal health must exceed target health')
	if (parsed.maximumAttoRepPerPool > parsed.maximumTotalDeployedRep) throw new Error('Per-pool REP limit cannot exceed the total deployed REP limit')
	return parsed
}

function parseConnectivity(value: unknown): OperatorSettings['connectivity'] {
	const connectivity = record(value, 'connectivity')
	const parsed = validateConnectivitySettings({
		publicRpcUrls: connectivity['publicRpcUrls'],
		readRpcUrl: connectivity['readRpcUrl'],
	})
	const rawQuorumRpcUrls = connectivity['quorumRpcUrls']
	if (!Array.isArray(rawQuorumRpcUrls) || rawQuorumRpcUrls.some(value => typeof value !== 'string')) throw new Error('connectivity.quorumRpcUrls must be an array of RPC URLs')
	const quorumRpcUrls = validateIndependentReadRpcUrls(
		parsed.readRpcUrl,
		rawQuorumRpcUrls.map(value => {
			if (typeof value !== 'string') throw new Error('connectivity.quorumRpcUrls must contain only strings')
			return value
		}),
	)
	const configuredRpcQuorum = connectivity['rpcQuorum']
	const rpcQuorum = configuredRpcQuorum === undefined ? rpcQuorumRequirement() : integer(configuredRpcQuorum, 'connectivity.rpcQuorum', 1, 2)
	if (rpcQuorum !== 1 && rpcQuorum !== 2) throw new Error('connectivity.rpcQuorum must be 1 or 2')
	return { ...parsed, quorumRpcUrls, rpcQuorum }
}

export function parseSettings(value: unknown): OperatorSettings {
	const root = record(value, 'operator settings')
	if (root['version'] !== 1) throw new Error('operator settings version must be 1')
	const networkConfigured = root['networkConfigured'] === undefined ? root['connectivity'] !== undefined : boolean(root['networkConfigured'], 'networkConfigured')
	if (networkConfigured && (root['network'] === undefined || root['connectivity'] === undefined)) throw new Error('A configured operator requires network and connectivity')
	if (!networkConfigured && root['connectivity'] !== undefined) throw new Error('An unconfigured operator cannot retain RPC connectivity')
	const network = root['network'] === undefined ? { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' } : record(root['network'], 'network')
	const chainId = integer(network['chainId'], 'network.chainId', 1, 2 ** 31 - 1)
	const runtime = record(root['runtime'], 'runtime')
	const connectivity = networkConfigured ? parseConnectivity(root['connectivity']) : { publicRpcUrls: [], quorumRpcUrls: [], readRpcUrl: 'http://127.0.0.1:1', rpcQuorum: rpcQuorumRequirement() }
	const selectedPools = root['selectedPools']
	if (!Array.isArray(selectedPools)) throw new Error('selectedPools must be an array')
	const parsedApprovedUniverses = parseApprovedUniverses(root['approvedUniverses'])
	const parsedSelectedPools = [
		...new Map(
			selectedPools.map(value => {
				const address = getAddress(string(value, 'selected pool'))
				return [address.toLowerCase(), address] as const
			}),
		).values(),
	]
	const parsedDesiredPools = parseDesiredPools(root['desiredPools'] ?? [])
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
		desiredPools: parsedDesiredPools,
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
			uiHost:
				runtime['uiHost'] === '0.0.0.0'
					? '0.0.0.0'
					: runtime['uiHost'] === '127.0.0.1'
						? '127.0.0.1'
						: (() => {
								throw new Error('runtime.uiHost must be 127.0.0.1 or 0.0.0.0')
							})(),
			uiPort: integer(runtime['uiPort'], 'runtime.uiPort', 1, 65_535),
		},
		selectedPools: parsedSelectedPools,
		strategy: parseStrategy(root['strategy']),
		submission: validateSubmissionSettings(root['submission']),
		version: 1,
	}
	const canonicalChainId = settings.network.name === 'mainnet' ? 1 : 11_155_111
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
		desiredPools: settings.desiredPools.map(pool => ({
			initialReportPriorityFeeAttoEthPerGas: pool.initialReportPriorityFeeAttoEthPerGas.toString(),
			questionId: pool.questionId.toString(),
			statoblastSecurityMultiplierBps: pool.statoblastSecurityMultiplierBps.toString(),
			universeId: pool.universeId.toString(),
		})),
		network: settings.network,
		networkConfigured: settings.networkConfigured,
		paused: settings.paused,
		privateKey: redactPrivateKey || settings.privateKey === undefined ? null : settings.privateKey,
		runtime: settings.runtime,
		selectedPools: settings.selectedPools,
		strategy: {
			allowAutomaticDeposits: settings.strategy.allowAutomaticDeposits,
			allowAutomaticPoolCreation: settings.strategy.allowAutomaticPoolCreation,
			allowAutomaticVaultMigrations: settings.strategy.allowAutomaticVaultMigrations,
			allowAutomaticWithdrawals: settings.strategy.allowAutomaticWithdrawals,
			candidatePriority: settings.strategy.candidatePriority,
			fallbackRepPerEthPrice: formatDecimalAmount(settings.strategy.fallbackRepPerEthPrice),
			maximumGasCostEth: formatDecimalAmount(settings.strategy.maximumGasCostAttoEth),
			maximumLiquidationDebtEth: formatDecimalAmount(settings.strategy.maximumLiquidationDebtAttoEth),
			maximumOracleRequestCostEth: formatDecimalAmount(settings.strategy.maximumOracleRequestCostAttoEth),
			maximumPerPoolRep: formatDecimalAmount(settings.strategy.maximumAttoRepPerPool),
			maximumTotalDeployedRep: formatDecimalAmount(settings.strategy.maximumTotalDeployedRep),
			minimumLiquidationDebtEth: formatDecimalAmount(settings.strategy.minimumLiquidationDebtAttoEth),
			minimumRepWithdrawalRep: formatDecimalAmount(settings.strategy.minimumRepWithdrawalAttoRep),
			minimumRewardValueEth: formatDecimalAmount(settings.strategy.minimumRewardValueAttoEth),
			redeemFeesAboveEth: formatDecimalAmount(settings.strategy.redeemFeesAboveAttoEth),
			stalePriceFundingBufferBps: bigintToSafeNumber(settings.strategy.stalePriceFundingBufferBps, 'Stale-price funding buffer basis points'),
			stagedOperationValidForSeconds: bigintToSafeNumber(settings.strategy.stagedOperationValidForSeconds, 'Staged-operation validity'),
			vaultTargetHealthBps: bigintToSafeNumber(settings.strategy.vaultTargetHealthBps, 'Vault target health basis points'),
			vaultTopUpHealthBps: bigintToSafeNumber(settings.strategy.vaultTopUpHealthBps, 'Vault top-up health basis points'),
			vaultWithdrawHealthBps: bigintToSafeNumber(settings.strategy.vaultWithdrawHealthBps, 'Vault withdrawal health basis points'),
			walletReserveRep: formatDecimalAmount(settings.strategy.walletAttoRepReserve),
		},
		submission: settings.submission,
		version: 1,
	}
}

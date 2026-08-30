import { createHash, randomBytes } from 'node:crypto'
import { dirname, extname, resolve } from 'node:path'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { bigintToSafeNumber, getAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { signerCandidate } from '@zoltar/bot-shared/config/signer'
import { validateConnectivitySettings, validateIndependentReadRpcUrls, type ConnectivitySettings, type NetworkName } from '@zoltar/bot-shared/monitoring/connectivity'
import { validateSubmissionSettings, type SubmissionSettings } from '@zoltar/bot-shared/execution/transaction-submission'
import { parseCentralizedMarketSettings, serializeCentralizedMarketSettings, type CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { configuredQuorumRpcUrlMinimum, rpcQuorumRequirement, type RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { persistentPathIdentitiesMatch, persistentPathIdentity } from '@zoltar/bot-shared/config/persistent-path'

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

type AtomicStrategyAmountKey =
	| 'maximumGasCostAttoEth'
	| 'maximumLiquidationDebtAttoEth'
	| 'maximumOracleRequestCostAttoEth'
	| 'maximumAttoRepPerPool'
	| 'maximumTotalDeployedRep'
	| 'minimumLiquidationDebtAttoEth'
	| 'minimumRepWithdrawalAttoRep'
	| 'minimumRewardValueAttoEth'
	| 'redeemFeesAboveAttoEth'
	| 'walletAttoRepReserve'

export type StoredStrategySettings = {
	[K in Exclude<keyof StrategySettings, AtomicStrategyAmountKey>]: StrategySettings[K] extends bigint ? string | number : StrategySettings[K]
} & {
	maximumGasCostEth: string | number
	maximumLiquidationDebtEth: string | number
	maximumOracleRequestCostEth: string | number
	maximumPerPoolRep: string | number
	maximumTotalDeployedRep: string | number
	minimumLiquidationDebtEth: string | number
	minimumRepWithdrawalRep: string | number
	minimumRewardValueEth: string | number
	redeemFeesAboveEth: string | number
	walletReserveRep: string | number
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

type SettingsFileHandle = {
	close: () => Promise<unknown>
	sync: () => Promise<unknown>
	writeFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
}

export type SettingsFilesystem = {
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'r' | 'wx', mode?: number) => Promise<SettingsFileHandle>
	readFile: (path: string, encoding: 'utf8') => Promise<string>
	rename: (oldPath: string, newPath: string) => Promise<unknown>
	rm: (path: string, options: { force: true }) => Promise<unknown>
}

const settingsFilesystem: SettingsFilesystem = {
	mkdir,
	open,
	readFile,
	rename,
	rm,
}

const defaultSettingsPath = resolve(import.meta.dir, '..', '..', '.state', 'operator.json')
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

export function parseDecimalAmount(value: unknown, label: string) {
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
	const deployment = record(root['deployment'], 'deployment')
	const networkConfigured = root['networkConfigured'] === undefined ? root['connectivity'] !== undefined : boolean(root['networkConfigured'], 'networkConfigured')
	if (networkConfigured && (root['network'] === undefined || root['connectivity'] === undefined)) throw new Error('A configured operator requires network and connectivity')
	if (!networkConfigured && root['connectivity'] !== undefined) throw new Error('An unconfigured operator cannot retain RPC connectivity')
	const network = root['network'] === undefined ? { chainId: 1, explorerUrl: 'https://etherscan.io', name: 'mainnet' } : record(root['network'], 'network')
	const runtime = record(root['runtime'], 'runtime')
	const connectivity = networkConfigured ? parseConnectivity(root['connectivity']) : { publicRpcUrls: [], quorumRpcUrls: [], readRpcUrl: 'http://127.0.0.1:1', rpcQuorum: rpcQuorumRequirement() }
	const selectedPools = root['selectedPools']
	if (!Array.isArray(selectedPools)) throw new Error('selectedPools must be an array')
	const approvedUniverses = root['approvedUniverses']
	if (!Array.isArray(approvedUniverses)) throw new Error('approvedUniverses must be an array')
	const parsedApprovedUniverses = [...new Set(approvedUniverses.map(value => universeId(value, 'approved universe')))]
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
		centralizedMarkets: parseCentralizedMarketSettings(root['centralizedMarkets']),
		connectivity,
		deployment: {
			securityPoolFactory: getAddress(string(deployment['securityPoolFactory'], 'deployment.securityPoolFactory')),
			weth: getAddress(string(deployment['weth'], 'deployment.weth')),
			zoltar: getAddress(string(deployment['zoltar'], 'deployment.zoltar')),
		},
		desiredPools: parsedDesiredPools,
		network: {
			chainId: integer(network['chainId'], 'network.chainId', 1, 2 ** 31 - 1),
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
	if (settings.networkConfigured && settings.centralizedMarkets.assetChainId !== settings.network.chainId) throw new Error('Centralized market configuration must target the configured chain')
	if (settings.networkConfigured && settings.childMarketConfigurations.some(configuration => configuration.assetChainId !== settings.network.chainId)) throw new Error('Child market configurations must target the configured chain')
	const marketAssetIds = [settings.centralizedMarkets, ...settings.childMarketConfigurations].map(configuration => configuration.assetAddress.toLowerCase())
	if (new Set(marketAssetIds).size !== marketAssetIds.length) throw new Error('Market configurations must target distinct REP assets')
	if (settings.runtime.execute && settings.privateKey === undefined) throw new Error('Live execution requires privateKey')
	if (settings.runtime.execute && settings.connectivity.quorumRpcUrls.length < configuredQuorumRpcUrlMinimum(settings.connectivity.rpcQuorum)) throw new Error('Live execution with RPC quorum 2 requires at least two independent quorum RPCs (three read endpoints total)')
	if (settings.runtime.execute && settings.deployment.securityPoolFactory === getAddress('0x0000000000000000000000000000000000000000')) throw new Error('Live execution requires a deployed security-pool factory')
	if (settings.runtime.execute && settings.deployment.weth === getAddress('0x0000000000000000000000000000000000000000')) throw new Error('Live execution requires a deployed WETH contract')
	if (settings.runtime.execute && settings.deployment.zoltar === getAddress('0x0000000000000000000000000000000000000000')) throw new Error('Live execution requires a deployed Zoltar contract')
	if (!settings.networkConfigured && (!settings.paused || settings.runtime.execute)) throw new Error('An unconfigured network requires paused dry-run mode')
	return settings
}

export function serializedSettings(settings: OperatorSettings, redactPrivateKey = false) {
	return {
		approvedUniverses: settings.approvedUniverses.map(value => value.toString()),
		childMarketConfigurations: settings.childMarketConfigurations.map(serializeCentralizedMarketSettings),
		centralizedMarkets: serializeCentralizedMarketSettings(settings.centralizedMarkets),
		connectivity: settings.networkConfigured ? { ...settings.connectivity } : undefined,
		deployment: settings.deployment,
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

function revision(contents: string) {
	return createHash('sha256').update(contents).digest('hex')
}

export async function loadSettings(path = resolve(process.env['ZOLTAR_LIQUIDATOR_CONFIG'] ?? defaultSettingsPath)) {
	const contents = await readFile(path, 'utf8').catch(error => {
		if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
		throw error
	})
	if (contents === undefined) throw new Error(`Missing liquidator configuration at ${path}. Copy config/operator.example.json there and edit it.`)
	return { path, revision: revision(contents), settings: parseSettings(JSON.parse(contents)) }
}

export async function saveSettings(path: string, settings: OperatorSettings, expectedRevision?: string, filesystem: SettingsFilesystem = settingsFilesystem) {
	const contents = `${JSON.stringify(serializedSettings(settings), undefined, 2)}\n`
	await filesystem.mkdir(dirname(path), { mode: 0o700, recursive: true })
	if (expectedRevision !== undefined) {
		const current = await filesystem.readFile(path, 'utf8')
		if (revision(current) !== expectedRevision) throw new Error('Configuration changed on disk; reload before saving')
	}
	const temporaryPath = `${path}.${randomBytes(8).toString('hex')}.tmp`
	const handle = await filesystem.open(temporaryPath, 'wx', 0o600)
	try {
		await handle.writeFile(contents, { encoding: 'utf8' })
		await handle.sync()
		await handle.close()
		await filesystem.rename(temporaryPath, path)
		const directoryHandle = await filesystem.open(dirname(path), 'r')
		try {
			await directoryHandle.sync()
		} finally {
			await directoryHandle.close()
		}
	} catch (error) {
		await handle.close().catch(() => undefined)
		await filesystem.rm(temporaryPath, { force: true })
		throw error
	}
	return revision(contents)
}

function chainSpecificPath(path: string, network: NetworkName) {
	const extension = extname(path)
	const stem = (extension === '' ? path : path.slice(0, -extension.length)).replace(/\.(?:mainnet|sepolia)$/, '')
	return `${stem}.${network}${extension}`
}

export function settingsProfilePath(path: string, network: NetworkName) {
	return `${path}.${network}.profile`
}

type SettingsProfileCandidate = { expectedNetwork: NetworkName; settings: OperatorSettings }

async function loadSettingsProfile(path: string, network: NetworkName) {
	return await loadSettings(settingsProfilePath(path, network))
		.then(value => value.settings)
		.catch(error => {
			if (error instanceof Error && error.message.startsWith('Missing liquidator configuration')) return undefined
			throw error
		})
}

async function assertSettingsProfileCandidates(path: string, candidates: readonly SettingsProfileCandidate[]) {
	const reservedPaths = await Promise.all([path, settingsProfilePath(path, 'mainnet'), settingsProfilePath(path, 'sepolia')].map(persistentPathIdentity))
	const candidatePaths: { candidate: SettingsProfileCandidate; statePath: Awaited<ReturnType<typeof persistentPathIdentity>> }[] = []
	for (const candidate of candidates) {
		if (candidate.settings.network.name !== candidate.expectedNetwork) throw new Error(`The ${candidate.expectedNetwork} profile contains ${candidate.settings.network.name} settings`)
		const statePath = await persistentPathIdentity(candidate.settings.runtime.stateFile)
		if (reservedPaths.some(reservedPath => persistentPathIdentitiesMatch(reservedPath, statePath))) throw new Error('The durable recovery state path must not reuse the active configuration or chain profile files')
		candidatePaths.push({ candidate, statePath })
	}
	for (let index = 0; index < candidatePaths.length; index += 1) {
		const current = candidatePaths[index]
		if (current === undefined) continue
		for (const target of candidatePaths.slice(index + 1)) {
			if (target.candidate.expectedNetwork !== current.candidate.expectedNetwork && persistentPathIdentitiesMatch(current.statePath, target.statePath)) throw new Error('Mainnet and Sepolia profiles must use distinct durable recovery state paths')
		}
	}
}

function assertCompatibleProfileProcessMode(current: OperatorSettings, target: OperatorSettings) {
	if (current.runtime.once !== target.runtime.once || current.runtime.ui !== target.runtime.ui || current.runtime.uiHost !== target.runtime.uiHost || current.runtime.uiPort !== target.runtime.uiPort) {
		throw new Error('Chain profiles must use the same once mode and dashboard binding to switch in place')
	}
}

export async function assertSettingsProfileIsolation(path: string, active: OperatorSettings) {
	const mainnet = await loadSettingsProfile(path, 'mainnet')
	const sepolia = await loadSettingsProfile(path, 'sepolia')
	const candidates: SettingsProfileCandidate[] = [{ expectedNetwork: active.network.name, settings: active }]
	if (mainnet !== undefined) candidates.push({ expectedNetwork: 'mainnet', settings: mainnet })
	if (sepolia !== undefined) candidates.push({ expectedNetwork: 'sepolia', settings: sepolia })
	await assertSettingsProfileCandidates(path, candidates)
}

export async function switchSettingsNetworkProfile(path: string, network: NetworkName, examplePath: string, preflight?: (target: OperatorSettings) => Promise<void>) {
	const current = await loadSettings(path)
	const mainnet = await loadSettingsProfile(path, 'mainnet')
	const sepolia = await loadSettingsProfile(path, 'sepolia')
	const storedCandidates: SettingsProfileCandidate[] = [{ expectedNetwork: current.settings.network.name, settings: current.settings }]
	if (mainnet !== undefined) storedCandidates.push({ expectedNetwork: 'mainnet', settings: mainnet })
	if (sepolia !== undefined) storedCandidates.push({ expectedNetwork: 'sepolia', settings: sepolia })
	await assertSettingsProfileCandidates(path, storedCandidates)
	if (current.settings.network.name === network) return current
	let target = network === 'mainnet' ? mainnet : sepolia
	if (target === undefined) {
		const template = parseSettings(JSON.parse(await readFile(examplePath, 'utf8')))
		const chainId = network === 'mainnet' ? 1 : 11_155_111
		target = {
			...template,
			centralizedMarkets: { ...template.centralizedMarkets, assetChainId: chainId },
			network: { chainId, explorerUrl: network === 'mainnet' ? 'https://etherscan.io' : 'https://sepolia.etherscan.io', name: network },
			networkConfigured: false,
			paused: true,
			privateKey: undefined,
			runtime: {
				...template.runtime,
				execute: false,
				once: false,
				stateFile: chainSpecificPath(current.settings.runtime.stateFile, network),
				ui: current.settings.runtime.ui,
				uiHost: current.settings.runtime.uiHost,
				uiPort: current.settings.runtime.uiPort,
			},
		}
	}
	target = { ...target, paused: true }
	await assertSettingsProfileCandidates(path, [
		{ expectedNetwork: current.settings.network.name, settings: current.settings },
		{ expectedNetwork: network, settings: target },
	])
	assertCompatibleProfileProcessMode(current.settings, target)
	await preflight?.(target)
	await saveSettings(settingsProfilePath(path, current.settings.network.name), { ...current.settings, paused: true })
	await saveSettings(settingsProfilePath(path, network), target)
	const savedRevision = await saveSettings(path, target, current.revision)
	return { path, revision: savedRevision, settings: target }
}

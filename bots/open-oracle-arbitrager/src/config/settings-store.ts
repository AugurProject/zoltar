import { validateDeploymentSettings, type DeploymentSettings, type StoredDeploymentSettings } from '#config/deployment-settings'
import { networkDeployment } from '#config/network'
import type { RiskLimits } from '#core/safety-controls'
import { executorDeploymentIntentPath } from '#execution/executor-deployment-store'
import { validateSubmissionSettings, type SubmissionSettings } from '#execution/transaction-submission'
import { type NetworkName } from '@zoltar/bot-shared/monitoring/connectivity'
import { parseQuorumConnectivitySettings, unconfiguredQuorumConnectivity, type QuorumConnectivitySettings } from '@zoltar/bot-shared/monitoring/quorum-connectivity'
import { decimalWeth, parseDecimalWeth, strategySettings, type MutableStrategy, type StrategySettings } from '#state/operator-state'
import { updateStrategyFromRequest } from '#state/strategy-request'
import { parseSettlementSettings, settlementJournalPath, settlementSettings, type MutableSettlement, type SettlementSettings } from '#state/settlement-store'
import { configurationRevisionConflict, contentRevision, parseJsonDocument, readOwnerFileIfPresent, writeRevisionedFile, type RevisionedFileFilesystem } from '@zoltar/bot-shared/config/durable-file'
import { assertProfileCandidates, chainSpecificPath, networkProfilePath, storedNetworkProfileCandidates, switchNetworkProfile, type ProfileCandidate } from '@zoltar/bot-shared/config/profiles'
import { PRESERVE_PRIVATE_KEY, signerCandidate } from '@zoltar/bot-shared/config/signer'
import { getAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { integer as validateInteger, record } from '@zoltar/bot-shared/infrastructure/json-validation'
import { parseCentralizedMarketSettings, serializeCentralizedMarketSettings, type CentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { configuredQuorumRpcUrlMinimum } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { parseApprovedUniverses } from '@zoltar/bot-shared/monitoring/universe-policy'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

type RuntimeSettings = {
	execute: boolean
	historyFile: string
	logLookbackBlocks: bigint
	maxHedgeSlippageBps: bigint
	once: boolean
	/** The main loop interval between scans. */
	pollMilliseconds: number
	positionFile: string
	priceHistoryFile: string
	riskLimits: RiskLimits
	ui: boolean
	uiHost: '0.0.0.0' | '127.0.0.1'
	uiPort: number
}

export type PersistedOperatorSettings = {
	approvedUniverses: readonly bigint[]
	centralizedMarkets: CentralizedMarketSettings
	connectivity: QuorumConnectivitySettings
	deployment: DeploymentSettings
	network: NetworkName
	networkConfigured: boolean
	paused: boolean
	privateKey: Hex | undefined
	runtime: RuntimeSettings
	settlement: MutableSettlement
	strategy: MutableStrategy
	submission: SubmissionSettings
	tokenAddresses: readonly Address[]
}

function defaultCentralizedMarkets(assetAddress: `0x${string}`, assetChainId: number) {
	return {
		assetAddress,
		assetChainId,
		assetSymbol: 'REP',
		depthBps: 500,
		maximumDexDeviationBps: 1_000,
		maximumObservationAgeMilliseconds: 30_000,
		maximumVenueDispersionBps: 500,
		minimumAskDepthEth: '0',
		minimumBidDepthEth: '0',
		minimumSourceCount: 1,
		orderBookLimit: 20,
		requestTimeoutMilliseconds: 5_000,
		requiredForExecution: false,
		sources: [],
	}
}

/** The runtime fields the dashboard may change while the operator runs; the rest of `runtime` is fixed for the process. */
export type RuntimeLimits = Pick<RuntimeSettings, 'logLookbackBlocks' | 'maxHedgeSlippageBps' | 'pollMilliseconds' | 'riskLimits'>

export type StoredRuntimeLimits = {
	logLookbackBlocks: number
	maxHedgeSlippageBps: number
	pollMilliseconds: number
	riskLimits: {
		lifecycleGasReserveWeth: string
		maxConcurrentPositions: number
		maxDailyGasSpendWeth: string
		maxPositionNotionalWeth: string
		maxTotalLockedWeth: string
	}
}

type StoredRuntimeSettings = Omit<RuntimeSettings, keyof RuntimeLimits> & StoredRuntimeLimits

export type StoredCentralizedMarketSettings = Omit<ReturnType<typeof serializeCentralizedMarketSettings>, 'assetAddress' | 'assetChainId'>

export type StoredOperatorSettings = {
	approvedUniverses: readonly string[]
	centralizedMarkets: StoredCentralizedMarketSettings
	connectivity?: QuorumConnectivitySettings | undefined
	deployment: StoredDeploymentSettings
	network?: NetworkName | undefined
	networkConfigured?: boolean | undefined
	paused: boolean
	privateKey?: Hex | typeof PRESERVE_PRIVATE_KEY | undefined
	runtime: StoredRuntimeSettings
	settlement: SettlementSettings
	strategy: StrategySettings
	submission: SubmissionSettings
	tokenAddresses: readonly Address[]
	version: typeof SETTINGS_VERSION
}

/**
 * Version 5 stores the RPC agreement requirement and quorum readers under `connectivity`, the main loop interval as
 * `runtime.pollMilliseconds`, the log window as the number `runtime.logLookbackBlocks`, and basis points as numbers.
 */
const SETTINGS_VERSION = 5

function requiredRecord(value: unknown, name = 'Operator configuration') {
	return record(value, name, `${name} must be a JSON object`)
}

function validatedKeys(record: Record<string, unknown>) {
	const allowed = new Set(['approvedUniverses', 'centralizedMarkets', 'connectivity', 'deployment', 'network', 'networkConfigured', 'paused', 'privateKey', 'runtime', 'settlement', 'strategy', 'submission', 'tokenAddresses', 'version'])
	for (const key of Object.keys(record)) {
		if (!allowed.has(key)) throw new Error(`Unknown operator configuration field: ${key}`)
	}
	for (const key of ['deployment', 'paused', 'runtime', 'strategy', 'submission', 'tokenAddresses', 'version']) {
		if (!(key in record)) throw new Error(`Operator configuration is missing ${key}`)
	}
}

function integer(value: unknown, name: string, minimum: number, maximum: number) {
	return validateInteger(value, name, minimum, maximum, `${name} must be an integer from ${minimum.toString()} to ${maximum.toString()}`)
}

function weth(value: unknown, name: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`${name} must be a nonnegative decimal WETH string with at most 18 decimal places`)
	return parseDecimalWeth(value)
}

function filePath(value: unknown, name: string) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${name} must be a non-empty path`)
	return value
}

/**
 * Every file the runtime writes durable records to: the three configured journals plus the settlement journal, which is
 * derived from the position file and must be isolated like the others so no configured path can alias it.
 */
export function durableJournalPaths(runtime: Pick<RuntimeSettings, 'historyFile' | 'positionFile' | 'priceHistoryFile'>) {
	return [runtime.historyFile, runtime.positionFile, runtime.priceHistoryFile, settlementJournalPath(runtime.positionFile)]
}

const durableJournalPathsMustBeDistinct = 'Runtime historyFile, positionFile, priceHistoryFile, and the derived settlement journal must use distinct paths'

const RUNTIME_LIMIT_KEYS = ['logLookbackBlocks', 'maxHedgeSlippageBps', 'pollMilliseconds', 'riskLimits']

/** Parses the runtime fields the dashboard's risk form edits; `runtime` must carry them and may carry nothing else. */
function parseRuntimeLimits(runtime: Record<string, unknown>): RuntimeLimits {
	if (RUNTIME_LIMIT_KEYS.some(key => !(key in runtime))) throw new Error('Runtime limits require logLookbackBlocks, maxHedgeSlippageBps, pollMilliseconds, and riskLimits')
	const risk = requiredRecord(runtime['riskLimits'], 'Runtime risk limits')
	const riskKeys = ['lifecycleGasReserveWeth', 'maxConcurrentPositions', 'maxDailyGasSpendWeth', 'maxPositionNotionalWeth', 'maxTotalLockedWeth']
	if (Object.keys(risk).some(key => !riskKeys.includes(key)) || riskKeys.some(key => !(key in risk))) throw new Error('Runtime risk limits require exactly the supported risk fields')
	const maxPositionNotionalAttoWeth = weth(risk['maxPositionNotionalWeth'], 'Runtime maxPositionNotionalWeth')
	const maxTotalLockedAttoWeth = weth(risk['maxTotalLockedWeth'], 'Runtime maxTotalLockedWeth')
	if (maxPositionNotionalAttoWeth > maxTotalLockedAttoWeth) throw new Error('Runtime maxPositionNotionalAttoWeth cannot exceed maxTotalLockedAttoWeth')
	return {
		logLookbackBlocks: BigInt(integer(runtime['logLookbackBlocks'], 'Runtime logLookbackBlocks', 0, 256)),
		maxHedgeSlippageBps: BigInt(integer(runtime['maxHedgeSlippageBps'], 'Runtime maxHedgeSlippageBps', 0, 1_000)),
		pollMilliseconds: integer(runtime['pollMilliseconds'], 'Runtime pollMilliseconds', 1_000, 3_600_000),
		riskLimits: {
			lifecycleGasReserveAttoWeth: weth(risk['lifecycleGasReserveWeth'], 'Runtime lifecycleGasReserveWeth'),
			maxConcurrentPositions: integer(risk['maxConcurrentPositions'], 'Runtime maxConcurrentPositions', 1, 1_000),
			maxDailyGasSpendAttoWeth: weth(risk['maxDailyGasSpendWeth'], 'Runtime maxDailyGasSpendWeth'),
			maxPositionNotionalAttoWeth,
			maxTotalLockedAttoWeth,
		},
	}
}

export function parseRuntimeLimitsRequest(value: unknown): RuntimeLimits {
	const runtime = requiredRecord(value, 'Runtime limits')
	for (const key of Object.keys(runtime)) {
		if (!RUNTIME_LIMIT_KEYS.includes(key)) throw new Error(`Unknown runtime limit field: ${key}`)
	}
	return parseRuntimeLimits(runtime)
}

export function serializeRuntimeLimits(limits: RuntimeLimits): StoredRuntimeLimits {
	return {
		logLookbackBlocks: Number(limits.logLookbackBlocks),
		maxHedgeSlippageBps: Number(limits.maxHedgeSlippageBps),
		pollMilliseconds: limits.pollMilliseconds,
		riskLimits: {
			lifecycleGasReserveWeth: decimalWeth(limits.riskLimits.lifecycleGasReserveAttoWeth),
			maxConcurrentPositions: limits.riskLimits.maxConcurrentPositions,
			maxDailyGasSpendWeth: decimalWeth(limits.riskLimits.maxDailyGasSpendAttoWeth),
			maxPositionNotionalWeth: decimalWeth(limits.riskLimits.maxPositionNotionalAttoWeth),
			maxTotalLockedWeth: decimalWeth(limits.riskLimits.maxTotalLockedAttoWeth),
		},
	}
}

/** The stored form of the market policy: the asset identity comes from the selected network, never from the file. */
export function serializeStoredCentralizedMarkets(settings: CentralizedMarketSettings): StoredCentralizedMarketSettings {
	const { assetAddress: _assetAddress, assetChainId: _assetChainId, ...centralizedMarkets } = serializeCentralizedMarketSettings(settings)
	return centralizedMarkets
}

/** Binds a market policy document to the selected network's REP identity, ignoring any asset identity in the document. */
export function parseStoredCentralizedMarkets(value: unknown, rep: Address, network: NetworkName): CentralizedMarketSettings {
	const marketSettings = requiredRecord(value, 'Centralized market settings')
	return parseCentralizedMarketSettings({ ...marketSettings, assetAddress: rep, assetChainId: networkDeployment(network).chainId })
}

function validateRuntimeSettings(value: unknown): RuntimeSettings {
	const runtime = requiredRecord(value, 'Runtime settings')
	const keys = ['execute', 'historyFile', 'once', 'positionFile', 'priceHistoryFile', 'ui', 'uiHost', 'uiPort', ...RUNTIME_LIMIT_KEYS]
	if (Object.keys(runtime).some(key => !keys.includes(key)) || keys.some(key => !(key in runtime))) throw new Error('Runtime settings require exactly the supported runtime fields')
	if (typeof runtime['execute'] !== 'boolean' || typeof runtime['once'] !== 'boolean' || typeof runtime['ui'] !== 'boolean') throw new Error('Runtime execute, once, and ui settings must be booleans')
	if (runtime['uiHost'] !== '127.0.0.1' && runtime['uiHost'] !== '0.0.0.0') throw new Error('Runtime uiHost must be 127.0.0.1 or 0.0.0.0')
	const limits = parseRuntimeLimits(runtime)
	if (runtime['once'] && runtime['ui']) throw new Error('Runtime once and ui cannot both be enabled')
	const historyFile = filePath(runtime['historyFile'], 'Runtime historyFile')
	const positionFile = filePath(runtime['positionFile'], 'Runtime positionFile')
	const priceHistoryFile = filePath(runtime['priceHistoryFile'], 'Runtime priceHistoryFile')
	const persistentPaths = durableJournalPaths({ historyFile, positionFile, priceHistoryFile }).map(path => resolve(path))
	if (new Set(persistentPaths).size !== persistentPaths.length) throw new Error(durableJournalPathsMustBeDistinct)
	return {
		...limits,
		execute: runtime['execute'],
		historyFile,
		once: runtime['once'],
		positionFile,
		priceHistoryFile,
		ui: runtime['ui'],
		uiHost: runtime['uiHost'],
		uiPort: integer(runtime['uiPort'], 'Runtime uiPort', 1, 65_535),
	}
}

/** Converts a canonical decimal integer string from an older file to a JSON number; anything else is left for validation to reject. */
function migratedInteger(value: unknown) {
	return typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value) ? Number(value) : value
}

function migratedRecord(value: unknown) {
	return typeof value === 'object' && value !== null && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : undefined
}

/**
 * Upgrades a version 4 document to version 5, so files and dashboard-saved settings written by earlier releases keep
 * loading. Version 4 stored `rpcQuorum` at the top level, quorum readers in `deployment.quorumRpcUrls`, the main loop
 * interval in `strategy.pollMilliseconds`, and `runtime.lookbackBlocks`, `runtime.maxHedgeSlippageBps`, and
 * `strategy.minimumProfitBps` as strings. An unconfigured profile cannot retain RPC connectivity, so its quorum readers
 * and policy are dropped. A shape the conversion does not recognize is passed through for validation to reject.
 */
function migrateVersion4(document: Record<string, unknown>): Record<string, unknown> {
	const { rpcQuorum, ...root } = document
	const deployment = migratedRecord(root['deployment'])
	const runtime = migratedRecord(root['runtime'])
	const strategy = migratedRecord(root['strategy'])
	const connectivity = migratedRecord(root['connectivity'])
	const migrated: Record<string, unknown> = { ...root, version: SETTINGS_VERSION }
	const quorumRpcUrls = deployment?.['quorumRpcUrls']
	if (deployment !== undefined) {
		const { quorumRpcUrls: _quorumRpcUrls, ...venues } = deployment
		migrated['deployment'] = venues
	}
	if (connectivity !== undefined) migrated['connectivity'] = { ...connectivity, quorumRpcUrls: quorumRpcUrls ?? [], ...(rpcQuorum === undefined ? {} : { rpcQuorum }) }
	if (runtime !== undefined) {
		const { lookbackBlocks, ...rest } = runtime
		// Version 4 previously shipped 50000 as the Docker default; migrate only that known value so existing named volumes
		// start under the bounded scanner.
		migrated['runtime'] = {
			...rest,
			logLookbackBlocks: lookbackBlocks === '50000' ? 256 : migratedInteger(lookbackBlocks),
			maxHedgeSlippageBps: migratedInteger(rest['maxHedgeSlippageBps']),
			...(strategy !== undefined && 'pollMilliseconds' in strategy ? { pollMilliseconds: strategy['pollMilliseconds'] } : {}),
		}
	}
	if (strategy !== undefined) {
		const { pollMilliseconds: _pollMilliseconds, ...rest } = strategy
		migrated['strategy'] = { ...rest, minimumProfitBps: migratedInteger(rest['minimumProfitBps']) }
	}
	return migrated
}

export function parseOperatorSettings(value: unknown, preservedPrivateKey?: Hex): PersistedOperatorSettings {
	const document = requiredRecord(value)
	const record = document['version'] === 4 ? migrateVersion4(document) : document
	validatedKeys(record)
	if (record['version'] !== SETTINGS_VERSION) throw new Error('Operator configuration uses an unsupported version; expected version 5, or version 4 to migrate')
	const networkConfigured = record['networkConfigured'] === undefined ? record['connectivity'] !== undefined : record['networkConfigured'] === true
	if (record['networkConfigured'] !== undefined && typeof record['networkConfigured'] !== 'boolean') throw new Error('Operator configuration networkConfigured must be a boolean')
	if (record['network'] !== undefined && record['network'] !== 'mainnet' && record['network'] !== 'sepolia') throw new Error('Operator configuration network must be mainnet or sepolia')
	if (networkConfigured && (record['network'] === undefined || record['connectivity'] === undefined)) throw new Error('A configured operator requires network and connectivity')
	if (!networkConfigured && record['connectivity'] !== undefined) throw new Error('An unconfigured operator cannot retain RPC connectivity')
	if (typeof record['paused'] !== 'boolean') throw new Error('Operator pause setting must be a boolean')
	const strategy: MutableStrategy = {
		maxSpotTwapTicks: 0n,
		minimumProfitBps: 0n,
		minimumProfitAttoWeth: 0n,
		minimumRemainingBlocks: 1n,
		minimumRemainingSeconds: 1n,
		twapSeconds: 60,
	}
	updateStrategyFromRequest(strategy, record['strategy'])
	const privateKeyValue = record['privateKey'] === PRESERVE_PRIVATE_KEY ? preservedPrivateKey : record['privateKey']
	const candidate = signerCandidate(privateKeyValue ?? null)
	if (!Array.isArray(record['tokenAddresses']) || record['tokenAddresses'].some(address => typeof address !== 'string')) throw new Error('Operator tokenAddresses must be an array of addresses')
	const network = record['network'] === 'sepolia' ? 'sepolia' : 'mainnet'
	const deployment = validateDeploymentSettings(record['deployment'], network)
	const connectivity = networkConfigured ? parseQuorumConnectivitySettings(record['connectivity']) : unconfiguredQuorumConnectivity()
	const centralizedMarkets = parseStoredCentralizedMarkets(record['centralizedMarkets'] ?? defaultCentralizedMarkets(deployment.rep, networkDeployment(network).chainId), deployment.rep, network)
	const submission = validateSubmissionSettings(record['submission'])
	const settlement = parseSettlementSettings(record['settlement'])
	const runtime = validateRuntimeSettings(record['runtime'])
	if (!networkConfigured && (!record['paused'] || runtime.execute)) throw new Error('An unconfigured network requires paused dry-run mode')
	if (runtime.execute && connectivity.quorumRpcUrls.length < configuredQuorumRpcUrlMinimum(connectivity.rpcQuorum)) throw new Error('Live execution requires at least two independent quorum RPCs (three read endpoints total)')
	return {
		centralizedMarkets,
		connectivity,
		deployment,
		network,
		networkConfigured,
		paused: record['paused'],
		privateKey: candidate.privateKey,
		runtime,
		settlement,
		strategy,
		submission,
		approvedUniverses: parseApprovedUniverses(record['approvedUniverses'] ?? []),
		tokenAddresses: record['tokenAddresses'].map(address => getAddress(String(address))),
	}
}

export function serializeOperatorSettings(settings: PersistedOperatorSettings, redactPrivateKey = false): StoredOperatorSettings {
	const { uniswapV2Enabled, uniswapV3Enabled, uniswapV4Enabled } = settings.deployment
	const deployment = { uniswapV2Enabled, uniswapV3Enabled, uniswapV4Enabled }
	return {
		centralizedMarkets: serializeStoredCentralizedMarkets(settings.centralizedMarkets),
		connectivity: settings.networkConfigured ? settings.connectivity : undefined,
		deployment,
		network: settings.network,
		networkConfigured: settings.networkConfigured,
		paused: settings.paused,
		privateKey: redactPrivateKey && settings.privateKey !== undefined ? PRESERVE_PRIVATE_KEY : settings.privateKey,
		runtime: {
			...serializeRuntimeLimits(settings.runtime),
			execute: settings.runtime.execute,
			historyFile: settings.runtime.historyFile,
			once: settings.runtime.once,
			positionFile: settings.runtime.positionFile,
			priceHistoryFile: settings.runtime.priceHistoryFile,
			ui: settings.runtime.ui,
			uiHost: settings.runtime.uiHost,
			uiPort: settings.runtime.uiPort,
		},
		settlement: settlementSettings(settings.settlement),
		strategy: strategySettings(settings.strategy),
		submission: settings.submission,
		approvedUniverses: settings.approvedUniverses.map(id => id.toString()),
		tokenAddresses: settings.tokenAddresses,
		version: SETTINGS_VERSION,
	}
}

const operatorNetwork = (settings: PersistedOperatorSettings) => settings.network

async function assertOperatorProfileCandidates(path: string, candidates: readonly ProfileCandidate<PersistedOperatorSettings>[]) {
	await assertProfileCandidates({
		assertIdentity: candidate => {
			if (candidate.settings.network !== candidate.expected) throw new Error(`The ${candidate.expected} profile contains ${candidate.settings.network} settings`)
		},
		candidates,
		durablePaths: candidate => durableJournalPaths(candidate.settings.runtime),
		errors: {
			crossChainPathReuse: 'Mainnet and Sepolia profiles must use distinct durable journal paths',
			duplicatePathsWithinProfile: candidate => `The ${candidate.expected} profile must use distinct durable journal paths`,
			reservedPathReuse: 'Durable journal paths must not reuse configuration, profile, or executor deployment intent files',
		},
		reservedPaths: [path, networkProfilePath(path, 'mainnet'), networkProfilePath(path, 'sepolia'), executorDeploymentIntentPath(path, 'mainnet'), executorDeploymentIntentPath(path, 'sepolia')],
	})
}

export async function assertOperatorProfileIsolation(path: string, active: PersistedOperatorSettings) {
	const { candidates } = await storedNetworkProfileCandidates(active, operatorNetwork, network => loadOperatorSettings(networkProfilePath(path, network)))
	await assertOperatorProfileCandidates(path, candidates)
}

export async function switchOperatorNetworkProfile(path: string, network: NetworkName, examplePath: string, preflight?: (target: PersistedOperatorSettings) => Promise<void>) {
	const current = await loadOperatorSettingsWithRevision(path)
	if (current === undefined) throw new Error('Operator configuration file is missing')
	return await switchNetworkProfile({
		assertCandidates: candidates => assertOperatorProfileCandidates(path, candidates),
		createProfile: async network => {
			const template = parseOperatorSettings(JSON.parse(await readFile(examplePath, 'utf8')))
			const { chainId } = networkDeployment(network)
			return {
				...template,
				deployment: validateDeploymentSettings(template.deployment, network),
				centralizedMarkets: { ...template.centralizedMarkets, assetAddress: networkDeployment(network).rep, assetChainId: chainId },
				network,
				networkConfigured: false,
				paused: true,
				privateKey: undefined,
				runtime: {
					...template.runtime,
					execute: false,
					historyFile: chainSpecificPath(current.settings.runtime.historyFile, network),
					once: false,
					positionFile: chainSpecificPath(current.settings.runtime.positionFile, network),
					priceHistoryFile: chainSpecificPath(current.settings.runtime.priceHistoryFile, network),
					ui: current.settings.runtime.ui,
					uiHost: current.settings.runtime.uiHost,
					uiPort: current.settings.runtime.uiPort,
				},
			}
		},
		current,
		loadProfile: network => loadOperatorSettings(networkProfilePath(path, network)),
		network,
		networkOf: operatorNetwork,
		preflight,
		saveActive: (settings, expectedRevision) => saveOperatorSettings(path, settings, undefined, expectedRevision),
		saveProfile: (network, settings) => saveOperatorSettings(networkProfilePath(path, network), settings),
	})
}

export async function loadOperatorSettingsWithRevision(path: string): Promise<{ revision: string; settings: PersistedOperatorSettings } | undefined> {
	const contents = await readOwnerFileIfPresent(path, 'Operator configuration')
	if (contents === undefined) return undefined
	return { revision: contentRevision(contents), settings: parseOperatorSettings(parseJsonDocument(contents, 'Operator configuration')) }
}

export async function loadOperatorSettings(path: string): Promise<PersistedOperatorSettings | undefined> {
	return (await loadOperatorSettingsWithRevision(path))?.settings
}

export function operatorConfigurationRevisionConflict() {
	return configurationRevisionConflict('operator configuration')
}

export async function saveOperatorSettings(path: string, settings: PersistedOperatorSettings, filesystem?: RevisionedFileFilesystem, expectedRevision?: string) {
	const contents = `${JSON.stringify(serializeOperatorSettings(settings), undefined, 2)}\n`
	return await writeRevisionedFile(path, contents, { conflict: operatorConfigurationRevisionConflict, expectedRevision, filesystem })
}

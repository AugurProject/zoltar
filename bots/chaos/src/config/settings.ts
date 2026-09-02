import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, extname, resolve } from 'node:path'
import { persistentPathIdentitiesMatch, persistentPathIdentity } from '@zoltar/bot-shared/config/persistent-path'
import { signerCandidate } from '@zoltar/bot-shared/config/signer'
import { getAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { validateSubmissionSettings, type SubmissionSettings } from '@zoltar/bot-shared/execution/transaction-submission'
import { validateConnectivitySettings, validateIndependentReadRpcUrls, type ConnectivitySettings, type NetworkName } from '@zoltar/bot-shared/monitoring/connectivity'
import { configuredQuorumRpcUrlMinimum, rpcQuorumRequirement, type RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { CHAOS_OPERATION_CATALOG } from '../operations/catalog.ts'
import { MINIMUM_WORKFLOW_VALIDITY_BLOCKS } from '../operations/timing.ts'

export const PRESERVE_PRIVATE_KEY = '__PRESERVE_SAVED_PRIVATE_KEY__'
export const CONFIGURATION_REVISION_CONFLICT = 'ConfigurationRevisionConflict'
export { MINIMUM_WORKFLOW_VALIDITY_BLOCKS }
export const PRESET_MAXIMUM_BLOCK_INTERVAL_SECONDS = 60
export const MAXIMUM_BLOCK_INTERVAL_SECONDS = 86_400

export const CHAOS_ECOSYSTEMS = ['zoltar', 'statoblast', 'open-oracle', 'trading'] as const
export type ChaosEcosystem = (typeof CHAOS_ECOSYSTEMS)[number]

export type DeploymentSettings = {
	openOracle: Address
	questionData: Address
	securityPoolFactory: Address
	securityPoolForker: Address
	tradingFactory: Address
	tradingRouter: Address
	weth: Address
	zoltar: Address
}

export type DiscoverySettings = {
	maxPools: number
	maxQuestions: number
	maxStagedOperationsPerPool: number
	maxUniverses: number
	maxVaultsPerPool: number
}

export const MAXIMUM_DISCOVERY_AGGREGATE_ITEMS = 10_000

export type SchedulerSettings = {
	maximumDelaySeconds: number
	minimumDelaySeconds: number
}

export type StrategySettings = {
	allowHighRiskOperations: boolean
	allowIrreversibleOperations: boolean
	initializeGenesisUniverse: boolean
	enabledEcosystems: readonly ChaosEcosystem[]
	maximumEthPerOperationAttoEth: bigint
	maximumGasCostAttoEth: bigint
	maximumRepPerOperationAttoRep: bigint
	minimumEthReserveAttoEth: bigint
	minimumRepReserveAttoRep: bigint
	/** Undefined permits every selectable definition. An explicit array permits only those definition IDs. */
	selectableOperationAllowlist?: readonly string[] | undefined
	workflowValidForBlocks: bigint
}

export type RuntimeSettings = {
	execute: boolean
	lifecyclePollMilliseconds: number
	once: boolean
	protocolLogBlockSpan: number
	protocolStartBlock: bigint
	stateFile: string
	ui: boolean
	uiHost: '0.0.0.0' | '127.0.0.1'
	uiPort: number
}

export type PresetNetworkSettings = {
	chainId: number
	explorerUrl: string
	kind?: undefined
	maximumBlockIntervalSeconds: number
	name: NetworkName
}

export type CustomNetworkSettings = {
	chainId: number
	explorerUrl: string
	kind: 'custom'
	maximumBlockIntervalSeconds: number
	name: string
}

export type OperatorNetworkSettings = PresetNetworkSettings | CustomNetworkSettings

export type OperatorSettings = {
	connectivity: (ConnectivitySettings & { quorumRpcUrls: string[]; rpcQuorum: RpcQuorumRequirement }) | undefined
	deployment: DeploymentSettings
	discovery: DiscoverySettings
	network: OperatorNetworkSettings
	networkConfigured: boolean
	paused: boolean
	privateKey: Hex | undefined
	runtime: RuntimeSettings
	scheduler: SchedulerSettings
	strategy: StrategySettings
	submission: SubmissionSettings
	version: 1
}

type JsonRecord = Record<string, unknown>

type SettingsFileHandle = {
	chmod: (mode: number) => Promise<unknown>
	close: () => Promise<unknown>
	readFile: (options: { encoding: 'utf8' }) => Promise<string>
	stat: () => Promise<{
		isFile: () => boolean
		mode: number
		uid: number
	}>
	sync: () => Promise<unknown>
	writeFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
}

export type SettingsFilesystem = {
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'r' | 'wx' | number, mode?: number) => Promise<SettingsFileHandle>
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

const settingsWriteQueues = new Map<string, Promise<void>>()

const zeroAddress = getAddress('0x0000000000000000000000000000000000000000')
const unit = 10n ** 18n
const defaultSettingsPath = resolve(import.meta.dir, '..', '..', '.state', 'operator.json')

function requiredRecord(value: unknown, label: string): JsonRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${label} must be an object`)
	return value as JsonRecord
}

function assertExactKeys(value: JsonRecord, keys: readonly string[], label: string) {
	const allowed = new Set(keys)
	const unknown = Object.keys(value).filter(key => !allowed.has(key))
	const missing = keys.filter(key => !(key in value))
	if (unknown.length !== 0) throw new Error(`${label} contains unsupported field ${unknown[0] ?? 'unknown'}`)
	if (missing.length !== 0) throw new Error(`${label} is missing ${missing[0] ?? 'a required field'}`)
}

function boolean(value: unknown, label: string) {
	if (typeof value !== 'boolean') throw new Error(`${label} must be a boolean`)
	return value
}

function integer(value: unknown, label: string, minimum: number, maximum: number) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
		throw new Error(`${label} must be an integer from ${minimum.toString()} through ${maximum.toString()}`)
	}
	return value
}

function nonemptyString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} must be a non-empty string`)
	return value
}

function customNetworkName(value: unknown) {
	const name = nonemptyString(value, 'network.name')
	if (name !== name.trim()) throw new Error('Custom network.name must not have leading or trailing whitespace')
	if ([...name].length > 64) throw new Error('Custom network.name must contain at most 64 characters')
	if (/[\p{C}\p{Zl}\p{Zp}]/u.test(name)) throw new Error('Custom network.name must not contain control or line-separator characters')
	if (name.toLowerCase() === 'mainnet' || name.toLowerCase() === 'sepolia') throw new Error('Custom network.name must not impersonate the mainnet or sepolia preset')
	return name
}

function customNetworkChainId(value: unknown, label = 'network.chainId') {
	const chainId = integer(value, label, 1, Number.MAX_SAFE_INTEGER)
	if (chainId === 1 || chainId === 11_155_111) throw new Error(`${label} must not reuse the mainnet or sepolia preset chain ID`)
	return chainId
}

function maximumBlockIntervalSeconds(value: unknown, label = 'network.maximumBlockIntervalSeconds') {
	return integer(value, label, 1, MAXIMUM_BLOCK_INTERVAL_SECONDS)
}

function filePath(value: unknown, label: string) {
	return resolve(nonemptyString(value, label))
}

function unsignedIntegerString(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${label} must be a non-negative integer string`)
	const parsed = BigInt(value)
	if (parsed >= 1n << 256n) throw new Error(`${label} must fit in a uint256`)
	return parsed
}

export function parseDecimalAmount(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) {
		throw new Error(`${label} must be a non-negative decimal with at most 18 places`)
	}
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * unit + BigInt(fraction.padEnd(18, '0'))
}

export function formatDecimalAmount(value: bigint) {
	if (value < 0n) throw new Error('Decimal amount cannot be negative')
	const whole = value / unit
	const fraction = (value % unit).toString().padStart(18, '0').replace(/0+$/, '')
	return fraction === '' ? whole.toString() : `${whole.toString()}.${fraction}`
}

function parseNetwork(value: unknown): OperatorSettings['network'] {
	const network = requiredRecord(value, 'network')
	if ('kind' in network) {
		assertExactKeys(network, ['chainId', 'explorerUrl', 'kind', 'maximumBlockIntervalSeconds', 'name'], 'custom network')
		if (network['kind'] !== 'custom') throw new Error('network.kind must be custom when provided')
		const chainId = customNetworkChainId(network['chainId'])
		return {
			chainId,
			explorerUrl: nonemptyString(network['explorerUrl'], 'network.explorerUrl'),
			kind: 'custom',
			maximumBlockIntervalSeconds: maximumBlockIntervalSeconds(network['maximumBlockIntervalSeconds']),
			name: customNetworkName(network['name']),
		}
	}
	const presetKeys = new Set(['chainId', 'explorerUrl', 'maximumBlockIntervalSeconds', 'name'])
	const unsupported = Object.keys(network).find(key => !presetKeys.has(key))
	if (unsupported !== undefined) throw new Error(`network contains unsupported field ${unsupported}`)
	for (const required of ['chainId', 'explorerUrl', 'name'] as const) {
		if (!(required in network)) throw new Error(`network is missing ${required}`)
	}
	const name = network['name']
	if (name !== 'mainnet' && name !== 'sepolia') throw new Error('network.name must be mainnet or sepolia, or network.kind must explicitly be custom')
	const chainId = integer(network['chainId'], 'network.chainId', 1, 2 ** 31 - 1)
	const canonicalChainId = name === 'mainnet' ? 1 : 11_155_111
	if (chainId !== canonicalChainId) throw new Error('network.name and network.chainId must identify the same supported chain')
	return {
		chainId,
		explorerUrl: nonemptyString(network['explorerUrl'], 'network.explorerUrl'),
		maximumBlockIntervalSeconds: network['maximumBlockIntervalSeconds'] === undefined ? PRESET_MAXIMUM_BLOCK_INTERVAL_SECONDS : maximumBlockIntervalSeconds(network['maximumBlockIntervalSeconds']),
		name,
	}
}

function parseConnectivity(value: unknown): NonNullable<OperatorSettings['connectivity']> {
	const connectivity = requiredRecord(value, 'connectivity')
	assertExactKeys(connectivity, ['publicRpcUrls', 'quorumRpcUrls', 'readRpcUrl', 'rpcQuorum'], 'connectivity')
	const parsed = validateConnectivitySettings({
		publicRpcUrls: connectivity['publicRpcUrls'],
		readRpcUrl: connectivity['readRpcUrl'],
	})
	const quorumValues = connectivity['quorumRpcUrls']
	if (!Array.isArray(quorumValues) || quorumValues.some(candidate => typeof candidate !== 'string')) throw new Error('connectivity.quorumRpcUrls must contain only RPC URLs')
	const quorumRpcUrls = validateIndependentReadRpcUrls(
		parsed.readRpcUrl,
		quorumValues.map(value => String(value)),
	)
	const rpcQuorum = connectivity['rpcQuorum'] === undefined ? rpcQuorumRequirement() : integer(connectivity['rpcQuorum'], 'connectivity.rpcQuorum', 1, 2)
	if (rpcQuorum !== 1 && rpcQuorum !== 2) throw new Error('connectivity.rpcQuorum must be 1 or 2')
	return { ...parsed, quorumRpcUrls, rpcQuorum }
}

function parseDeployment(value: unknown): DeploymentSettings {
	const deployment = requiredRecord(value, 'deployment')
	const keys = ['openOracle', 'questionData', 'securityPoolFactory', 'securityPoolForker', 'tradingFactory', 'tradingRouter', 'weth', 'zoltar'] as const
	assertExactKeys(deployment, keys, 'deployment')
	return {
		openOracle: getAddress(nonemptyString(deployment['openOracle'], 'deployment.openOracle')),
		questionData: getAddress(nonemptyString(deployment['questionData'], 'deployment.questionData')),
		securityPoolFactory: getAddress(nonemptyString(deployment['securityPoolFactory'], 'deployment.securityPoolFactory')),
		securityPoolForker: getAddress(nonemptyString(deployment['securityPoolForker'], 'deployment.securityPoolForker')),
		tradingFactory: getAddress(nonemptyString(deployment['tradingFactory'], 'deployment.tradingFactory')),
		tradingRouter: getAddress(nonemptyString(deployment['tradingRouter'], 'deployment.tradingRouter')),
		weth: getAddress(nonemptyString(deployment['weth'], 'deployment.weth')),
		zoltar: getAddress(nonemptyString(deployment['zoltar'], 'deployment.zoltar')),
	}
}

function parseDiscovery(value: unknown): DiscoverySettings {
	const discovery = requiredRecord(value, 'discovery')
	const keys = ['maxPools', 'maxQuestions', 'maxStagedOperationsPerPool', 'maxUniverses', 'maxVaultsPerPool'] as const
	assertExactKeys(discovery, keys, 'discovery')
	const parsed = {
		maxPools: integer(discovery['maxPools'], 'discovery.maxPools', 1, 10_000),
		maxQuestions: integer(discovery['maxQuestions'], 'discovery.maxQuestions', 1, 10_000),
		maxStagedOperationsPerPool: integer(discovery['maxStagedOperationsPerPool'], 'discovery.maxStagedOperationsPerPool', 1, 10_000),
		maxUniverses: integer(discovery['maxUniverses'], 'discovery.maxUniverses', 1, 10_000),
		maxVaultsPerPool: integer(discovery['maxVaultsPerPool'], 'discovery.maxVaultsPerPool', 1, 10_000),
	}
	if (parsed.maxPools * parsed.maxUniverses > MAXIMUM_DISCOVERY_AGGREGATE_ITEMS) throw new Error(`discovery.maxPools × discovery.maxUniverses must not exceed ${MAXIMUM_DISCOVERY_AGGREGATE_ITEMS.toString()} aggregate entries`)
	if (parsed.maxPools * parsed.maxVaultsPerPool > MAXIMUM_DISCOVERY_AGGREGATE_ITEMS) throw new Error(`discovery.maxPools × discovery.maxVaultsPerPool must not exceed ${MAXIMUM_DISCOVERY_AGGREGATE_ITEMS.toString()} aggregate entries`)
	if (parsed.maxPools * parsed.maxStagedOperationsPerPool > MAXIMUM_DISCOVERY_AGGREGATE_ITEMS) throw new Error(`discovery.maxPools × discovery.maxStagedOperationsPerPool must not exceed ${MAXIMUM_DISCOVERY_AGGREGATE_ITEMS.toString()} aggregate entries`)
	return parsed
}

function parseRuntime(value: unknown): RuntimeSettings {
	const runtime = requiredRecord(value, 'runtime')
	assertExactKeys(runtime, ['execute', 'lifecyclePollMilliseconds', 'once', 'protocolLogBlockSpan', 'protocolStartBlock', 'stateFile', 'ui', 'uiHost', 'uiPort'], 'runtime')
	if (runtime['uiHost'] !== '127.0.0.1' && runtime['uiHost'] !== '0.0.0.0') throw new Error('runtime.uiHost must be 127.0.0.1 or 0.0.0.0')
	const once = boolean(runtime['once'], 'runtime.once')
	const ui = boolean(runtime['ui'], 'runtime.ui')
	if (once && ui) throw new Error('runtime.once and runtime.ui cannot both be enabled')
	return {
		execute: boolean(runtime['execute'], 'runtime.execute'),
		lifecyclePollMilliseconds: integer(runtime['lifecyclePollMilliseconds'], 'runtime.lifecyclePollMilliseconds', 1_000, 60_000),
		once,
		protocolLogBlockSpan: integer(runtime['protocolLogBlockSpan'], 'runtime.protocolLogBlockSpan', 1, 50_000),
		protocolStartBlock: unsignedIntegerString(runtime['protocolStartBlock'], 'runtime.protocolStartBlock'),
		stateFile: filePath(runtime['stateFile'], 'runtime.stateFile'),
		ui,
		uiHost: runtime['uiHost'],
		uiPort: integer(runtime['uiPort'], 'runtime.uiPort', 1, 65_535),
	}
}

function parseScheduler(value: unknown): SchedulerSettings {
	const scheduler = requiredRecord(value, 'scheduler')
	assertExactKeys(scheduler, ['maximumDelaySeconds', 'minimumDelaySeconds'], 'scheduler')
	const minimumDelaySeconds = integer(scheduler['minimumDelaySeconds'], 'scheduler.minimumDelaySeconds', 60, 3_599)
	const maximumDelaySeconds = integer(scheduler['maximumDelaySeconds'], 'scheduler.maximumDelaySeconds', minimumDelaySeconds + 1, 3_600)
	return { maximumDelaySeconds, minimumDelaySeconds }
}

function parseEcosystems(value: unknown) {
	if (!Array.isArray(value) || value.length === 0) throw new Error('strategy.enabledEcosystems must be a non-empty array')
	const ecosystems = value.map(candidate => {
		if (candidate !== 'zoltar' && candidate !== 'statoblast' && candidate !== 'open-oracle' && candidate !== 'trading') throw new Error(`Unsupported ecosystem ${String(candidate)}`)
		return candidate
	})
	if (new Set(ecosystems).size !== ecosystems.length) throw new Error('strategy.enabledEcosystems must not contain duplicates')
	return ecosystems
}

const selectableOperationIds = new Set(CHAOS_OPERATION_CATALOG.filter(definition => definition.classification === 'selectable').map(definition => definition.id))

function parseSelectableOperationAllowlist(value: unknown) {
	if (value === null) return undefined
	if (!Array.isArray(value)) throw new Error('strategy.selectableOperationAllowlist must be null or an array of selectable operation definition IDs')
	const operationIds = value.map((candidate, index) => {
		if (typeof candidate !== 'string' || candidate === '') {
			throw new Error(`strategy.selectableOperationAllowlist[${index.toString()}] must be a selectable operation definition ID`)
		}
		if (!selectableOperationIds.has(candidate)) throw new Error(`strategy.selectableOperationAllowlist contains unknown selectable operation definition ID ${candidate}`)
		return candidate
	})
	if (new Set(operationIds).size !== operationIds.length) throw new Error('strategy.selectableOperationAllowlist must not contain duplicates')
	return operationIds
}

function parseStrategy(value: unknown): StrategySettings {
	const strategy = requiredRecord(value, 'strategy')
	const requiredKeys = ['allowHighRiskOperations', 'allowIrreversibleOperations', 'enabledEcosystems', 'maximumEthPerOperation', 'maximumGasCostEth', 'maximumRepPerOperation', 'minimumEthReserve', 'minimumRepReserve', 'workflowValidForBlocks'] as const
	const optionalKeys = [...('selectableOperationAllowlist' in strategy ? ['selectableOperationAllowlist'] : []), ...('initializeGenesisUniverse' in strategy ? ['initializeGenesisUniverse'] : [])]
	assertExactKeys(strategy, [...requiredKeys, ...optionalKeys], 'strategy')
	const maximumEthPerOperationAttoEth = parseDecimalAmount(strategy['maximumEthPerOperation'], 'strategy.maximumEthPerOperation')
	const maximumGasCostAttoEth = parseDecimalAmount(strategy['maximumGasCostEth'], 'strategy.maximumGasCostEth')
	const maximumRepPerOperationAttoRep = parseDecimalAmount(strategy['maximumRepPerOperation'], 'strategy.maximumRepPerOperation')
	if (maximumEthPerOperationAttoEth === 0n) throw new Error('strategy.maximumEthPerOperation must be greater than zero')
	if (maximumGasCostAttoEth === 0n) throw new Error('strategy.maximumGasCostEth must be greater than zero')
	if (maximumRepPerOperationAttoRep === 0n) throw new Error('strategy.maximumRepPerOperation must be greater than zero')
	return {
		allowHighRiskOperations: boolean(strategy['allowHighRiskOperations'], 'strategy.allowHighRiskOperations'),
		allowIrreversibleOperations: boolean(strategy['allowIrreversibleOperations'], 'strategy.allowIrreversibleOperations'),
		initializeGenesisUniverse: strategy['initializeGenesisUniverse'] === undefined ? false : boolean(strategy['initializeGenesisUniverse'], 'strategy.initializeGenesisUniverse'),
		enabledEcosystems: parseEcosystems(strategy['enabledEcosystems']),
		maximumEthPerOperationAttoEth,
		maximumGasCostAttoEth,
		maximumRepPerOperationAttoRep,
		minimumEthReserveAttoEth: parseDecimalAmount(strategy['minimumEthReserve'], 'strategy.minimumEthReserve'),
		minimumRepReserveAttoRep: parseDecimalAmount(strategy['minimumRepReserve'], 'strategy.minimumRepReserve'),
		// Configurations written before the rollout control existed must not silently
		// opt into every selectable operation. Only an explicit null means "all".
		selectableOperationAllowlist: 'selectableOperationAllowlist' in strategy ? parseSelectableOperationAllowlist(strategy['selectableOperationAllowlist']) : [],
		workflowValidForBlocks: BigInt(integer(strategy['workflowValidForBlocks'], 'strategy.workflowValidForBlocks', MINIMUM_WORKFLOW_VALIDITY_BLOCKS, 1_000_000)),
	}
}

function hasZeroDeploymentAddress(deployment: DeploymentSettings) {
	return Object.values(deployment).some(address => address === zeroAddress)
}

export function parseSettings(value: unknown, preservedPrivateKey?: Hex): OperatorSettings {
	const root = requiredRecord(value, 'operator settings')
	assertExactKeys(root, ['connectivity', 'deployment', 'discovery', 'network', 'networkConfigured', 'paused', 'privateKey', 'runtime', 'scheduler', 'strategy', 'submission', 'version'], 'operator settings')
	if (root['version'] !== 1) throw new Error('operator settings version must be 1')
	const networkConfigured = boolean(root['networkConfigured'], 'networkConfigured')
	const connectivity = root['connectivity'] === null ? undefined : parseConnectivity(root['connectivity'])
	if (networkConfigured !== (connectivity !== undefined)) throw new Error(networkConfigured ? 'A configured network requires connectivity' : 'An unconfigured network cannot retain connectivity')
	if (root['privateKey'] === PRESERVE_PRIVATE_KEY && preservedPrivateKey === undefined) throw new Error('A redacted private key can only preserve an existing saved signer')
	const privateKeyValue = root['privateKey'] === PRESERVE_PRIVATE_KEY ? preservedPrivateKey : root['privateKey']
	const privateKey = signerCandidate(privateKeyValue ?? null).privateKey
	const settings: OperatorSettings = {
		connectivity,
		deployment: parseDeployment(root['deployment']),
		discovery: parseDiscovery(root['discovery']),
		network: parseNetwork(root['network']),
		networkConfigured,
		paused: boolean(root['paused'], 'paused'),
		privateKey,
		runtime: parseRuntime(root['runtime']),
		scheduler: parseScheduler(root['scheduler']),
		strategy: parseStrategy(root['strategy']),
		submission: validateSubmissionSettings(root['submission']),
		version: 1,
	}
	if (!settings.networkConfigured && (!settings.paused || settings.runtime.execute)) throw new Error('An unconfigured network requires paused dry-run mode')
	if (settings.runtime.execute && settings.privateKey === undefined) throw new Error('Live execution requires privateKey')
	if (settings.runtime.execute && settings.strategy.minimumEthReserveAttoEth === 0n) throw new Error('Live execution requires strategy.minimumEthReserve to be greater than zero')
	if (settings.runtime.execute && settings.strategy.minimumRepReserveAttoRep === 0n) throw new Error('Live execution requires strategy.minimumRepReserve to be greater than zero')
	if (settings.runtime.execute && settings.strategy.minimumEthReserveAttoEth < settings.strategy.maximumGasCostAttoEth) {
		throw new Error('Live execution requires strategy.minimumEthReserve to retain at least one strategy.maximumGasCostEth-sized safety floor')
	}
	if (settings.runtime.execute && hasZeroDeploymentAddress(settings.deployment)) throw new Error('Live execution requires every ecosystem deployment address')
	if (settings.runtime.execute && (settings.connectivity === undefined || settings.connectivity.rpcQuorum !== 2 || settings.connectivity.quorumRpcUrls.length < configuredQuorumRpcUrlMinimum(2))) {
		throw new Error('Live execution requires RPC quorum 2 with three independent read origins')
	}
	return settings
}

export function serializedSettings(settings: OperatorSettings, redactPrivateKey = false) {
	return {
		connectivity: settings.connectivity === undefined ? null : { ...settings.connectivity },
		deployment: settings.deployment,
		discovery: settings.discovery,
		network: settings.network,
		networkConfigured: settings.networkConfigured,
		paused: settings.paused,
		privateKey: redactPrivateKey && settings.privateKey !== undefined ? PRESERVE_PRIVATE_KEY : (settings.privateKey ?? null),
		runtime: {
			...settings.runtime,
			protocolStartBlock: settings.runtime.protocolStartBlock.toString(),
		},
		scheduler: settings.scheduler,
		strategy: {
			allowHighRiskOperations: settings.strategy.allowHighRiskOperations,
			allowIrreversibleOperations: settings.strategy.allowIrreversibleOperations,
			initializeGenesisUniverse: settings.strategy.initializeGenesisUniverse,
			enabledEcosystems: settings.strategy.enabledEcosystems,
			maximumEthPerOperation: formatDecimalAmount(settings.strategy.maximumEthPerOperationAttoEth),
			maximumGasCostEth: formatDecimalAmount(settings.strategy.maximumGasCostAttoEth),
			maximumRepPerOperation: formatDecimalAmount(settings.strategy.maximumRepPerOperationAttoRep),
			minimumEthReserve: formatDecimalAmount(settings.strategy.minimumEthReserveAttoEth),
			minimumRepReserve: formatDecimalAmount(settings.strategy.minimumRepReserveAttoRep),
			selectableOperationAllowlist: settings.strategy.selectableOperationAllowlist ?? null,
			workflowValidForBlocks: Number(settings.strategy.workflowValidForBlocks),
		},
		submission: settings.submission,
		version: 1,
	}
}

function revision(contents: string) {
	return `sha256:${createHash('sha256').update(contents).digest('hex')}`
}

export function configurationRevisionConflict() {
	const error = new Error('The chaos-bot configuration changed after this editor loaded. Reload it, review the newer values, and apply your change again.')
	error.name = CONFIGURATION_REVISION_CONFLICT
	return error
}

export async function loadSettings(path = resolve(process.env['ZOLTAR_CHAOS_CONFIG'] ?? defaultSettingsPath), filesystem: SettingsFilesystem = settingsFilesystem) {
	let contents: string
	let handle: SettingsFileHandle | undefined
	try {
		handle = await filesystem.open(path, constants.O_RDONLY | constants.O_NOFOLLOW)
		const metadata = await handle.stat()
		if (!metadata.isFile()) {
			throw new Error(`Chaos-bot configuration ${path} must be a regular file`)
		}
		if ((metadata.mode & 0o777) !== 0o600) {
			throw new Error(`Chaos-bot configuration ${path} must have owner-only mode 0600`)
		}
		if (typeof process.getuid === 'function' && metadata.uid !== process.getuid()) {
			throw new Error(`Chaos-bot configuration ${path} must be owned by the bot process user`)
		}
		contents = await handle.readFile({ encoding: 'utf8' })
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') {
			throw new Error(`Missing chaos-bot configuration at ${path}. Copy config/operator.example.json there and edit it.`)
		}
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ELOOP') {
			throw new Error(`Chaos-bot configuration ${path} must not be a symbolic link`)
		}
		throw error
	} finally {
		await handle?.close()
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(contents)
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`Chaos-bot configuration is not valid JSON: ${error.message}`)
		throw error
	}
	return { path, revision: revision(contents), settings: parseSettings(parsed) }
}

export async function saveSettings(path: string, settings: OperatorSettings, expectedRevision?: string, filesystem: SettingsFilesystem = settingsFilesystem) {
	const resolvedPath = resolve(path)
	const contents = `${JSON.stringify(serializedSettings(settings), undefined, 2)}\n`
	const savedRevision = revision(contents)
	const previous = settingsWriteQueues.get(resolvedPath)
	const write = (previous === undefined ? Promise.resolve() : previous.catch(() => undefined)).then(async () => {
		await filesystem.mkdir(dirname(resolvedPath), { mode: 0o700, recursive: true })
		const temporaryPath = `${resolvedPath}.${process.pid.toString()}.${randomUUID()}.tmp`
		try {
			const handle = await filesystem.open(temporaryPath, 'wx', 0o600)
			try {
				await handle.writeFile(contents, { encoding: 'utf8' })
				await handle.chmod(0o600)
				await handle.sync()
			} finally {
				await handle.close()
			}
			if (expectedRevision !== undefined) {
				let current: string
				try {
					current = await filesystem.readFile(resolvedPath, 'utf8')
				} catch (error) {
					if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') throw configurationRevisionConflict()
					throw error
				}
				if (revision(current) !== expectedRevision) throw configurationRevisionConflict()
			}
			await filesystem.rename(temporaryPath, resolvedPath)
			const directoryHandle = await filesystem.open(dirname(resolvedPath), 'r')
			try {
				await directoryHandle.sync()
			} finally {
				await directoryHandle.close()
			}
		} catch (error) {
			await filesystem.rm(temporaryPath, { force: true })
			throw error
		}
	})
	const tracked = write.finally(() => {
		if (settingsWriteQueues.get(resolvedPath) === tracked) settingsWriteQueues.delete(resolvedPath)
	})
	settingsWriteQueues.set(resolvedPath, tracked)
	await tracked
	return savedRevision
}

export function chainSpecificPath(path: string, network: NetworkName) {
	const extension = extname(path)
	const stem = (extension === '' ? path : path.slice(0, -extension.length)).replace(/\.(?:mainnet|sepolia)$/, '')
	return `${stem}.${network}${extension}`
}

export function settingsProfilePath(path: string, network: NetworkName) {
	return `${path}.${network}.profile`
}

export function settingsProfilePathForNetwork(path: string, network: OperatorNetworkSettings) {
	if (network.kind !== 'custom') return settingsProfilePath(path, network.name)
	const chainId = customNetworkChainId(network.chainId, 'Custom profile chain ID')
	return `${path}.custom-chain-${chainId.toString()}.profile`
}

type ProfileCandidate = {
	expectedChainId: number
	expectedPreset?: NetworkName | undefined
	settings: OperatorSettings
}

function activeProfileCandidate(settings: OperatorSettings): ProfileCandidate {
	return { expectedChainId: settings.network.chainId, settings }
}

function presetProfileCandidate(expectedPreset: NetworkName, settings: OperatorSettings): ProfileCandidate {
	return {
		expectedChainId: expectedPreset === 'mainnet' ? 1 : 11_155_111,
		expectedPreset,
		settings,
	}
}

async function loadProfile(path: string, network: NetworkName) {
	try {
		return (await loadSettings(settingsProfilePath(path, network))).settings
	} catch (error) {
		if (error instanceof Error && error.message.startsWith('Missing chaos-bot configuration')) return undefined
		throw error
	}
}

async function assertProfileCandidates(path: string, candidates: readonly ProfileCandidate[]) {
	for (const candidate of candidates) {
		if (candidate.expectedPreset !== undefined && (candidate.settings.network.kind === 'custom' || candidate.settings.network.name !== candidate.expectedPreset || candidate.settings.network.chainId !== candidate.expectedChainId)) {
			throw new Error(`The ${candidate.expectedPreset} profile contains ${candidate.settings.network.name} settings`)
		}
		if (candidate.settings.network.chainId !== candidate.expectedChainId) throw new Error('A chain profile changed its configured chain ID')
	}
	const reservedPathNames = new Set([path, settingsProfilePath(path, 'mainnet'), settingsProfilePath(path, 'sepolia'), ...candidates.map(candidate => settingsProfilePathForNetwork(path, candidate.settings.network))])
	const reservedPaths = await Promise.all([...reservedPathNames].map(persistentPathIdentity))
	const statePaths: { candidate: ProfileCandidate; identity: Awaited<ReturnType<typeof persistentPathIdentity>> }[] = []
	for (const candidate of candidates) {
		const identity = await persistentPathIdentity(candidate.settings.runtime.stateFile)
		if (reservedPaths.some(reserved => persistentPathIdentitiesMatch(reserved, identity))) throw new Error('The durable state path must not reuse the active configuration or chain profile files')
		statePaths.push({ candidate, identity })
	}
	for (const [index, current] of statePaths.entries()) {
		for (const target of statePaths.slice(index + 1)) {
			if (target.candidate.expectedChainId !== current.candidate.expectedChainId && persistentPathIdentitiesMatch(current.identity, target.identity)) {
				throw new Error('Chain profiles with different chain IDs must use distinct durable state paths')
			}
		}
	}
}

function assertCompatibleProfileProcessMode(current: OperatorSettings, target: OperatorSettings) {
	if (current.runtime.once !== target.runtime.once || current.runtime.ui !== target.runtime.ui || current.runtime.uiHost !== target.runtime.uiHost || current.runtime.uiPort !== target.runtime.uiPort) {
		throw new Error('Chain profiles must use the same once mode and dashboard binding to switch in place')
	}
}

export async function assertSettingsProfileIsolation(path: string, active: OperatorSettings) {
	const mainnet = await loadProfile(path, 'mainnet')
	const sepolia = await loadProfile(path, 'sepolia')
	const candidates: ProfileCandidate[] = [activeProfileCandidate(active)]
	if (mainnet !== undefined) candidates.push(presetProfileCandidate('mainnet', mainnet))
	if (sepolia !== undefined) candidates.push(presetProfileCandidate('sepolia', sepolia))
	await assertProfileCandidates(path, candidates)
}

export async function switchSettingsNetworkProfile(path: string, network: NetworkName, examplePath: string, preflight?: (target: OperatorSettings) => Promise<void>) {
	const current = await loadSettings(path)
	const mainnet = await loadProfile(path, 'mainnet')
	const sepolia = await loadProfile(path, 'sepolia')
	const stored: ProfileCandidate[] = [activeProfileCandidate(current.settings)]
	if (mainnet !== undefined) stored.push(presetProfileCandidate('mainnet', mainnet))
	if (sepolia !== undefined) stored.push(presetProfileCandidate('sepolia', sepolia))
	await assertProfileCandidates(path, stored)
	if (current.settings.network.kind !== 'custom' && current.settings.network.name === network) return current
	let target = network === 'mainnet' ? mainnet : sepolia
	if (target === undefined) {
		const template = parseSettings(JSON.parse(await readFile(examplePath, 'utf8')))
		const chainId = network === 'mainnet' ? 1 : 11_155_111
		target = {
			...template,
			connectivity: undefined,
			deployment: Object.fromEntries(Object.keys(template.deployment).map(key => [key, zeroAddress])) as DeploymentSettings,
			network: {
				chainId,
				explorerUrl: network === 'mainnet' ? 'https://etherscan.io' : 'https://sepolia.etherscan.io',
				maximumBlockIntervalSeconds: PRESET_MAXIMUM_BLOCK_INTERVAL_SECONDS,
				name: network,
			},
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
	await assertProfileCandidates(path, [activeProfileCandidate(current.settings), presetProfileCandidate(network, target)])
	assertCompatibleProfileProcessMode(current.settings, target)
	await preflight?.(target)
	await saveSettings(settingsProfilePathForNetwork(path, current.settings.network), { ...current.settings, paused: true })
	await saveSettings(settingsProfilePath(path, network), target)
	const savedRevision = await saveSettings(path, target, current.revision)
	return { path, revision: savedRevision, settings: target }
}

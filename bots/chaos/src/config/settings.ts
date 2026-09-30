import { configurationRevisionConflict, contentRevision, durableFilesystem, parseJsonDocument, readOwnerFile, serializeWritesToPath, writeRevisionedFile, type OwnerFileHandle, type RevisionedFileFilesystem } from '@zoltar/bot-shared/config/durable-file'
import { assertProfileCandidates, networkProfilePath } from '@zoltar/bot-shared/config/profiles'
import { PRESERVE_PRIVATE_KEY, signerCandidate } from '@zoltar/bot-shared/config/signer'
import { getAddress, zeroAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { validateSubmissionSettings, type SubmissionSettings } from '@zoltar/bot-shared/execution/transaction-submission'
import { boolean, formatDecimalAmount, integer, nonemptyString, parseDecimalAmount } from '@zoltar/bot-shared/infrastructure/json-validation'
import { presetNetworkChainId, validateConnectivitySettings, validateIndependentReadRpcUrls, type ConnectivitySettings, type NetworkName } from '@zoltar/bot-shared/monitoring/connectivity'
import { MAINNET_CHAIN_ID, SEPOLIA_CHAIN_ID } from '@zoltar/core-shared/deployment/uniswapDeployments'
import { configuredQuorumRpcUrlMinimum, rpcQuorumRequirement, type RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { isErrorCode } from '@zoltar/bot-shared/infrastructure/error-code'
import { resolve } from 'node:path'
import { CHAOS_OPERATION_CATALOG } from '../operations/catalog.ts'
import { MINIMUM_WORKFLOW_VALIDITY_BLOCKS } from '../operations/timing.ts'
import { assertExactKeys, requiredRecord, uint256String } from '../state/validators.ts'
import { assertSepoliaUniswapFactory, canonicalDeployment } from './canonical-deployment.ts'
import { deploymentFactoryId, executionProfileId } from './execution-profile.ts'

const PRESET_MAXIMUM_BLOCK_INTERVAL_SECONDS = 60
const MAXIMUM_BLOCK_INTERVAL_SECONDS = 86_400

export const CHAOS_ECOSYSTEMS = ['zoltar', 'statoblast', 'open-oracle', 'trading'] as const
type ChaosEcosystem = (typeof CHAOS_ECOSYSTEMS)[number]

export type DeploymentSettings = {
	openOracle: Address
	questionData: Address
	securityPoolFactory: Address
	securityPoolForker: Address
	tradingFactory: Address
	tradingRouter: Address
	uniswapV3Factory?: Address | undefined
	weth: Address
	zoltar: Address
}

type DiscoverySettings = {
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

type RuntimeSettings = {
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

type PresetNetworkSettings = {
	chainId: number
	explorerUrl: string
	kind?: undefined
	maximumBlockIntervalSeconds: number
	name: NetworkName
}

type CustomNetworkSettings = {
	chainId: number
	explorerUrl: string
	kind: 'custom'
	maximumBlockIntervalSeconds: number
	name: string
}

type OperatorNetworkSettings = PresetNetworkSettings | CustomNetworkSettings

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

export type SettingsFilesystem = Omit<RevisionedFileFilesystem, 'open'> & {
	open: (path: string, flags: 'r' | 'wx' | number, mode?: number) => Promise<OwnerFileHandle>
}

const defaultSettingsPath = resolve(import.meta.dir, '..', '..', '.state', 'operator.json')

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
	if (chainId === MAINNET_CHAIN_ID || chainId === SEPOLIA_CHAIN_ID) throw new Error(`${label} must not reuse the mainnet or sepolia preset chain ID`)
	return chainId
}

function maximumBlockIntervalSeconds(value: unknown, label = 'network.maximumBlockIntervalSeconds') {
	return integer(value, label, 1, MAXIMUM_BLOCK_INTERVAL_SECONDS)
}

function filePath(value: unknown, label: string) {
	return resolve(nonemptyString(value, label))
}

function parseNetwork(value: unknown): OperatorSettings['network'] {
	const network = requiredRecord(value, 'network')
	if ('kind' in network) {
		assertExactKeys(network, ['chainId', 'explorerUrl', 'kind', 'maximumBlockIntervalSeconds', 'name'], [], 'custom network')
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
	const canonicalChainId = presetNetworkChainId(name)
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
	assertExactKeys(connectivity, ['publicRpcUrls', 'quorumRpcUrls', 'readRpcUrl', 'rpcQuorum'], [], 'connectivity')
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

function parseDiscovery(value: unknown): DiscoverySettings {
	const discovery = requiredRecord(value, 'discovery')
	const keys = ['maxPools', 'maxQuestions', 'maxStagedOperationsPerPool', 'maxUniverses', 'maxVaultsPerPool'] as const
	assertExactKeys(discovery, keys, [], 'discovery')
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
	assertExactKeys(runtime, ['execute', 'lifecyclePollMilliseconds', 'once', 'protocolLogBlockSpan', 'protocolStartBlock', 'stateFile', 'ui', 'uiHost', 'uiPort'], [], 'runtime')
	if (runtime['uiHost'] !== '127.0.0.1' && runtime['uiHost'] !== '0.0.0.0') throw new Error('runtime.uiHost must be 127.0.0.1 or 0.0.0.0')
	const once = boolean(runtime['once'], 'runtime.once')
	const ui = boolean(runtime['ui'], 'runtime.ui')
	if (once && ui) throw new Error('runtime.once and runtime.ui cannot both be enabled')
	return {
		execute: boolean(runtime['execute'], 'runtime.execute'),
		lifecyclePollMilliseconds: integer(runtime['lifecyclePollMilliseconds'], 'runtime.lifecyclePollMilliseconds', 1_000, 60_000),
		once,
		protocolLogBlockSpan: integer(runtime['protocolLogBlockSpan'], 'runtime.protocolLogBlockSpan', 1, 50_000),
		protocolStartBlock: BigInt(uint256String(runtime['protocolStartBlock'], 'runtime.protocolStartBlock')),
		stateFile: filePath(runtime['stateFile'], 'runtime.stateFile'),
		ui,
		uiHost: runtime['uiHost'],
		uiPort: integer(runtime['uiPort'], 'runtime.uiPort', 1, 65_535),
	}
}

function parseScheduler(value: unknown): SchedulerSettings {
	const scheduler = requiredRecord(value, 'scheduler')
	assertExactKeys(scheduler, ['maximumDelaySeconds', 'minimumDelaySeconds'], [], 'scheduler')
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
	assertExactKeys(strategy, [...requiredKeys, ...optionalKeys], [], 'strategy')
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

function parseDeploymentPin(value: unknown, network: OperatorSettings['network']): DeploymentSettings {
	const pin = requiredRecord(value, 'deploymentPin')
	const addressKeys = ['openOracle', 'questionData', 'securityPoolFactory', 'securityPoolForker', 'tradingFactory', 'tradingRouter', 'uniswapV3Factory', 'weth', 'zoltar'] as const
	assertExactKeys(pin, ['factoryId', 'profileId', ...addressKeys], [], 'deploymentPin')
	const address = (key: (typeof addressKeys)[number]) => {
		const value = pin[key]
		if (typeof value !== 'string') throw new Error(`deploymentPin.${key} must be an address`)
		const parsed = getAddress(value)
		if (parsed === zeroAddress) throw new Error(`deploymentPin.${key} must not be the zero address`)
		return parsed
	}
	const deployment = {
		openOracle: address('openOracle'),
		questionData: address('questionData'),
		securityPoolFactory: address('securityPoolFactory'),
		securityPoolForker: address('securityPoolForker'),
		tradingFactory: address('tradingFactory'),
		tradingRouter: address('tradingRouter'),
		uniswapV3Factory: address('uniswapV3Factory'),
		weth: address('weth'),
		zoltar: address('zoltar'),
	}
	if (pin['profileId'] !== executionProfileId({ deployment, network })) throw new Error('deploymentPin does not match its chain and deployment addresses')
	if (pin['factoryId'] !== deploymentFactoryId(pin['profileId'], deployment.uniswapV3Factory)) throw new Error('deploymentPin factory does not match its saved identity')
	assertSepoliaUniswapFactory(network.chainId, deployment.uniswapV3Factory)
	return deployment
}

export function parseSettings(value: unknown, preservedPrivateKey?: Hex): OperatorSettings {
	const root = requiredRecord(value, 'operator settings')
	// Accept the obsolete field so existing saved configurations can migrate; never use its addresses.
	assertExactKeys(root, ['connectivity', ...('deployment' in root ? ['deployment'] : []), ...('deploymentPin' in root ? ['deploymentPin'] : []), 'discovery', 'network', 'networkConfigured', 'paused', 'privateKey', 'runtime', 'scheduler', 'strategy', 'submission', 'version'], [], 'operator settings')
	if (root['version'] !== 1) throw new Error('operator settings version must be 1')
	const networkConfigured = boolean(root['networkConfigured'], 'networkConfigured')
	const connectivity = root['connectivity'] === null ? undefined : parseConnectivity(root['connectivity'])
	if (networkConfigured !== (connectivity !== undefined)) throw new Error(networkConfigured ? 'A configured network requires connectivity' : 'An unconfigured network cannot retain connectivity')
	if (root['privateKey'] === PRESERVE_PRIVATE_KEY && preservedPrivateKey === undefined) throw new Error('A redacted private key can only preserve an existing saved signer')
	const privateKeyValue = root['privateKey'] === PRESERVE_PRIVATE_KEY ? preservedPrivateKey : root['privateKey']
	const privateKey = signerCandidate(privateKeyValue ?? null).privateKey
	const network = parseNetwork(root['network'])
	const settings: OperatorSettings = {
		connectivity,
		deployment: root['deploymentPin'] === undefined ? canonicalDeployment(network.chainId) : parseDeploymentPin(root['deploymentPin'], network),
		discovery: parseDiscovery(root['discovery']),
		network,
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
	if (settings.runtime.execute && settings.connectivity !== undefined && settings.connectivity.quorumRpcUrls.length < configuredQuorumRpcUrlMinimum(settings.connectivity.rpcQuorum)) {
		throw new Error('Live execution with RPC quorum 2 requires three independent read origins')
	}
	return settings
}

export function serializedSettings(settings: OperatorSettings, redactPrivateKey = false) {
	const factory = settings.deployment.uniswapV3Factory
	if (factory === undefined) throw new Error('Cannot save a deployment profile without a Uniswap V3 factory')
	assertSepoliaUniswapFactory(settings.network.chainId, factory)
	const profileId = executionProfileId(settings)
	return {
		connectivity: settings.connectivity === undefined ? null : { ...settings.connectivity },
		deploymentPin: { factoryId: deploymentFactoryId(profileId, factory), profileId, ...settings.deployment },
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

export function chaosConfigurationRevisionConflict() {
	return configurationRevisionConflict('chaos-bot configuration')
}

export async function loadSettings(path = resolve(process.env['ZOLTAR_CHAOS_CONFIG'] ?? defaultSettingsPath), filesystem: SettingsFilesystem = durableFilesystem) {
	let contents: string
	try {
		contents = await readOwnerFile(path, filesystem, 'Chaos-bot configuration')
	} catch (error) {
		if (isErrorCode(error, 'ENOENT')) throw new Error(`Missing chaos-bot configuration at ${path}. Create it with \`install -m 600 config/operator.example.json ${path}\` and edit it.`)
		throw error
	}
	const parsed = parseJsonDocument(contents, 'Chaos-bot configuration')
	const raw = requiredRecord(parsed, 'operator settings')
	const settings = parseSettings(raw)
	return { path, revision: contentRevision(contents), settings, needsDeploymentPin: !('deploymentPin' in raw) }
}

export async function saveSettings(path: string, settings: OperatorSettings, expectedRevision?: string, filesystem: SettingsFilesystem = durableFilesystem) {
	const resolvedPath = resolve(path)
	const contents = `${JSON.stringify(serializedSettings(settings), undefined, 2)}\n`
	return await serializeWritesToPath(resolvedPath, () => writeRevisionedFile(resolvedPath, contents, { conflict: chaosConfigurationRevisionConflict, expectedRevision, filesystem }))
}

function settingsProfilePathForNetwork(path: string, network: OperatorNetworkSettings) {
	if (network.kind !== 'custom') return networkProfilePath(path, network.name)
	const chainId = customNetworkChainId(network.chainId, 'Custom profile chain ID')
	return `${path}.custom-chain-${chainId.toString()}.profile`
}

/** Profiles are keyed by chain ID; a preset profile file must also hold that preset's settings. */
type SettingsProfileCandidate = {
	expected: number
	expectedPreset?: NetworkName | undefined
	settings: OperatorSettings
}

function presetProfileCandidate(expectedPreset: NetworkName, settings: OperatorSettings): SettingsProfileCandidate {
	return {
		expected: presetNetworkChainId(expectedPreset),
		expectedPreset,
		settings,
	}
}

async function loadProfile(path: string, network: NetworkName) {
	try {
		return (await loadSettings(networkProfilePath(path, network))).settings
	} catch (error) {
		if (error instanceof Error && error.message.startsWith('Missing chaos-bot configuration')) return undefined
		throw error
	}
}

export async function assertSettingsProfileIsolation(path: string, active: OperatorSettings) {
	const mainnet = await loadProfile(path, 'mainnet')
	const sepolia = await loadProfile(path, 'sepolia')
	const candidates: SettingsProfileCandidate[] = [{ expected: active.network.chainId, settings: active }]
	if (mainnet !== undefined) candidates.push(presetProfileCandidate('mainnet', mainnet))
	if (sepolia !== undefined) candidates.push(presetProfileCandidate('sepolia', sepolia))
	await assertProfileCandidates({
		assertIdentity: candidate => {
			if (candidate.expectedPreset !== undefined && (candidate.settings.network.kind === 'custom' || candidate.settings.network.name !== candidate.expectedPreset || candidate.settings.network.chainId !== candidate.expected)) {
				throw new Error(`The ${candidate.expectedPreset} profile contains ${candidate.settings.network.name} settings`)
			}
			if (candidate.settings.network.chainId !== candidate.expected) throw new Error('A chain profile changed its configured chain ID')
		},
		candidates,
		durablePaths: candidate => [candidate.settings.runtime.stateFile],
		errors: {
			crossChainPathReuse: 'Chain profiles with different chain IDs must use distinct durable state paths',
			reservedPathReuse: 'The durable state path must not reuse the active configuration or chain profile files',
		},
		reservedPaths: [...new Set([path, networkProfilePath(path, 'mainnet'), networkProfilePath(path, 'sepolia'), ...candidates.map(candidate => settingsProfilePathForNetwork(path, candidate.settings.network))])],
	})
}

import { createHash } from 'node:crypto'
import { bigintToSafeNumber, encodeAbiParameters, getAddress, zeroAddress, zeroHash, type Address, type Chain, type Hash, type Hex, type PublicClient, type Transport } from '@zoltar/bot-shared/ethereum'
import {
	auctionAbi,
	coordinatorAbi,
	erc1155Abi,
	erc20Abi,
	escalationGameAbi,
	liquidationApprovalRegistryAbi,
	openOracleAbi,
	questionDataAbi,
	securityPoolAbi,
	securityPoolFactoryAbi,
	securityPoolForkerAbi,
	shareTokenAbi,
	tradingFactoryAbi,
	tradingPairAbi,
	tradingRouterAbi,
	uniswapV3FactoryAbi,
	uniswapV3PoolAbi,
	zoltarAbi,
} from '../contracts/abi.ts'
import { MAXIMUM_DISCOVERY_AGGREGATE_ITEMS } from '../config/settings.ts'
import { CANONICAL_PROXY_DEPLOYER, CANONICAL_PROXY_DEPLOYER_RUNTIME, CANONICAL_UNISWAP_V3_FACTORY, GENESIS_UNISWAP_FEE, genesisUniswapSeederDeployment } from '../core/genesis-uniswap.ts'
import { canonicalUintString, type CanonicalUintString } from '../core/units.ts'
import type {
	AuctionBidSnapshot,
	AuctionRefundSnapshot,
	AuctionSnapshot,
	ChildRepSplitProgressSnapshot,
	EcosystemDeployments,
	EcosystemSnapshot,
	EscalationDepositSnapshot,
	MigrationRepSplitProgressSnapshot,
	OracleGameSnapshot,
	PairSnapshot,
	PoolSnapshot,
	QuestionSnapshot,
	ShareInventory,
	StagedOperationSnapshot,
	TokenInventory,
	UniverseSnapshot,
	VaultSnapshot,
} from '../operations/types.ts'
import { validForkOutcomeRoutes } from '../operations/fork-outcomes.ts'
import { assertAnchoredOracleRequestFunding } from '../operations/oracle-request-funding.ts'
import { OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT, trustedOpenOracleReportPredicate } from './protocol-index.ts'
import {
	cloneImmutableTopologyData,
	emptyCountedRegistryCursor,
	emptyImmutableTopologyData,
	IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
	IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES,
	IMMUTABLE_TOPOLOGY_MAXIMUM_RECORD_BYTES,
	type CachedPoolDeployment,
	type CanonicalImmutableTopologyCache,
	type CountedRegistryCursor,
	type ImmutableTopologyData,
} from './topology-cache.ts'

export type ChaosReadClient = PublicClient<Transport, Chain>

export const DISCOVERY_RPC_CONCURRENCY = 12
export const DISCOVERY_RPC_QUEUE_LIMIT = DISCOVERY_RPC_CONCURRENCY * 4
export const DISCOVERY_AGGREGATE_ITEM_LIMIT = MAXIMUM_DISCOVERY_AGGREGATE_ITEMS
const DISCOVERY_QUESTION_RESIDENT_UTF8_BYTES = 32 * 1024 * 1024
export const FORK_MIGRATION_WINDOW_SECONDS = 8n * 7n * 24n * 60n * 60n
const OUTCOME_LABEL_PAGE_SIZE = 256n
// Zoltar persists and emits every non-empty label in one createQuestion
// transaction. These ceilings are far above a practical transaction-sized
// domain, but still make a hostile endpoint's pagination and memory finite.
const DEFAULT_MAXIMUM_OUTCOME_LABELS_PER_QUESTION = 4_096
const DEFAULT_MAXIMUM_OUTCOME_LABEL_UTF8_BYTES_PER_QUESTION = IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES
const utf8Encoder = new TextEncoder()

export function forkMigrationWindowIsOpen(systemState: bigint, forkActivationTime: bigint, timestamp: bigint) {
	return systemState === 1n && forkActivationTime > 0n && timestamp <= forkActivationTime + FORK_MIGRATION_WINDOW_SECONDS
}

export function limitDiscoveryConcurrency(client: ChaosReadClient, maximum = DISCOVERY_RPC_CONCURRENCY): ChaosReadClient {
	if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new Error('Discovery RPC concurrency must be a positive safe integer')
	let active = 0
	const waiting: Array<() => void> = []
	const schedule = async <T>(work: () => Promise<T>) => {
		if (active >= maximum) {
			if (waiting.length >= DISCOVERY_RPC_QUEUE_LIMIT) throw new Error(`Discovery RPC queue exceeded its ${DISCOVERY_RPC_QUEUE_LIMIT.toString()}-request safety limit`)
			await new Promise<void>(resolve => waiting.push(resolve))
		}
		active += 1
		try {
			return await work()
		} finally {
			active -= 1
			waiting.shift()?.()
		}
	}
	const limitedMethods = new Set<PropertyKey>(['getBalance', 'getBlock', 'getBlockNumber', 'getChainId', 'getLogs', 'readContract', 'request', 'simulateContract'])
	return new Proxy(client, {
		get(target, property, receiver) {
			const value = Reflect.get(target, property, receiver)
			if (typeof value !== 'function') return value
			if (!limitedMethods.has(property)) return value.bind(target)
			const invoke = value.bind(target)
			return (...args: unknown[]) => schedule(async () => await invoke(...args))
		},
	})
}

export interface DiscoveryLimits {
	maxOutcomeLabelUtf8BytesPerQuestion: number
	maxOutcomeLabelsPerQuestion: number
	maxQuestions: number
	maxUniverses: number
	maxPools: number
	maxVaultsPerPool: number
	maxStagedOperationsPerPool: number
}

export interface EcosystemDiscoveryContext {
	allowMissingTradingDeployment?: boolean
	client: ChaosReadClient
	deployments: EcosystemDeployments
	wallet: Address
	anchorBlockNumber: bigint
	expectedAnchorBaseFeePerGas?: bigint
	expectedAnchorHash?: Hash
	limits?: Partial<DiscoveryLimits>
	indexedReports?: readonly OracleGameSnapshot[]
	indexedAuctionBids?: Readonly<Record<string, readonly AuctionBidSnapshot[]>>
	indexedAuctionRefunds?: Readonly<Record<string, Readonly<AuctionRefundSnapshot>>>
	indexedChildRepSplits?: readonly ChildRepSplitProgressSnapshot[]
	indexedEscalationDeposits?: readonly EscalationDepositSnapshot[]
	indexedMigrationRepSplits?: readonly MigrationRepSplitProgressSnapshot[]
	tokenSymbols?: Readonly<Record<string, string>>
	topologyCache?: CanonicalImmutableTopologyCache
	recordTopologyCache?: (cache: CanonicalImmutableTopologyCache, changed: boolean) => void
}

type TopologyMutationState = {
	changed: boolean
}

const DEFAULT_LIMITS: DiscoveryLimits = {
	maxOutcomeLabelUtf8BytesPerQuestion: DEFAULT_MAXIMUM_OUTCOME_LABEL_UTF8_BYTES_PER_QUESTION,
	maxOutcomeLabelsPerQuestion: DEFAULT_MAXIMUM_OUTCOME_LABELS_PER_QUESTION,
	maxPools: 100,
	maxQuestions: 100,
	maxStagedOperationsPerPool: 100,
	maxUniverses: 100,
	maxVaultsPerPool: 100,
}

function limitsWithDefaults(configured?: Partial<DiscoveryLimits>): DiscoveryLimits {
	return {
		maxOutcomeLabelUtf8BytesPerQuestion: configured?.maxOutcomeLabelUtf8BytesPerQuestion ?? DEFAULT_LIMITS.maxOutcomeLabelUtf8BytesPerQuestion,
		maxOutcomeLabelsPerQuestion: configured?.maxOutcomeLabelsPerQuestion ?? DEFAULT_LIMITS.maxOutcomeLabelsPerQuestion,
		maxPools: configured?.maxPools ?? DEFAULT_LIMITS.maxPools,
		maxQuestions: configured?.maxQuestions ?? DEFAULT_LIMITS.maxQuestions,
		maxStagedOperationsPerPool: configured?.maxStagedOperationsPerPool ?? DEFAULT_LIMITS.maxStagedOperationsPerPool,
		maxUniverses: configured?.maxUniverses ?? DEFAULT_LIMITS.maxUniverses,
		maxVaultsPerPool: configured?.maxVaultsPerPool ?? DEFAULT_LIMITS.maxVaultsPerPool,
	}
}

async function discoverOutcomeLabels(client: ChaosReadClient, questionData: Address, questionId: bigint, blockNumber: bigint, limits: DiscoveryLimits) {
	const outcomeLabels: string[] = []
	let utf8Bytes = 0
	for (;;) {
		const remaining = limits.maxOutcomeLabelsPerQuestion - outcomeLabels.length
		const requested = remaining === 0 ? 1n : BigInt(Math.min(remaining, Number(OUTCOME_LABEL_PAGE_SIZE)))
		const page = await client.readContract({ abi: questionDataAbi, address: questionData, args: [questionId, BigInt(outcomeLabels.length), requested], blockNumber, functionName: 'getOutcomeLabels' })
		if (BigInt(page.length) > requested) throw new Error(`Question ${questionId.toString()} outcome-label page exceeded its requested size`)
		if (remaining === 0) {
			if (page.length === 0) return outcomeLabels
			throw new Error(`Question ${questionId.toString()} exceeds the configured ${limits.maxOutcomeLabelsPerQuestion.toString()}-label discovery limit`)
		}
		for (const label of page) {
			utf8Bytes += utf8Encoder.encode(label).byteLength
			if (utf8Bytes > limits.maxOutcomeLabelUtf8BytesPerQuestion) {
				throw new Error(`Question ${questionId.toString()} outcome labels exceed the configured ${limits.maxOutcomeLabelUtf8BytesPerQuestion.toString()}-byte UTF-8 discovery limit`)
			}
		}
		outcomeLabels.push(...page)
		if (BigInt(page.length) < requested) return outcomeLabels
	}
}

function requirePositiveLimit(value: unknown, label: string) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`)
}

function requireAggregateDiscoveryEnvelope(limits: DiscoveryLimits) {
	for (const [label, value] of [
		['maxOutcomeLabelsPerQuestion', limits.maxOutcomeLabelsPerQuestion],
		['maxPools', limits.maxPools],
		['maxQuestions', limits.maxQuestions],
		['maxStagedOperationsPerPool', limits.maxStagedOperationsPerPool],
		['maxUniverses', limits.maxUniverses],
		['maxVaultsPerPool', limits.maxVaultsPerPool],
	] as const) {
		if (value > DISCOVERY_AGGREGATE_ITEM_LIMIT) throw new Error(`${label} exceeds the ${DISCOVERY_AGGREGATE_ITEM_LIMIT.toString()}-item discovery safety envelope`)
	}
	if (limits.maxOutcomeLabelUtf8BytesPerQuestion > IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES) {
		throw new Error(`maxOutcomeLabelUtf8BytesPerQuestion exceeds the ${IMMUTABLE_TOPOLOGY_MAXIMUM_QUESTION_LABEL_UTF8_BYTES.toString()}-byte immutable-topology safety envelope`)
	}
	if (limits.maxPools * limits.maxUniverses > DISCOVERY_AGGREGATE_ITEM_LIMIT) throw new Error(`maxPools × maxUniverses exceeds the ${DISCOVERY_AGGREGATE_ITEM_LIMIT.toString()}-item discovery safety envelope`)
	if (limits.maxPools * limits.maxVaultsPerPool > DISCOVERY_AGGREGATE_ITEM_LIMIT) throw new Error(`maxPools × maxVaultsPerPool exceeds the ${DISCOVERY_AGGREGATE_ITEM_LIMIT.toString()}-item discovery safety envelope`)
	if (limits.maxPools * limits.maxStagedOperationsPerPool > DISCOVERY_AGGREGATE_ITEM_LIMIT) throw new Error(`maxPools × maxStagedOperationsPerPool exceeds the ${DISCOVERY_AGGREGATE_ITEM_LIMIT.toString()}-item discovery safety envelope`)
}

const CONTRACT_REVERT_MESSAGE = /(?:execution reverted|\brevert(?:ed|ing)?\b|always failing transaction)/i
const stagedRouteIneligibilityErrors = new WeakSet<Error>()

function contractSimulationReverted(error: unknown) {
	const visited = new Set<Error>()
	let current = error
	while (current instanceof Error && !visited.has(current)) {
		if (current.name === 'ContractFunctionRevertedError' || CONTRACT_REVERT_MESSAGE.test(current.message)) return true
		visited.add(current)
		current = current.cause
	}
	return false
}

function stagedRouteIneligible(message: string) {
	const error = new Error(message)
	stagedRouteIneligibilityErrors.add(error)
	return error
}

function isStagedRouteIneligible(error: unknown) {
	return error instanceof Error && stagedRouteIneligibilityErrors.has(error)
}

async function immutableTopologyForAnchor(context: EcosystemDiscoveryContext, block: { hash: Hash; number: bigint }) {
	const cached = context.topologyCache
	if (cached === undefined) return { reset: true, topology: emptyImmutableTopologyData() }
	const cachedBlockNumber = BigInt(cached.anchor.blockNumber)
	if (cachedBlockNumber > block.number) {
		return { reset: true, topology: emptyImmutableTopologyData() }
	}
	if (cachedBlockNumber === block.number) {
		return cached.anchor.blockHash.toLowerCase() === block.hash.toLowerCase() ? { reset: false, topology: cloneImmutableTopologyData(cached) } : { reset: true, topology: emptyImmutableTopologyData() }
	}
	const cachedBlock = await context.client.getBlock({ blockNumber: cachedBlockNumber })
	if (cachedBlock.hash == null || cachedBlock.number !== cachedBlockNumber || cachedBlock.hash.toLowerCase() !== cached.anchor.blockHash.toLowerCase()) {
		return { reset: true, topology: emptyImmutableTopologyData() }
	}
	return { reset: false, topology: cloneImmutableTopologyData(cached) }
}

export async function collectCountedPages<T>(parameters: { count: bigint; label: string; maximumItems: number; pageSize: number; readPage: (start: bigint, count: bigint) => Promise<readonly T[]>; start: bigint }) {
	if (parameters.count < 0n) throw new Error(`${parameters.label} count cannot be negative`)
	if (parameters.start < 0n || parameters.start > parameters.count) throw new Error(`${parameters.label} cursor is outside its canonical count`)
	requirePositiveLimit(parameters.maximumItems, `${parameters.label} cycle item limit`)
	requirePositiveLimit(parameters.pageSize, `${parameters.label} page size`)
	const values: T[] = []
	const pageSize = BigInt(parameters.pageSize)
	const cycleEnd = parameters.start + BigInt(parameters.maximumItems) < parameters.count ? parameters.start + BigInt(parameters.maximumItems) : parameters.count
	for (let start = parameters.start; start < cycleEnd; ) {
		const remaining = cycleEnd - start
		const requested = remaining < pageSize ? remaining : pageSize
		const page = await parameters.readPage(start, requested)
		if (page.length !== Number(requested)) {
			throw new Error(`${parameters.label} page at ${start.toString()} returned ${page.length.toString()} entries instead of ${requested.toString()}`)
		}
		values.push(...page)
		start += requested
	}
	const nextStart = parameters.start + BigInt(values.length)
	return { complete: nextStart === parameters.count, nextStart, values }
}

function updateRegistryCommitment(previous: Hash, start: bigint, values: readonly string[]) {
	let commitment = previous
	for (let offset = 0; offset < values.length; offset += 1) {
		const value = values[offset]
		if (value === undefined) throw new Error(`Immutable registry commitment lost value ${offset.toString()}`)
		const hasher = createHash('sha256')
		hasher.update(commitment, 'utf8')
		hasher.update(`:${(start + BigInt(offset)).toString()}:${Buffer.byteLength(value, 'utf8').toString()}:`, 'utf8')
		hasher.update(value, 'utf8')
		commitment = `0x${hasher.digest('hex')}` as Hash
	}
	return commitment
}

function cursorWithCanonicalCount(cursor: CountedRegistryCursor | undefined, count: bigint, residentLimit: number, retentionMode: CountedRegistryCursor['retentionMode']) {
	const current = cursor ?? emptyCountedRegistryCursor()
	if (BigInt(current.nextIndex) > count || BigInt(current.canonicalCount) > count) throw new Error(`Immutable registry count ${count.toString()} no longer extends its authenticated cursor`)
	return { ...current, canonicalCount: count.toString(), residentLimit: residentLimit.toString(), retentionMode }
}

function assertRegistryCountNotRegressed(cursor: CountedRegistryCursor | undefined, count: bigint, label: string) {
	if (cursor !== undefined && (BigInt(cursor.nextIndex) > count || BigInt(cursor.canonicalCount) > count)) {
		throw new Error(`${label} canonical count ${count.toString()} no longer extends its authenticated cursor`)
	}
}

function registryCatchUpWarning(label: string, cursor: CountedRegistryCursor) {
	return BigInt(cursor.nextIndex) < BigInt(cursor.canonicalCount)
		? `${label} discovery truncated while bounded catch-up authenticated ${cursor.nextIndex} of ${cursor.canonicalCount} canonical entries`
		: `${label} discovery truncated after authenticating the exact canonical total ${cursor.canonicalCount}; configured resident safety envelope cannot hold complete topology (entry limit ${cursor.residentLimit})`
}

function sameRegistryCursor(left: CountedRegistryCursor, right: CountedRegistryCursor) {
	return left.canonicalCount === right.canonicalCount && left.commitment === right.commitment && left.nextIndex === right.nextIndex && left.residentLimit === right.residentLimit && left.retentionMode === right.retentionMode
}

export async function advanceVaultRegistryCursor(parameters: { cachedVaults: readonly Address[]; canonicalCount: bigint; cursor: CountedRegistryCursor | undefined; label: string; limit: number; readNewestFirstPage: (start: bigint, count: bigint) => Promise<readonly Address[]> }) {
	requirePositiveLimit(parameters.limit, `${parameters.label} resident limit`)
	let changed = false
	let cachedVaults = [...parameters.cachedVaults]
	let cursor = parameters.cursor
	assertRegistryCountNotRegressed(cursor, parameters.canonicalCount, parameters.label)
	const retentionMode: CountedRegistryCursor['retentionMode'] = parameters.canonicalCount <= BigInt(parameters.limit) ? 'resident' : 'overflow'
	if (cursor?.retentionMode === 'overflow' && retentionMode === 'resident') {
		cursor = emptyCountedRegistryCursor()
		cachedVaults = []
		changed = true
	}
	if (retentionMode === 'overflow' && cachedVaults.length > 0) {
		cachedVaults = []
		changed = true
	}
	const canonicalCursor = cursorWithCanonicalCount(cursor, parameters.canonicalCount, parameters.limit, retentionMode)
	if (cursor === undefined || !sameRegistryCursor(cursor, canonicalCursor)) changed = true
	cursor = canonicalCursor
	if (cursor.retentionMode === 'resident' && BigInt(cachedVaults.length) !== BigInt(cursor.nextIndex)) throw new Error(`${parameters.label} cursor does not match its retained canonical prefix`)
	const collected = await collectCountedPages({
		count: parameters.canonicalCount,
		label: parameters.label,
		maximumItems: parameters.limit,
		pageSize: parameters.limit,
		readPage: async (start, pageCount) => {
			const end = start + pageCount
			const newestFirst = await parameters.readNewestFirstPage(parameters.canonicalCount - end, pageCount)
			return [...newestFirst].reverse().map(getAddress)
		},
		start: BigInt(cursor.nextIndex),
	})
	const newlyRegisteredVaults = collected.values
	if (newlyRegisteredVaults.length > 0) {
		cursor = {
			...cursor,
			commitment: updateRegistryCommitment(
				cursor.commitment,
				BigInt(cursor.nextIndex),
				newlyRegisteredVaults.map(vault => vault.toLowerCase()),
			),
			nextIndex: collected.nextStart.toString(),
		}
		changed = true
	}
	const vaults = cursor.retentionMode === 'resident' ? [...newlyRegisteredVaults].reverse().concat(cachedVaults) : []
	if (cursor.retentionMode === 'resident' && (BigInt(vaults.length) !== parameters.canonicalCount || new Set(vaults.map(vault => vault.toLowerCase())).size !== vaults.length)) {
		throw new Error(`${parameters.label} contains duplicate or missing immutable entries`)
	}
	return { changed, complete: collected.complete, cursor, vaults }
}

export async function drainConcurrent<T extends readonly unknown[] | []>(values: T) {
	const settled = await Promise.allSettled(values)
	for (const result of settled) if (result.status === 'rejected') throw result.reason
	return await Promise.all(values)
}

export async function mapWithConcurrency<T, R>(values: readonly T[], maximum: number, mapper: (value: T, index: number) => Promise<R>): Promise<R[]> {
	requirePositiveLimit(maximum, 'Mapping concurrency')
	const results: Array<{ value: R } | undefined> = Array.from({ length: values.length })
	let nextIndex = 0
	let failure: { error: unknown } | undefined
	const worker = async () => {
		for (;;) {
			if (failure !== undefined) return
			const index = nextIndex
			if (index >= values.length) return
			nextIndex += 1
			const value = values[index]
			if (value === undefined) {
				failure ??= { error: new Error(`Bounded mapping lost value ${index.toString()}`) }
				return
			}
			try {
				results[index] = { value: await mapper(value, index) }
			} catch (error) {
				failure ??= { error }
				return
			}
		}
	}
	await drainConcurrent(Array.from({ length: Math.min(maximum, values.length) }, worker))
	if (failure !== undefined) throw failure.error
	return results.map((value, index) => {
		if (value === undefined) throw new Error(`Bounded mapping lost result ${index.toString()}`)
		return value.value
	})
}

export function canonicalDiscoveryWarnings(warnings: readonly string[]) {
	return [...new Set(warnings)].sort((left, right) => left.localeCompare(right))
}

function sameAddress(left: Address, right: Address) {
	return left.toLowerCase() === right.toLowerCase()
}

function compareUnsignedStrings(left: string, right: string) {
	const leftValue = BigInt(left)
	const rightValue = BigInt(right)
	if (leftValue < rightValue) return -1
	if (leftValue > rightValue) return 1
	return 0
}

function requireGraphEdge(actual: Address, expected: Address, label: string) {
	if (!sameAddress(actual, expected)) throw new Error(`${label} points to ${actual}, expected ${expected}`)
}

export interface PoolProtocolBindingAuthentication {
	blockNumber: bigint
	canonicalRepToken: Address
	client: ChaosReadClient
	configuredOpenOracle: Address
	configuredWeth: Address
	coordinator: Address
	pool: Address
}

/** Authenticates the immutable oracle and token bindings that authorize pool transactions. */
export async function authenticatePoolProtocolBindings(authentication: PoolProtocolBindingAuthentication) {
	const { blockNumber, canonicalRepToken, client, configuredOpenOracle, configuredWeth, coordinator, pool } = authentication
	const [poolOpenOracle, coordinatorOpenOracle, coordinatorWeth, coordinatorRepToken] = await drainConcurrent([
		client.readContract({ abi: securityPoolAbi, address: pool, blockNumber, functionName: 'openOracle' }),
		client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'openOracle' }),
		client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'weth' }),
		client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'reputationToken' }),
	])
	requireGraphEdge(getAddress(poolOpenOracle), configuredOpenOracle, `Pool ${pool} OpenOracle edge`)
	requireGraphEdge(getAddress(coordinatorOpenOracle), configuredOpenOracle, `Coordinator ${coordinator} OpenOracle edge`)
	requireGraphEdge(getAddress(coordinatorWeth), configuredWeth, `Coordinator ${coordinator} WETH edge`)
	requireGraphEdge(getAddress(coordinatorRepToken), canonicalRepToken, `Coordinator ${coordinator} REP edge`)
}

export interface PoolGraphIdentity {
	pool: Address
	poolFactory: Address
	configuredFactory: Address
	poolForker: Address
	configuredForker: Address
	poolZoltar: Address
	configuredZoltar: Address
	poolQuestionData: Address
	configuredQuestionData: Address
	poolCoordinator: Address
	deploymentCoordinator: Address
	coordinatorPool: Address
	poolShareToken: Address
	deploymentShareToken: Address
	poolRepToken: Address
	universeRepToken: Address
	poolTruthAuction: Address
	deploymentTruthAuction: Address
	poolUniverseId: string
	deploymentUniverseId: string
	poolQuestionId: string
	deploymentQuestionId: string
}

export function assertCanonicalPoolGraph(identity: PoolGraphIdentity) {
	requireGraphEdge(identity.poolFactory, identity.configuredFactory, `Pool ${identity.pool} security-pool-factory edge`)
	requireGraphEdge(identity.poolForker, identity.configuredForker, `Pool ${identity.pool} forker edge`)
	requireGraphEdge(identity.poolZoltar, identity.configuredZoltar, `Pool ${identity.pool} Zoltar edge`)
	requireGraphEdge(identity.poolQuestionData, identity.configuredQuestionData, `Pool ${identity.pool} question-data edge`)
	requireGraphEdge(identity.poolCoordinator, identity.deploymentCoordinator, `Pool ${identity.pool} coordinator edge`)
	requireGraphEdge(identity.coordinatorPool, identity.pool, `Coordinator ${identity.deploymentCoordinator} pool edge`)
	requireGraphEdge(identity.poolShareToken, identity.deploymentShareToken, `Pool ${identity.pool} share-token edge`)
	requireGraphEdge(identity.poolRepToken, identity.universeRepToken, `Pool ${identity.pool} REP edge`)
	requireGraphEdge(identity.poolTruthAuction, identity.deploymentTruthAuction, `Pool ${identity.pool} truth-auction edge`)
	if (identity.poolUniverseId !== identity.deploymentUniverseId || identity.poolQuestionId !== identity.deploymentQuestionId) {
		throw new Error(`Pool ${identity.pool} immutable question identity does not match its canonical factory deployment`)
	}
}

export interface PairGraphIdentity {
	pair: Address
	pairFactory: Address
	configuredFactory: Address
	pairPool: Address
	pool: Address
	pairShareToken: Address
	poolShareToken: Address
	pairUniverseId: string
	poolUniverseId: string
	pairQuestionId: string
	poolQuestionId: string
}

export function assertCanonicalPairGraph(identity: PairGraphIdentity) {
	requireGraphEdge(identity.pairFactory, identity.configuredFactory, `Pair ${identity.pair} factory edge`)
	requireGraphEdge(identity.pairPool, identity.pool, `Pair ${identity.pair} security-pool edge`)
	requireGraphEdge(identity.pairShareToken, identity.poolShareToken, `Pair ${identity.pair} share-token edge`)
	if (identity.pairUniverseId !== identity.poolUniverseId || identity.pairQuestionId !== identity.poolQuestionId) throw new Error(`Pair ${identity.pair} immutable question identity does not match pool ${identity.pool}`)
}

export function forkRepMigrationTarget(forkData: { auctionableAttoRepAtFork: bigint; ownFork: boolean }, status: { auctionableAttoRepAtFork: bigint; ownFork: boolean; vaultRepAtForkAttoRep: bigint }, pool: Address) {
	if (status.ownFork !== forkData.ownFork || status.auctionableAttoRepAtFork !== forkData.auctionableAttoRepAtFork) {
		throw new Error(`Pool ${pool} returned inconsistent fork migration buckets`)
	}
	return status.ownFork ? status.vaultRepAtForkAttoRep : status.auctionableAttoRepAtFork
}

async function authenticateConfiguredGraph(context: EcosystemDiscoveryContext, blockNumber: bigint) {
	const { client, deployments } = context
	const [forkerZoltar, tradingFactoryCode, tradingRouterCode] = await drainConcurrent([
		client.readContract({ abi: securityPoolForkerAbi, address: deployments.securityPoolForker, blockNumber, functionName: 'zoltar' }),
		context.allowMissingTradingDeployment ? client.getCode({ address: deployments.tradingFactory, blockNumber }) : Promise.resolve('deployed'),
		context.allowMissingTradingDeployment ? client.getCode({ address: deployments.tradingRouter, blockNumber }) : Promise.resolve('deployed'),
	])
	requireGraphEdge(getAddress(forkerZoltar), deployments.zoltar, 'SecurityPoolForker Zoltar edge')
	const factory = tradingFactoryCode !== undefined && tradingFactoryCode !== '0x'
	const router = tradingRouterCode !== undefined && tradingRouterCode !== '0x'
	if ((!factory || !router) && !context.allowMissingTradingDeployment) throw new Error('Configured trading factory and router must both have deployed code')
	if (router && !factory) throw new Error('Configured trading router exists without its factory')
	if (!factory) return { factory, router }
	const tradingSecurityPoolFactory = await client.readContract({ abi: tradingFactoryAbi, address: deployments.tradingFactory, blockNumber, functionName: 'securityPoolFactory' })
	requireGraphEdge(getAddress(tradingSecurityPoolFactory), deployments.securityPoolFactory, 'Trading factory security-pool-factory edge')
	if (router) {
		const routerFactory = await client.readContract({ abi: tradingRouterAbi, address: deployments.tradingRouter, blockNumber, functionName: 'factory' })
		requireGraphEdge(getAddress(routerFactory), deployments.tradingFactory, 'Trading router factory edge')
	}
	return { factory, router }
}

async function discoverGenesisUniswap(context: EcosystemDiscoveryContext, universes: readonly UniverseSnapshot[], blockNumber: bigint) {
	const genesisRep = universes.find(universe => universe.id === '0')?.repToken
	if (genesisRep === undefined) return { factory: false, initialized: false, liquidity: '0', proxy: false, seeder: false }
	const seeder = genesisUniswapSeederDeployment()
	const uniswapFactory = context.deployments.uniswapV3Factory ?? CANONICAL_UNISWAP_V3_FACTORY
	const [factoryCode, proxyCode, seederCode] = await drainConcurrent([context.client.getCode({ address: uniswapFactory, blockNumber }), context.client.getCode({ address: CANONICAL_PROXY_DEPLOYER, blockNumber }), context.client.getCode({ address: seeder.address, blockNumber })])
	if (proxyCode !== undefined && proxyCode !== '0x' && proxyCode.toLowerCase() !== CANONICAL_PROXY_DEPLOYER_RUNTIME) throw new Error('Canonical proxy deployer has unexpected runtime code')
	if (seederCode !== undefined && seederCode !== '0x' && seederCode.toLowerCase() !== seeder.runtime.toLowerCase()) throw new Error('Genesis Uniswap seeder has unexpected runtime code')
	const authenticatedSeeder = seederCode !== undefined && seederCode !== '0x'
	const authenticatedProxy = proxyCode !== undefined && proxyCode !== '0x'
	const factory = factoryCode !== undefined && factoryCode !== '0x'
	if (!factory) return { factory, initialized: false, liquidity: '0', proxy: authenticatedProxy, seeder: authenticatedSeeder }
	const pool = getAddress(await context.client.readContract({ abi: uniswapV3FactoryAbi, address: uniswapFactory, args: [genesisRep, context.deployments.weth, GENESIS_UNISWAP_FEE], blockNumber, functionName: 'getPool' }))
	if (pool === zeroAddress) return { factory, initialized: false, liquidity: '0', proxy: authenticatedProxy, seeder: authenticatedSeeder }
	const [poolFactory, token0, token1, fee, slot0, liquidity] = await drainConcurrent([
		context.client.readContract({ abi: uniswapV3PoolAbi, address: pool, blockNumber, functionName: 'factory' }),
		context.client.readContract({ abi: uniswapV3PoolAbi, address: pool, blockNumber, functionName: 'token0' }),
		context.client.readContract({ abi: uniswapV3PoolAbi, address: pool, blockNumber, functionName: 'token1' }),
		context.client.readContract({ abi: uniswapV3PoolAbi, address: pool, blockNumber, functionName: 'fee' }),
		context.client.readContract({ abi: uniswapV3PoolAbi, address: pool, blockNumber, functionName: 'slot0' }),
		context.client.readContract({ abi: uniswapV3PoolAbi, address: pool, blockNumber, functionName: 'liquidity' }),
	])
	requireGraphEdge(getAddress(poolFactory), uniswapFactory, `Genesis Uniswap pool ${pool} factory edge`)
	const expected = [genesisRep.toLowerCase(), context.deployments.weth.toLowerCase()].sort()
	const actual = [getAddress(token0).toLowerCase(), getAddress(token1).toLowerCase()].sort()
	if (actual[0] !== expected[0] || actual[1] !== expected[1] || fee !== BigInt(GENESIS_UNISWAP_FEE)) throw new Error(`Genesis Uniswap pool ${pool} has unexpected immutable token or fee bindings`)
	return { factory, initialized: slot0[0] !== 0n, liquidity: liquidity.toString(), pool, proxy: authenticatedProxy, seeder: authenticatedSeeder }
}

function fixedPointPower(value: bigint, exponent: bigint) {
	const precision = 10n ** 18n
	let result = exponent % 2n === 0n ? precision : value
	let base = value
	for (let remaining = exponent / 2n; remaining !== 0n; remaining /= 2n) {
		base = (base * base) / precision
		if (remaining % 2n !== 0n) result = (result * base) / precision
	}
	return result
}

function projectSettlementCollateral(
	accounting: {
		settlementCollateralAttoEth: bigint
		feeEligibleCapacityOwnershipAttoRep: bigint
		feeIndexRemainder: bigint
		totalFeesOwedRemainder: bigint
		lastUpdatedFeeAccumulator: bigint
		currentRetentionRate: bigint
	},
	feeEndTimestamp: bigint | undefined,
	anchorTimestamp: bigint,
) {
	if (feeEndTimestamp === undefined) return 0n
	const clamped = anchorTimestamp < feeEndTimestamp ? anchorTimestamp : feeEndTimestamp
	if (accounting.lastUpdatedFeeAccumulator >= clamped || accounting.feeEligibleCapacityOwnershipAttoRep === 0n) return accounting.settlementCollateralAttoEth
	const timeDelta = clamped - accounting.lastUpdatedFeeAccumulator
	const resultingCollateral = (accounting.settlementCollateralAttoEth * fixedPointPower(accounting.currentRetentionRate, timeDelta)) / 10n ** 18n
	const scaledFeeDelta = (accounting.settlementCollateralAttoEth - resultingCollateral) * 10n ** 18n + accounting.feeIndexRemainder
	const feeIndexDelta = scaledFeeDelta / accounting.feeEligibleCapacityOwnershipAttoRep
	const feesOwedDelta = feeIndexDelta * accounting.feeEligibleCapacityOwnershipAttoRep + accounting.totalFeesOwedRemainder
	const creditedFees = feesOwedDelta / 10n ** 18n
	return creditedFees > accounting.settlementCollateralAttoEth ? 0n : accounting.settlementCollateralAttoEth - creditedFees
}

function resultingVaultBackingAfterDeposit(deposit: bigint, vaultBackingUnits: bigint, totalBackingUnits: bigint, poolRepBalance: bigint) {
	const addedBackingUnits = totalBackingUnits === 0n || poolRepBalance === 0n ? deposit * 10n ** 18n : (deposit * totalBackingUnits) / poolRepBalance
	const nextTotalBackingUnits = totalBackingUnits + addedBackingUnits
	if (nextTotalBackingUnits === 0n) return 0n
	return ((vaultBackingUnits + addedBackingUnits) * (poolRepBalance + deposit)) / nextTotalBackingUnits
}

export function minimumSafeVaultDeposit(minimumBacking: bigint, vaultBackingUnits: bigint, totalBackingUnits: bigint, poolRepBalance: bigint) {
	let lower = minimumBacking > 0n ? minimumBacking : 1n
	let upper = lower
	while (resultingVaultBackingAfterDeposit(upper, vaultBackingUnits, totalBackingUnits, poolRepBalance) < minimumBacking) {
		if (upper > ((1n << 256n) - 1n) / 2n) throw new Error('No representable REP deposit satisfies the vault minimum')
		upper *= 2n
	}
	while (lower < upper) {
		const middle = lower + (upper - lower) / 2n
		if (resultingVaultBackingAfterDeposit(middle, vaultBackingUnits, totalBackingUnits, poolRepBalance) >= minimumBacking) upper = middle
		else lower = middle + 1n
	}
	return lower
}

export function relevantTokenSpenders(deployments: EcosystemDeployments, pools: readonly PoolSnapshot[], token: Address): Address[] {
	const spenders = new Map<string, Address>()
	if (deployments.uniswapV3Factory !== undefined) {
		const genesisSeeder = genesisUniswapSeederDeployment().address
		spenders.set(genesisSeeder.toLowerCase(), genesisSeeder)
	}
	spenders.set(deployments.zoltar.toLowerCase(), deployments.zoltar)
	spenders.set(deployments.openOracle.toLowerCase(), deployments.openOracle)
	for (const pool of pools) {
		if (!sameAddress(token, deployments.weth) && !sameAddress(token, pool.repToken)) continue
		spenders.set(pool.coordinator.toLowerCase(), pool.coordinator)
		if (sameAddress(token, pool.repToken)) {
			spenders.set(pool.address.toLowerCase(), pool.address)
			if (pool.escalationGame !== zeroAddress) spenders.set(pool.escalationGame.toLowerCase(), pool.escalationGame)
		}
	}
	return [...spenders.values()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))
}

function emptyDirectEscalationDepositQuote(): PoolSnapshot['directEscalationDepositQuotes'][number] {
	return {
		acceptedAmountAttoRep: canonicalUintString(0n),
		maximumDepositAttoRep: canonicalUintString(0n),
		mutationExpectedSuccess: false,
		resultingCumulativeAmountAttoRep: canonicalUintString(0n),
	}
}

export async function discoverDirectEscalationDepositQuotes(
	client: ChaosReadClient,
	wallet: Address,
	escalationGame: Address,
	requestedAmountAttoRep: bigint,
	outcomeBalancesAttoRep: readonly [bigint, bigint, bigint],
	nonDecisionThresholdAttoRep: bigint,
	blockNumber: bigint,
): Promise<PoolSnapshot['directEscalationDepositQuotes']> {
	const quotes: PoolSnapshot['directEscalationDepositQuotes'] = [emptyDirectEscalationDepositQuote(), emptyDirectEscalationDepositQuote(), emptyDirectEscalationDepositQuote()]
	if (requestedAmountAttoRep === 0n) return quotes
	await drainConcurrent(
		[0, 1, 2].map(async outcome => {
			let preview: readonly [bigint, bigint]
			try {
				preview = await client.readContract({ abi: escalationGameAbi, address: escalationGame, args: [outcome, requestedAmountAttoRep], blockNumber, functionName: 'previewDepositOnOutcome' })
			} catch (error) {
				if (!contractSimulationReverted(error)) throw error
				return
			}
			const [acceptedAmountAttoRep, resultingCumulativeAmountAttoRep] = preview
			const currentBalanceAttoRep = outcomeBalancesAttoRep[outcome]
			if (currentBalanceAttoRep === undefined) throw new Error(`Escalation outcome ${outcome.toString()} is missing its anchored balance`)
			if (acceptedAmountAttoRep === 0n || acceptedAmountAttoRep > requestedAmountAttoRep || resultingCumulativeAmountAttoRep !== currentBalanceAttoRep + acceptedAmountAttoRep) {
				throw new Error(`Escalation game ${escalationGame} returned an invalid direct-deposit preview for outcome ${outcome.toString()}`)
			}
			// Only a full start-bond deposit that exactly reaches the threshold is safe to
			// authorize. Any intervening deposit on this outcome necessarily fills the
			// remaining start-bond room, so this call reverts instead of allowing a smaller
			// threshold-fill transfer and leaving residual allowance.
			if (acceptedAmountAttoRep !== requestedAmountAttoRep || resultingCumulativeAmountAttoRep !== nonDecisionThresholdAttoRep) return
			let mutationExpectedSuccess = false
			try {
				await client.simulateContract({ abi: escalationGameAbi, account: wallet, address: escalationGame, args: [outcome, acceptedAmountAttoRep], blockNumber, functionName: 'depositRepOnOutcome' })
				mutationExpectedSuccess = true
			} catch (error) {
				if (!contractSimulationReverted(error)) throw error
				// A missing allowance is expected before the workflow's approval step.
			}
			quotes[outcome] = {
				acceptedAmountAttoRep: acceptedAmountAttoRep.toString(),
				maximumDepositAttoRep: requestedAmountAttoRep.toString(),
				mutationExpectedSuccess,
				resultingCumulativeAmountAttoRep: resultingCumulativeAmountAttoRep.toString(),
			}
		}),
	)
	return quotes
}

async function discoverUniverses(context: EcosystemDiscoveryContext, blockNumber: bigint, limits: DiscoveryLimits, topology: ImmutableTopologyData, mutation: TopologyMutationState, warnings: string[]) {
	const { client, deployments, wallet } = context
	const queue = [0n]
	const queuedIds = new Set<string>(['0'])
	const seen = new Set<string>()
	const retainedUniverseIds = new Set<string>(['0'])
	const universes: UniverseSnapshot[] = []
	let truncated = false
	const cachedUniverseIds = new Set<string>(['0'])
	for (const [universeId, children] of Object.entries(topology.universeChildren)) {
		cachedUniverseIds.add(universeId)
		for (const childId of children.childUniverseIds) cachedUniverseIds.add(childId)
	}
	if (cachedUniverseIds.size > limits.maxUniverses) {
		topology.universeChildren = {}
		mutation.changed = true
	}
	const forkBurnDivisor = await client.readContract({ abi: zoltarAbi, address: deployments.zoltar, blockNumber, functionName: 'forkBurnDivisor' })
	const migrationProgressByUniverse = new Map<string, MigrationRepSplitProgressSnapshot[]>()
	for (const progress of context.indexedMigrationRepSplits ?? []) {
		const routes = migrationProgressByUniverse.get(progress.universeId) ?? []
		routes.push(progress)
		migrationProgressByUniverse.set(progress.universeId, routes)
	}
	for (const routes of migrationProgressByUniverse.values()) routes.sort((left, right) => compareUnsignedStrings(left.outcomeIndex, right.outcomeIndex))
	for (let queueIndex = 0; queueIndex < queue.length; queueIndex += 1) {
		const universeId = queue[queueIndex]
		if (universeId === undefined) throw new Error('Universe traversal lost its current entry')
		queuedIds.delete(universeId.toString())
		if (seen.has(universeId.toString())) continue
		seen.add(universeId.toString())
		const [raw, threshold, nonDecisionThreshold, migration] = await drainConcurrent([
			client.readContract({ abi: zoltarAbi, address: deployments.zoltar, args: [universeId], blockNumber, functionName: 'universes' }),
			client.readContract({ abi: zoltarAbi, address: deployments.zoltar, args: [universeId], blockNumber, functionName: 'getForkThresholdAttoRep' }),
			client.readContract({ abi: zoltarAbi, address: deployments.zoltar, args: [universeId], blockNumber, functionName: 'getNonDecisionThresholdAttoRep' }),
			client.readContract({ abi: zoltarAbi, address: deployments.zoltar, args: [wallet, universeId], blockNumber, functionName: 'getMigrationRepBalanceAttoRep' }),
		])
		const [forkTime, forkQuestionId, forkingOutcomeIndex, reputationToken, parentUniverseId] = raw
		if (reputationToken === zeroAddress) throw new Error(`Universe ${universeId.toString()} has no REP token`)
		const theoreticalSupply = await client.readContract({ abi: erc20Abi, address: reputationToken, blockNumber, functionName: 'getTotalTheoreticalSupplyAttoRep' })
		const supplyBasedDeposit = theoreticalSupply / 10_000_000n
		const initialEscalationDeposit = supplyBasedDeposit < 10n ** 18n ? 10n ** 18n : supplyBasedDeposit
		const cachedChildren = topology.universeChildren[universeId.toString()]
		const outcomes = (cachedChildren?.outcomeIndexes ?? []).map(outcome => BigInt(outcome))
		const childIds = (cachedChildren?.childUniverseIds ?? []).map(childId => BigInt(childId))
		if (outcomes.length !== childIds.length) throw new Error(`Universe ${universeId.toString()} immutable child cache has mismatched arrays`)
		for (const childId of childIds) {
			if (retainedUniverseIds.size >= limits.maxUniverses && !retainedUniverseIds.has(childId.toString())) {
				truncated = true
				break
			}
			retainedUniverseIds.add(childId.toString())
		}
		if (!truncated) {
			for (let start = BigInt(outcomes.length); ; ) {
				const remainingSlots = limits.maxUniverses - retainedUniverseIds.size
				const requestedPageSize = BigInt(Math.max(1, Math.min(limits.maxUniverses, remainingSlots + 1)))
				const [pageOutcomes, pageChildIds, pageChildren] = await client.readContract({ abi: zoltarAbi, address: deployments.zoltar, args: [universeId, start, requestedPageSize], blockNumber, functionName: 'getDeployedChildUniverses' })
				if (pageOutcomes.length !== pageChildIds.length || pageOutcomes.length !== pageChildren.length) throw new Error(`Universe ${universeId.toString()} returned mismatched child arrays`)
				if (BigInt(pageOutcomes.length) > requestedPageSize) throw new Error(`Universe ${universeId.toString()} exceeded the requested child page size`)
				const accepted = Math.min(pageOutcomes.length, remainingSlots)
				for (let index = 0; index < accepted; index += 1) {
					const outcome = pageOutcomes[index]
					const childId = pageChildIds[index]
					if (outcome === undefined || childId === undefined) throw new Error(`Universe ${universeId.toString()} omitted a retained child route`)
					outcomes.push(outcome)
					childIds.push(childId)
					retainedUniverseIds.add(childId.toString())
				}
				if (accepted > 0) mutation.changed = true
				if (accepted < pageOutcomes.length) {
					truncated = true
					break
				}
				if (BigInt(pageOutcomes.length) < requestedPageSize) break
				start += BigInt(pageOutcomes.length)
			}
		}
		if (new Set(outcomes.map(outcome => outcome.toString())).size !== outcomes.length || new Set(childIds.map(childId => childId.toString())).size !== childIds.length) {
			throw new Error(`Universe ${universeId.toString()} returned duplicate immutable child routes`)
		}
		topology.universeChildren[universeId.toString()] = {
			childUniverseIds: childIds.map(childId => childId.toString()),
			outcomeIndexes: outcomes.map(outcome => outcome.toString()),
		}
		for (const childId of childIds) {
			const childKey = childId.toString()
			if (!seen.has(childKey) && !queuedIds.has(childKey)) {
				queue.push(childId)
				queuedIds.add(childKey)
			}
		}
		const snapshot: UniverseSnapshot = {
			forkBurnDivisor: forkBurnDivisor.toString(),
			forkQuestionId: forkQuestionId.toString(),
			forkThresholdAttoRep: threshold.toString(),
			forkTime: forkTime.toString(),
			id: universeId.toString(),
			initialEscalationDepositAttoRep: initialEscalationDeposit.toString(),
			knownChildOutcomes: outcomes.map(outcome => outcome.toString()),
			migrationBalance: migration.toString(),
			migrationRepSplitProgressByOutcome: Object.fromEntries((migrationProgressByUniverse.get(universeId.toString()) ?? []).map(progress => [progress.outcomeIndex, progress.childMigrationRepAmountAttoRep])),
			nonDecisionThresholdAttoRep: nonDecisionThreshold.toString(),
			repToken: getAddress(reputationToken),
		}
		if (universeId !== 0n) {
			snapshot.forkingOutcomeIndex = forkingOutcomeIndex.toString()
			snapshot.parentUniverseId = parentUniverseId.toString()
		}
		universes.push(snapshot)
	}
	if (truncated) warnings.push(`Universe discovery truncated at ${universes.length.toString()} retained universes because the configured resident limit is ${limits.maxUniverses.toString()}`)
	return universes
}

async function discoverQuestions(context: EcosystemDiscoveryContext, blockNumber: bigint, limits: DiscoveryLimits, topology: ImmutableTopologyData, mutation: TopologyMutationState, warnings: string[]) {
	const { client, deployments } = context
	const count = await client.readContract({ abi: questionDataAbi, address: deployments.questionData, blockNumber, functionName: 'getQuestionCount' })
	let cursor = topology.discoveryCursors.questions
	assertRegistryCountNotRegressed(cursor, count, 'Question registry')
	let retentionMode: CountedRegistryCursor['retentionMode'] = count <= BigInt(limits.maxQuestions) ? 'resident' : 'overflow'
	if (cursor.retentionMode === 'overflow' && retentionMode === 'resident' && BigInt(cursor.residentLimit) >= BigInt(limits.maxQuestions)) retentionMode = 'overflow'
	if (cursor.retentionMode === 'overflow' && retentionMode === 'resident') {
		cursor = emptyCountedRegistryCursor()
		topology.questions = []
		mutation.changed = true
	}
	if (retentionMode === 'overflow' && topology.questions.length > 0) {
		topology.questions = []
		mutation.changed = true
	}
	const canonicalCursor = cursorWithCanonicalCount(cursor, count, limits.maxQuestions, retentionMode)
	if (!sameRegistryCursor(cursor, canonicalCursor)) mutation.changed = true
	cursor = canonicalCursor
	if (cursor.retentionMode === 'resident' && BigInt(topology.questions.length) !== BigInt(cursor.nextIndex)) throw new Error('Question registry cursor does not match its retained canonical prefix')
	const collected = await collectCountedPages({
		count,
		label: 'Question discovery',
		maximumItems: limits.maxQuestions,
		pageSize: limits.maxQuestions,
		readPage: async (start, pageCount) => await client.readContract({ abi: questionDataAbi, address: deployments.questionData, args: [start, pageCount], blockNumber, functionName: 'getQuestions' }),
		start: BigInt(cursor.nextIndex),
	})
	if (collected.values.length > 0) {
		cursor = {
			...cursor,
			commitment: updateRegistryCommitment(
				cursor.commitment,
				BigInt(cursor.nextIndex),
				collected.values.map(questionId => questionId.toString()),
			),
			nextIndex: collected.nextStart.toString(),
		}
		mutation.changed = true
	}
	if (cursor.retentionMode === 'resident' && collected.values.length > 0) {
		let residentBytes = topology.questions.reduce((total, question) => total + Buffer.byteLength(JSON.stringify(question), 'utf8'), 0)
		let residentItems = topology.questions.reduce((total, question) => total + 1 + question.outcomeLabels.length, 0)
		let overflowed = false
		const discovered = await mapWithConcurrency(collected.values, DISCOVERY_RPC_CONCURRENCY, async questionId => {
			if (overflowed) return undefined
			const [question, createdAt, labels] = await drainConcurrent([
				client.readContract({ abi: questionDataAbi, address: deployments.questionData, args: [questionId], blockNumber, functionName: 'questions' }),
				client.readContract({ abi: questionDataAbi, address: deployments.questionData, args: [questionId], blockNumber, functionName: 'questionCreatedTimestamp' }),
				discoverOutcomeLabels(client, deployments.questionData, questionId, blockNumber, limits),
			])
			const [, , startTime, endTime, numTicks] = question
			let kind: QuestionSnapshot['kind'] = 'categorical'
			if (labels.length === 0) kind = 'scalar'
			else if (labels.length === 2 && labels[0] === 'Yes' && labels[1] === 'No') kind = 'binary'
			const snapshot: QuestionSnapshot = {
				createdAt: createdAt.toString(),
				endTime: endTime.toString(),
				id: questionId.toString(),
				kind,
				numTicks: numTicks.toString(),
				outcomeLabels: [...labels],
				startTime: startTime.toString(),
			}
			const snapshotBytes = Buffer.byteLength(JSON.stringify(snapshot), 'utf8')
			residentBytes += snapshotBytes
			residentItems += 1 + snapshot.outcomeLabels.length
			if (snapshotBytes > IMMUTABLE_TOPOLOGY_MAXIMUM_RECORD_BYTES || residentBytes > DISCOVERY_QUESTION_RESIDENT_UTF8_BYTES || residentItems > DISCOVERY_AGGREGATE_ITEM_LIMIT) {
				overflowed = true
				return undefined
			}
			return snapshot
		})
		if (overflowed) {
			topology.questions = []
			cursor = { ...cursor, retentionMode: 'overflow' }
		} else {
			for (const question of discovered) {
				if (question === undefined) throw new Error('Question discovery omitted a retained result without exceeding its resident envelope')
				topology.questions.push({ ...question, outcomeLabels: [...question.outcomeLabels] })
			}
		}
	}
	topology.discoveryCursors.questions = cursor
	if (cursor.retentionMode === 'overflow' || !collected.complete) warnings.push(registryCatchUpWarning('Question', cursor))
	if (cursor.retentionMode === 'overflow') return []
	if (!collected.complete || BigInt(topology.questions.length) !== count) throw new Error('Resident question registry did not reach its canonical count within the configured envelope')
	if (new Set(topology.questions.map(question => question.id)).size !== topology.questions.length) throw new Error('Question registry contains duplicate immutable question IDs')
	return topology.questions.map(question => ({ ...question, outcomeLabels: [...question.outcomeLabels] }))
}

async function discoverVault(client: ChaosReadClient, pool: Address, escalationGame: Address, vault: Address, blockNumber: bigint): Promise<VaultSnapshot> {
	const [state, openInterest, badDebt] = await drainConcurrent([
		client.readContract({ abi: securityPoolAbi, address: pool, args: [vault], blockNumber, functionName: 'securityVaults' }),
		client.readContract({ abi: securityPoolAbi, address: pool, args: [vault], blockNumber, functionName: 'getVaultOpenInterestAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address: pool, args: [vault], blockNumber, functionName: 'vaultBadDebtAttoEth' }),
	])
	const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth, feeIndex] = state
	const [repBackingAttoRep, disputeStakedAttoRep] = await drainConcurrent([
		client.readContract({ abi: securityPoolAbi, address: pool, args: [repBackingUnits], blockNumber, functionName: 'backingUnitsToAttoRep' }),
		escalationGame === zeroAddress ? Promise.resolve(0n) : client.readContract({ abi: escalationGameAbi, address: escalationGame, args: [vault], blockNumber, functionName: 'disputeStakedRepByVaultAttoRep' }),
	])
	return {
		address: vault,
		badDebtAttoEth: badDebt.toString(),
		capacityOwnershipAttoRep: capacityOwnershipAttoRep.toString(),
		claimableFeesAttoEth: claimableFeesAttoEth.toString(),
		feeIndex: feeIndex.toString(),
		disputeStakedAttoRep: disputeStakedAttoRep.toString(),
		openInterestAttoEth: openInterest.toString(),
		repBackingAttoRep: repBackingAttoRep.toString(),
		repBackingUnits: repBackingUnits.toString(),
	}
}

export async function discoverStagedOperations(client: ChaosReadClient, pool: PoolSnapshot, blockNumber: bigint, limit: number, warnings: string[]) {
	const count = await client.readContract({ abi: coordinatorAbi, address: pool.coordinator, blockNumber, functionName: 'getActiveStagedOperationCount' })
	if (count > BigInt(limit)) {
		warnings.push(`Staged-operation discovery truncated for ${pool.coordinator}: exact canonical total ${count.toString()} exceeds the configured ${limit.toString()}-entry resident limit`)
		return []
	}
	const pendingIds = await client.readContract({ abi: coordinatorAbi, address: pool.coordinator, blockNumber, functionName: 'getPendingSettlementOperationIds' })
	const collected = await collectCountedPages({
		count,
		label: `Staged-operation discovery for ${pool.coordinator}`,
		maximumItems: limit,
		pageSize: limit,
		readPage: async (start, pageCount) => {
			const [ids, operations] = await client.readContract({ abi: coordinatorAbi, address: pool.coordinator, args: [start, pageCount], blockNumber, functionName: 'getActiveStagedOperations' })
			if (ids.length !== operations.length) throw new Error(`Coordinator ${pool.coordinator} returned mismatched staged-operation arrays`)
			return ids.map((id, index) => {
				const operation = operations[index]
				if (operation === undefined) throw new Error(`Coordinator ${pool.coordinator} omitted staged operation ${id.toString()}`)
				return { id, operation }
			})
		},
		start: 0n,
	})
	const entries = collected.values
	if (entries.length === 0) return []
	const pending = new Set(pendingIds.map(id => id.toString()))
	let liquidationConfiguration: Promise<readonly [bigint, Address]> | undefined
	const getLiquidationConfiguration = () => {
		liquidationConfiguration ??= drainConcurrent([
			client.readContract({ abi: coordinatorAbi, address: pool.coordinator, blockNumber, functionName: 'minLiquidationPriceDistanceBps' }),
			client.readContract({ abi: coordinatorAbi, address: pool.coordinator, blockNumber, functionName: 'liquidationApprovalRegistry' }).then(getAddress),
		])
		return liquidationConfiguration
	}
	return await mapWithConcurrency(entries, DISCOVERY_RPC_CONCURRENCY, async ({ id, operation }): Promise<StagedOperationSnapshot> => {
		const operationType = bigintToSafeNumber(operation.operation)
		let executionExpectedSuccess = false
		let executionExpectedResult: Hex = '0x'
		let liquidationMinimumReceiverHealthFactorBps = 0n
		let liquidationMinPriceDistanceBps = 0n
		if (operationType === 0) {
			try {
				const [minLiquidationPriceDistanceBps, registry] = await getLiquidationConfiguration()
				const hasApproval = operation.liquidationApprovalId.toLowerCase() !== zeroHash
				let minimumReceiverHealthFactorBps = 10_000n
				if (hasApproval) {
					if (sameAddress(operation.receiverVault, operation.operator)) throw stagedRouteIneligible('Delegated liquidation receiver is its operator')
					const [registryCoordinator, reservation, approval] = await drainConcurrent([
						client.readContract({ abi: liquidationApprovalRegistryAbi, address: registry, blockNumber, functionName: 'coordinator' }).then(getAddress),
						client.readContract({ abi: liquidationApprovalRegistryAbi, address: registry, args: [id], blockNumber, functionName: 'liquidationReservations' }),
						client.readContract({ abi: liquidationApprovalRegistryAbi, address: registry, args: [operation.liquidationApprovalId], blockNumber, functionName: 'getLiquidationApproval' }),
					])
					if (!sameAddress(registryCoordinator, pool.coordinator)) throw stagedRouteIneligible('Liquidation registry coordinator does not match the staged coordinator')
					if (reservation.approvalId.toLowerCase() !== operation.liquidationApprovalId.toLowerCase()) throw stagedRouteIneligible('Liquidation reservation approval does not match the staged route')
					if (reservation.reservedDebtAttoEth !== operation.reservedLiquidationDebtAttoEth || reservation.reservedDebtAttoEth === 0n) throw stagedRouteIneligible('Liquidation reservation amount does not match the staged route')
					if (reservation.settled) throw stagedRouteIneligible('Liquidation reservation is already settled')
					const params = approval.params
					if (!sameAddress(params.securityPool, pool.address) || !sameAddress(params.receiverVault, operation.receiverVault) || !sameAddress(params.operator, operation.operator)) {
						throw stagedRouteIneligible('Liquidation approval roles do not match the staged route')
					}
					if (params.targetVault !== zeroAddress && !sameAddress(params.targetVault, operation.targetVault)) throw stagedRouteIneligible('Liquidation approval target does not match the staged route')
					if (params.minPostLiquidationHealthFactorBps < 10_000n) throw stagedRouteIneligible('Liquidation approval health factor is below the protocol minimum')
					if (approval.reservedDebtAttoEth < reservation.reservedDebtAttoEth) throw stagedRouteIneligible('Liquidation approval aggregate reservation is below the operation reservation')
					minimumReceiverHealthFactorBps = params.minPostLiquidationHealthFactorBps
				} else {
					if (operation.reservedLiquidationDebtAttoEth !== 0n) throw stagedRouteIneligible('Direct liquidation has a delegated reservation')
					if (!sameAddress(operation.receiverVault, operation.operator)) throw stagedRouteIneligible('Direct liquidation receiver is not its operator')
				}
				if (sameAddress(operation.receiverVault, operation.targetVault)) throw stagedRouteIneligible('Liquidation receiver is its target')
				liquidationMinimumReceiverHealthFactorBps = minimumReceiverHealthFactorBps
				liquidationMinPriceDistanceBps = minLiquidationPriceDistanceBps
				const simulation = await client.simulateContract({
					account: pool.coordinator,
					abi: securityPoolAbi,
					address: pool.address,
					args: [
						{
							minLiquidationPriceDistanceBps,
							minimumReceiverHealthFactorBps,
							operationId: id,
							operator: operation.operator,
							receiverVault: operation.receiverVault,
							requestedDebtAttoEth: hasApproval ? operation.reservedLiquidationDebtAttoEth : operation.operationAmountAttoRepOrAttoEth,
							snapshot: {
								targetBackingUnits: operation.snapshotTargetBackingUnits,
								targetCapacityOwnershipAttoRep: operation.snapshotTargetCapacityOwnershipAttoRep,
								totalPoolHeldAttoRep: operation.snapshotTotalPoolHeldAttoRep,
								totalRepBackingUnits: operation.snapshotTotalRepBackingUnits,
							},
							targetVault: operation.targetVault,
						},
					],
					blockNumber,
					functionName: 'performLiquidation',
				})
				executionExpectedResult = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], simulation.result)
				executionExpectedSuccess = true
			} catch (error) {
				if (!isStagedRouteIneligible(error) && !contractSimulationReverted(error)) throw error
				// The exact liquidation snapshot, registry reservation, or current
				// accounting no longer satisfies the pool. Execution must fail closed.
			}
		} else if (operationType === 1) {
			try {
				if (!sameAddress(operation.operator, operation.receiverVault) || !sameAddress(operation.operator, operation.targetVault)) throw stagedRouteIneligible('Staged withdrawal is not an exact self route')
				if (operation.liquidationApprovalId.toLowerCase() !== zeroHash || operation.reservedLiquidationDebtAttoEth !== 0n) throw stagedRouteIneligible('Staged withdrawal carries liquidation approval state')
				await client.simulateContract({
					account: pool.coordinator,
					abi: securityPoolAbi,
					address: pool.address,
					args: [operation.operator, operation.operationAmountAttoRepOrAttoEth],
					blockNumber,
					functionName: 'withdrawRepFromVault',
				})
				executionExpectedSuccess = true
			} catch (error) {
				if (!isStagedRouteIneligible(error) && !contractSimulationReverted(error)) throw error
				// The coordinator catches downstream reverts and emits success=false. A
				// direct anchored simulation is therefore required before execution.
			}
		}
		return {
			amount: operation.operationAmountAttoRepOrAttoEth.toString(),
			coordinator: pool.coordinator,
			executionExpectedResult,
			executionExpectedSuccess,
			id: id.toString(),
			isPendingSettlement: pending.has(id.toString()),
			liquidationApprovalId: operation.liquidationApprovalId,
			liquidationMinimumReceiverHealthFactorBps: liquidationMinimumReceiverHealthFactorBps.toString(),
			liquidationMinPriceDistanceBps: liquidationMinPriceDistanceBps.toString(),
			operation: operationType,
			operator: getAddress(operation.operator),
			queuedAt: operation.queuedAt.toString(),
			receiverVault: getAddress(operation.receiverVault),
			reservedLiquidationDebtAttoEth: operation.reservedLiquidationDebtAttoEth.toString(),
			snapshotTargetBackingUnits: operation.snapshotTargetBackingUnits.toString(),
			snapshotTargetCapacityOwnershipAttoRep: operation.snapshotTargetCapacityOwnershipAttoRep.toString(),
			snapshotTargetDisputeStakedAttoRep: operation.snapshotTargetDisputeStakedAttoRep.toString(),
			snapshotTargetOpenInterestAttoEth: operation.snapshotTargetOpenInterestAttoEth.toString(),
			snapshotTotalPoolHeldAttoRep: operation.snapshotTotalPoolHeldAttoRep.toString(),
			snapshotTotalRepBackingUnits: operation.snapshotTotalRepBackingUnits.toString(),
			targetVault: getAddress(operation.targetVault),
			validForSeconds: operation.validForSeconds.toString(),
		}
	})
}

function cachePoolDeployment(deployment: { parent: Address; priceOracleManagerAndOperatorQueuer: Address; questionId: bigint; securityPool: Address; shareToken: Address; truthAuction: Address; universeId: bigint }): CachedPoolDeployment {
	return {
		coordinator: getAddress(deployment.priceOracleManagerAndOperatorQueuer),
		parent: getAddress(deployment.parent),
		questionId: deployment.questionId.toString(),
		securityPool: getAddress(deployment.securityPool),
		shareToken: getAddress(deployment.shareToken),
		truthAuction: getAddress(deployment.truthAuction),
		universeId: deployment.universeId.toString(),
	}
}

async function discoverPools(
	context: EcosystemDiscoveryContext,
	blockNumber: bigint,
	anchorTimestamp: bigint,
	anchorBaseFeePerGas: bigint,
	limits: DiscoveryLimits,
	warnings: string[],
	universes: readonly UniverseSnapshot[],
	questions: readonly QuestionSnapshot[],
	topology: ImmutableTopologyData,
	mutation: TopologyMutationState,
) {
	const { client, deployments, wallet } = context
	const universeById = new Map(universes.map(universe => [universe.id, universe]))
	const questionById = new Map(questions.map(question => [question.id, question]))
	const childProgressByPool = new Map<string, ChildRepSplitProgressSnapshot[]>()
	for (const progress of context.indexedChildRepSplits ?? []) {
		const key = progress.pool.toLowerCase()
		const routes = childProgressByPool.get(key) ?? []
		routes.push(progress)
		childProgressByPool.set(key, routes)
	}
	for (const routes of childProgressByPool.values()) routes.sort((left, right) => compareUnsignedStrings(left.outcomeIndex, right.outcomeIndex))
	const count = await client.readContract({ abi: securityPoolFactoryAbi, address: deployments.securityPoolFactory, blockNumber, functionName: 'securityPoolDeploymentCount' })
	const questionCursor = topology.discoveryCursors.questions
	const dependenciesComplete = questionCursor.retentionMode === 'resident' && questionCursor.nextIndex === questionCursor.canonicalCount && !warnings.some(warning => /Universe discovery.*truncated/i.test(warning))
	let cursor = topology.discoveryCursors.poolDeployments
	assertRegistryCountNotRegressed(cursor, count, 'Security-pool registry')
	const retentionMode: CountedRegistryCursor['retentionMode'] = count <= BigInt(limits.maxPools) && dependenciesComplete ? 'resident' : 'overflow'
	if (cursor.retentionMode === 'overflow' && retentionMode === 'resident') {
		cursor = emptyCountedRegistryCursor()
		topology.poolDeployments = []
		mutation.changed = true
	}
	if (retentionMode === 'overflow') {
		if (topology.poolDeployments.length > 0 || Object.keys(topology.pairsByPool).length > 0 || Object.keys(topology.vaultsByPool).length > 0 || Object.keys(topology.discoveryCursors.vaultsByPool).length > 0) mutation.changed = true
		topology.poolDeployments = []
		topology.pairsByPool = {}
		topology.vaultsByPool = {}
		topology.discoveryCursors.vaultsByPool = {}
	}
	const canonicalCursor = cursorWithCanonicalCount(cursor, count, limits.maxPools, retentionMode)
	if (!sameRegistryCursor(cursor, canonicalCursor)) mutation.changed = true
	cursor = canonicalCursor
	if (cursor.retentionMode === 'resident' && BigInt(topology.poolDeployments.length) !== BigInt(cursor.nextIndex)) throw new Error('Security-pool registry cursor does not match its retained canonical prefix')
	const collectedDeployments = await collectCountedPages({
		count,
		label: 'Pool discovery',
		maximumItems: limits.maxPools,
		pageSize: limits.maxPools,
		readPage: async (start, pageCount) => await client.readContract({ abi: securityPoolFactoryAbi, address: deployments.securityPoolFactory, args: [start, pageCount], blockNumber, functionName: 'securityPoolDeploymentsRange' }),
		start: BigInt(cursor.nextIndex),
	})
	const newDeployments = collectedDeployments.values
	if (newDeployments.length > 0) {
		cursor = {
			...cursor,
			commitment: updateRegistryCommitment(
				cursor.commitment,
				BigInt(cursor.nextIndex),
				newDeployments.map(deployment => JSON.stringify(cachePoolDeployment(deployment))),
			),
			nextIndex: collectedDeployments.nextStart.toString(),
		}
		mutation.changed = true
	}
	topology.discoveryCursors.poolDeployments = cursor
	if (cursor.retentionMode === 'overflow' || !collectedDeployments.complete) {
		warnings.push(dependenciesComplete ? registryCatchUpWarning('Pool', cursor) : `Pool discovery truncated while prerequisite question or universe topology is incomplete; authenticated ${cursor.nextIndex} of ${cursor.canonicalCount} canonical pool entries`)
		return { pools: [], staged: [] }
	}
	const cachedDeploymentCount = topology.poolDeployments.length
	if (newDeployments.length > 0) mutation.changed = true
	const deploymentsPage = [...topology.poolDeployments.map(deployment => ({ ...deployment })), ...newDeployments.map(cachePoolDeployment)]
	if (BigInt(deploymentsPage.length) !== count) throw new Error('Security-pool registry cache did not reach the canonical deployment count')
	if (new Set(deploymentsPage.map(deployment => deployment.securityPool.toLowerCase())).size !== deploymentsPage.length) throw new Error('Security-pool registry contains duplicate immutable deployments')
	topology.poolDeployments = deploymentsPage.map(deployment => ({ ...deployment }))
	const pools: PoolSnapshot[] = []
	const staged: StagedOperationSnapshot[] = []
	for (const [deploymentIndex, deployment] of deploymentsPage.entries()) {
		const address = deployment.securityPool
		const coordinator = deployment.coordinator
		const cachedDeployment = deploymentIndex < cachedDeploymentCount
		const authenticatedUniverse = universeById.get(deployment.universeId)
		if (authenticatedUniverse === undefined) throw new Error(`Pool ${address} references undiscovered universe ${deployment.universeId}`)
		const [
			repToken,
			shareToken,
			universeId,
			questionId,
			escalationGame,
			truthAuction,
			systemState,
			awaitingForkContinuation,
			accounting,
			shareTokenSupply,
			totalRepBackingUnits,
			totalBadDebt,
			minimumDeposit,
			initialEscalationDeposit,
			priceValid,
			requestCost,
			settlementTime,
			lastPrice,
			lastSettlementTimestamp,
			stagedOperationCounter,
			minimumReport,
			gasConsumedOpenOracleReportPrice,
			settlementCallbackGasLimit,
			gasUnitsForOneDispute,
			initialReportPriorityFeeAttoEthPerGas,
			targetPriceErrorForDispute,
			openOracleSecurityMultiplierBps,
			protocolFee,
			feePercentage,
			escalationHaltMultiplierBps,
			pendingReportId,
			totalPoolHeldAttoRep,
			vaultCount,
			questionOutcome,
			forkDataResult,
			parentForkDataResult,
			ownForkMigrationStatusResult,
			entitlementStatusResult,
			currentMintingCapacity,
			securityMultiplier,
			unassignedPosition,
			poolFactory,
			poolForker,
			poolZoltar,
			poolQuestionData,
			poolCoordinator,
			coordinatorPool,
		] = await drainConcurrent([
			cachedDeployment ? Promise.resolve(authenticatedUniverse.repToken) : client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'repToken' }),
			cachedDeployment ? Promise.resolve(deployment.shareToken) : client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'shareToken' }),
			cachedDeployment ? Promise.resolve(BigInt(deployment.universeId)) : client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'universeId' }),
			cachedDeployment ? Promise.resolve(BigInt(deployment.questionId)) : client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'questionId' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'escalationGame' }),
			cachedDeployment ? Promise.resolve(deployment.truthAuction) : client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'truthAuction' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'systemState' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'awaitingForkContinuation' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'getPoolAccountingSnapshot' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'shareTokenSupplyAttoShares' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'totalRepBackingUnits' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'totalBadDebtAttoEth' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'minimumVaultRepDepositAttoRep' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'initialEscalationGameDepositAttoRep' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'isPriceValid' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'getRequestPriceCostAttoEth' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'settlementTime' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'lastPrice' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'lastSettlementTimestamp' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'stagedOperationCounter' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'minimumToken1ReportAttoEth' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'gasConsumedOpenOracleReportPrice' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'getSettlementCallbackGasLimit' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'gasUnitsForOneDispute' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'initialReportPriorityFeeAttoEthPerGas' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'targetPriceErrorForDispute' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'openOracleSecurityMultiplierBps' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'protocolFee' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'feePercentage' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'escalationHaltMultiplierBps' }),
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'pendingReportId' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'getTotalPoolHeldAttoRep' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'getVaultCount' }),
			client.readContract({ abi: securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'getQuestionOutcome' }),
			client.readContract({ abi: securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'forkData' }),
			deployment.parent === zeroAddress ? Promise.resolve(undefined) : client.readContract({ abi: securityPoolForkerAbi, address: deployments.securityPoolForker, args: [deployment.parent], blockNumber, functionName: 'forkData' }),
			client.readContract({ abi: securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'getOwnForkMigrationStatus' }),
			client.readContract({ abi: securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address, wallet], blockNumber, functionName: 'getEscalationMigrationEntitlementStatus' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'getCurrentMintingCapacityAttoEth' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'statoblastSecurityMultiplierBps' }),
			client.readContract({ abi: securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'getUnassignedPosition' }),
			cachedDeployment ? Promise.resolve(deployments.securityPoolFactory) : client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'securityPoolFactory' }),
			cachedDeployment ? Promise.resolve(deployments.securityPoolForker) : client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'securityPoolForker' }),
			cachedDeployment ? Promise.resolve(deployments.zoltar) : client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'zoltar' }),
			cachedDeployment ? Promise.resolve(deployments.questionData) : client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'questionData' }),
			cachedDeployment ? Promise.resolve(coordinator) : client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'priceOracleManagerAndOperatorQueuer' }),
			cachedDeployment ? Promise.resolve(address) : client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'securityPool' }),
			authenticatePoolProtocolBindings({
				blockNumber,
				canonicalRepToken: authenticatedUniverse.repToken,
				client,
				configuredOpenOracle: deployments.openOracle,
				configuredWeth: deployments.weth,
				coordinator,
				pool: address,
			}),
		])
		const oracleRequestFunding = {
			escalationHaltMultiplierBps: escalationHaltMultiplierBps.toString(),
			feePercentage: feePercentage.toString(),
			gasConsumedOpenOracleReportPrice: gasConsumedOpenOracleReportPrice.toString(),
			gasUnitsForOneDispute: gasUnitsForOneDispute.toString(),
			initialReportPriorityFeeAttoEthPerGas: initialReportPriorityFeeAttoEthPerGas.toString(),
			openOracleSecurityMultiplierBps: openOracleSecurityMultiplierBps.toString(),
			protocolFee: protocolFee.toString(),
			settlementCallbackGasLimit: settlementCallbackGasLimit.toString(),
			targetPriceErrorForDispute: targetPriceErrorForDispute.toString(),
		}
		assertAnchoredOracleRequestFunding({
			baseFeePerGas: anchorBaseFeePerGas.toString(),
			coordinator: oracleRequestFunding,
			minimumToken1ReportAttoEth: minimumReport.toString(),
			requestPriceCostAttoEth: requestCost.toString(),
			settlementCollateralAttoEth: accounting.settlementCollateralAttoEth.toString(),
			subject: `Coordinator ${coordinator}`,
		})
		const [auctionableAttoRepAtFork, , , migratedAttoRep, , , , , ownFork, unresolvedEscalationAtFork, outcomeIndex, forkActivationTime] = forkDataResult
		const parentForkActivationTime = parentForkDataResult?.[11] ?? 0n
		const [statusOwnFork, statusAuctionableAttoRepAtFork, vaultRepAtForkAttoRep] = ownForkMigrationStatusResult
		const [, , materializedByOutcome] = entitlementStatusResult
		const forkData = { auctionableAttoRepAtFork, migratedAttoRep, outcomeIndex, ownFork, unresolvedEscalationAtFork }
		const ownForkMigrationStatus = { auctionableAttoRepAtFork: statusAuctionableAttoRepAtFork, ownFork: statusOwnFork, vaultRepAtForkAttoRep }
		const universe = authenticatedUniverse
		const forkRepMigrationTargetAttoRep = forkRepMigrationTarget(forkData, ownForkMigrationStatus, address)
		const forkRepMigrationProgressByOutcome = Object.fromEntries((childProgressByPool.get(address.toLowerCase()) ?? []).map(progress => [progress.outcomeIndex, progress.childPoolRepSplitAttoRep]))
		assertCanonicalPoolGraph({
			configuredFactory: deployments.securityPoolFactory,
			configuredForker: deployments.securityPoolForker,
			configuredQuestionData: deployments.questionData,
			configuredZoltar: deployments.zoltar,
			coordinatorPool: getAddress(coordinatorPool),
			deploymentCoordinator: coordinator,
			deploymentQuestionId: deployment.questionId,
			deploymentShareToken: deployment.shareToken,
			deploymentTruthAuction: deployment.truthAuction,
			deploymentUniverseId: deployment.universeId,
			pool: address,
			poolCoordinator: getAddress(poolCoordinator),
			poolFactory: getAddress(poolFactory),
			poolForker: getAddress(poolForker),
			poolQuestionData: getAddress(poolQuestionData),
			poolQuestionId: questionId.toString(),
			poolRepToken: getAddress(repToken),
			poolShareToken: getAddress(shareToken),
			poolTruthAuction: getAddress(truthAuction),
			poolUniverseId: universeId.toString(),
			poolZoltar: getAddress(poolZoltar),
			universeRepToken: universe.repToken,
		})
		const escalationAddress = getAddress(escalationGame)
		const [
			escalationCanTriggerOwnFork,
			escalationForkContinuation,
			escalationForkCarryFundingComplete,
			escalationForkResumedAt,
			escalationGameEndTime,
			escalationHasReachedNonDecision,
			escalationNonDecisionState,
			escalationStartBondAttoRep,
			escalationNonDecisionThresholdAttoRep,
			escalationOutcomeBalancesAttoRep,
			escalationResolved,
			forkCarrySnapshotInitialized,
			escalationFinalQuestionResolution,
		] =
			escalationAddress === zeroAddress
				? [false, false, false, 0n, 0n, false, 0n, 0n, 0n, [0n, 0n, 0n] as const, false, false, 3n]
				: await drainConcurrent([
						client.readContract({ abi: escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'canTriggerOwnFork' }),
						client.readContract({ abi: escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'forkContinuation' }),
						client.readContract({ abi: escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'isForkCarryFundingComplete' }),
						client.readContract({ abi: escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'forkResumedAt' }),
						client.readContract({ abi: escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'getEscalationGameEndDate' }),
						client.readContract({ abi: escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'hasReachedNonDecision' }),
						client.readContract({ abi: escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'nonDecisionState' }),
						client.readContract({ abi: escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'startBondAttoRep' }),
						client.readContract({ abi: escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'nonDecisionThresholdAttoRep' }),
						client.readContract({ abi: escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'getOutcomeBalancesAttoRep' }),
						client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'isEscalationResolved' }),
						client.readContract({ abi: escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'forkCarrySnapshotInitialized' }),
						client.readContract({ abi: escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'getFinalQuestionResolution' }),
					])
		const [poolRepBalanceAttoRep, escalationRepBalanceAttoRep, unassignedRepBackingAttoRep] = await drainConcurrent([
			client.readContract({ abi: erc20Abi, address: getAddress(repToken), args: [address], blockNumber, functionName: 'balanceOf' }),
			escalationAddress === zeroAddress ? Promise.resolve(0n) : client.readContract({ abi: erc20Abi, address: getAddress(repToken), args: [escalationAddress], blockNumber, functionName: 'balanceOf' }),
			client.readContract({ abi: securityPoolAbi, address, args: [unassignedPosition[0]], blockNumber, functionName: 'backingUnitsToAttoRep' }),
		])
		let escalationResidualSweepExpectedSuccess = false
		if (escalationAddress !== zeroAddress) {
			try {
				await client.simulateContract({ abi: escalationGameAbi, account: wallet, address: escalationAddress, blockNumber, functionName: 'sweepResidualRepToSecurityPool' })
				escalationResidualSweepExpectedSuccess = true
			} catch (error) {
				if (!contractSimulationReverted(error)) throw error
				// Principal, escrow, finality, and zero-balance guards fail closed.
			}
		}
		const safeEscalationDepositMaximumsAttoRep: [CanonicalUintString, CanonicalUintString, CanonicalUintString] = [canonicalUintString(0n), canonicalUintString(0n), canonicalUintString(0n)]
		const escalationMaximum = escalationAddress === zeroAddress ? initialEscalationDeposit : escalationStartBondAttoRep
		if (systemState === 0n && !awaitingForkContinuation && escalationMaximum > 0n) {
			await drainConcurrent(
				[0, 1, 2].map(async outcome => {
					try {
						await client.simulateContract({ abi: securityPoolAbi, account: wallet, address, args: [outcome, escalationMaximum], blockNumber, functionName: 'depositToEscalationGame' })
						safeEscalationDepositMaximumsAttoRep[outcome] = escalationMaximum.toString()
					} catch (error) {
						if (!contractSimulationReverted(error)) throw error
						// Invalid, unhealthy, and below-minimum deposits remain ineligible.
					}
				}),
			)
		}
		const directEscalationDepositQuotes =
			escalationAddress !== zeroAddress && systemState === 0n && !awaitingForkContinuation && !escalationForkContinuation && universe.forkTime === '0'
				? await discoverDirectEscalationDepositQuotes(client, wallet, escalationAddress, escalationMaximum, escalationOutcomeBalancesAttoRep, escalationNonDecisionThresholdAttoRep, blockNumber)
				: ([emptyDirectEscalationDepositQuote(), emptyDirectEscalationDepositQuote(), emptyDirectEscalationDepositQuote()] satisfies PoolSnapshot['directEscalationDepositQuotes'])
		const pendingReportSettled = pendingReportId === 0n ? false : (await client.readContract({ abi: openOracleAbi, address: deployments.openOracle, args: [pendingReportId], blockNumber, functionName: 'storedGame' })).settlementTimestamp !== 0n
		const vaultCacheKey = address.toLowerCase()
		const vaultRegistry = await advanceVaultRegistryCursor({
			cachedVaults: topology.vaultsByPool[vaultCacheKey] ?? [],
			canonicalCount: vaultCount,
			cursor: topology.discoveryCursors.vaultsByPool[vaultCacheKey],
			label: `Vault registry ${address}`,
			limit: limits.maxVaultsPerPool,
			readNewestFirstPage: async (start, pageCount) => await client.readContract({ abi: securityPoolAbi, address, args: [start, pageCount], blockNumber, functionName: 'getVaults' }),
		})
		if (vaultRegistry.changed) mutation.changed = true
		topology.discoveryCursors.vaultsByPool[vaultCacheKey] = vaultRegistry.cursor
		topology.vaultsByPool[vaultCacheKey] = [...vaultRegistry.vaults]
		if (vaultRegistry.cursor.retentionMode === 'overflow' || !vaultRegistry.complete) warnings.push(registryCatchUpWarning(`Vault ${address}`, vaultRegistry.cursor))
		const inspectEveryVault = vaultRegistry.cursor.retentionMode === 'resident' && vaultRegistry.complete && forkMigrationWindowIsOpen(systemState, forkActivationTime, anchorTimestamp)
		const uniqueVaults = new Map<string, Address>()
		uniqueVaults.set(wallet.toLowerCase(), wallet)
		if (inspectEveryVault) {
			for (const vault of vaultRegistry.vaults) uniqueVaults.set(vault.toLowerCase(), getAddress(vault))
		}
		const vaults = await mapWithConcurrency([...uniqueVaults.values()], DISCOVERY_RPC_CONCURRENCY, async vault => await discoverVault(client, address, escalationAddress, vault, blockNumber))
		const vaultDiscoveryComplete = vaultRegistry.cursor.retentionMode === 'resident' && vaultRegistry.complete && (inspectEveryVault || vaultRegistry.vaults.every(vault => sameAddress(vault, wallet)))
		const walletVaultRegistered = vaultRegistry.cursor.retentionMode === 'resident' && vaultRegistry.complete && vaultRegistry.vaults.some(vault => sameAddress(vault, wallet))
		const walletVault = vaults.find(vault => sameAddress(vault.address, wallet))
		if (walletVault === undefined) throw new Error(`Pool ${address} omitted the requested wallet vault`)
		const minimumSafeWalletVaultDepositAttoRep = minimumSafeVaultDeposit(minimumDeposit, BigInt(walletVault.repBackingUnits), totalRepBackingUnits, poolRepBalanceAttoRep)
		const poolQuestion = questionById.get(questionId.toString())
		const forkQuestion = questionById.get(universe.forkQuestionId)
		let feeEndTimestamp: bigint | undefined
		if (universe !== undefined && poolQuestion !== undefined) feeEndTimestamp = BigInt(universe.forkTime) === 0n ? BigInt(poolQuestion.endTime) : BigInt(universe.forkTime)
		const projectedSettlementCollateral = projectSettlementCollateral(accounting, feeEndTimestamp, anchorTimestamp)
		const unresolvedEscalationMigrationReadyOutcomes: string[] = []
		if (inspectEveryVault && forkData.unresolvedEscalationAtFork) {
			for (const outcome of validForkOutcomeRoutes(forkQuestion, universe.knownChildOutcomes)) {
				try {
					await client.simulateContract({ abi: securityPoolForkerAbi, account: wallet, address: deployments.securityPoolForker, args: [address, wallet, BigInt(outcome)], blockNumber, functionName: 'migrateVaultWithUnresolvedEscalation' })
					unresolvedEscalationMigrationReadyOutcomes.push(outcome)
				} catch (error) {
					if (!contractSimulationReverted(error)) throw error
					// Already-materialized and otherwise invalid routes fail closed.
				}
			}
		}
		const pool: PoolSnapshot = {
			address,
			awaitingForkContinuation,
			canonicalVaultCount: vaultCount.toString(),
			coordinator,
			currentMintingCapacityAttoEth: currentMintingCapacity.toString(),
			escalationCanTriggerOwnFork,
			escalationForkContinuation,
			escalationForkCarryFundingComplete,
			escalationForkResumedAt: escalationForkResumedAt.toString(),
			escalationGameEndTime: escalationGameEndTime.toString(),
			escalationHasReachedNonDecision,
			escalationNonDecisionState: bigintToSafeNumber(escalationNonDecisionState),
			escalationStartBondAttoRep: escalationStartBondAttoRep.toString(),
			escalationNonDecisionThresholdAttoRep: escalationNonDecisionThresholdAttoRep.toString(),
			escalationOutcomeBalancesAttoRep: [escalationOutcomeBalancesAttoRep[0].toString(), escalationOutcomeBalancesAttoRep[1].toString(), escalationOutcomeBalancesAttoRep[2].toString()],
			directEscalationDepositQuotes,
			safeEscalationDepositMaximumsAttoRep,
			escalationGame: escalationAddress,
			escalationResolved,
			forkCarrySnapshotInitialized,
			escalationFinalQuestionResolution: bigintToSafeNumber(escalationFinalQuestionResolution),
			forkActivationTime: forkActivationTime.toString(),
			feeIndex: accounting.feeIndex.toString(),
			forkOutcomeIndex: forkData.outcomeIndex.toString(),
			forkOwnQuestion: forkData.ownFork,
			forkMigratedAttoRep: forkData.migratedAttoRep.toString(),
			forkRepMigrationProgressByOutcome,
			forkRepMigrationTargetAttoRep: forkRepMigrationTargetAttoRep.toString(),
			forkUnresolvedEscalation: forkData.unresolvedEscalationAtFork,
			lastRepPerEthPrice: lastPrice.toString(),
			lastOracleSettlementTimestamp: lastSettlementTimestamp.toString(),
			lastUpdatedFeeAccumulator: accounting.lastUpdatedFeeAccumulator.toString(),
			minimumToken1ReportAttoEth: minimumReport.toString(),
			minimumSafeWalletVaultDepositAttoRep: minimumSafeWalletVaultDepositAttoRep.toString(),
			minimumVaultRepDepositAttoRep: minimumDeposit.toString(),
			oraclePriceValid: priceValid,
			oracleRequestFunding,
			oracleSettlementTime: settlementTime.toString(),
			parent: getAddress(deployment.parent),
			parentForkActivationTime: parentForkActivationTime.toString(),
			pendingReportId: pendingReportId.toString(),
			pendingReportSettled,
			poolRepBalanceAttoRep: poolRepBalanceAttoRep.toString(),
			questionId: questionId.toString(),
			questionOutcome: bigintToSafeNumber(questionOutcome),
			repToken: getAddress(repToken),
			requestPriceCostAttoEth: requestCost.toString(),
			projectedSettlementCollateralAttoEth: projectedSettlementCollateral.toString(),
			settlementCollateralAttoEth: accounting.settlementCollateralAttoEth.toString(),
			shareTokenSupplyAttoShares: shareTokenSupply.toString(),
			statoblastSecurityMultiplierBps: securityMultiplier.toString(),
			totalCapacityOwnershipAttoRep: accounting.totalCapacityOwnershipAttoRep.toString(),
			totalPoolHeldAttoRep: totalPoolHeldAttoRep.toString(),
			totalRepBackingUnits: totalRepBackingUnits.toString(),
			totalBadDebtAttoEth: totalBadDebt.toString(),
			escalationRepBalanceAttoRep: escalationRepBalanceAttoRep.toString(),
			escalationResidualSweepExpectedSuccess,
			shareToken: getAddress(shareToken),
			systemState: bigintToSafeNumber(systemState),
			truthAuction: getAddress(truthAuction),
			unassignedBadDebtAttoEth: (unassignedPosition[3] === accounting.badDebtGeneration ? unassignedPosition[2] : 0n).toString(),
			unassignedCapacityOwnershipAttoRep: unassignedPosition[1].toString(),
			unassignedRepBackingAttoRep: unassignedRepBackingAttoRep.toString(),
			unresolvedEscalationMigrationReadyOutcomes,
			universeId: universeId.toString(),
			stagedOperationCounter: stagedOperationCounter.toString(),
			vaultDiscoveryComplete,
			vaults,
			walletEscalationMaterializedOutcomes: [...materializedByOutcome],
			walletVaultRegistered,
		}
		pools.push(pool)
		staged.push(...(await discoverStagedOperations(client, pool, blockNumber, limits.maxStagedOperationsPerPool, warnings)))
	}
	return { pools, staged }
}

async function discoverPairs(context: EcosystemDiscoveryContext, pools: readonly PoolSnapshot[], blockNumber: bigint, topology: ImmutableTopologyData, mutation: TopologyMutationState) {
	const { client, deployments, wallet } = context
	const pairs: PairSnapshot[] = []
	for (const pool of pools) {
		const pairCacheKey = pool.address.toLowerCase()
		const cachedPair = topology.pairsByPool[pairCacheKey]
		const rawPair = cachedPair ?? (await client.readContract({ abi: tradingFactoryAbi, address: deployments.tradingFactory, args: [pool.address], blockNumber, functionName: 'getPair' }))
		if (rawPair === zeroAddress) continue
		if (cachedPair === undefined) mutation.changed = true
		const address = getAddress(rawPair)
		const [status, feeBps, reserves, effectiveReserves, totalSupply, walletLiquidity, pairFactory, pairPool, pairShareToken, pairUniverseId, pairQuestionId] = await drainConcurrent([
			client.readContract({ abi: tradingPairAbi, address, blockNumber, functionName: 'tradingStatus' }),
			client.readContract({ abi: tradingPairAbi, address, blockNumber, functionName: 'feeBps' }),
			client.readContract({ abi: tradingPairAbi, address, blockNumber, functionName: 'getReserves' }),
			client.readContract({ abi: tradingPairAbi, address, blockNumber, functionName: 'getEffectiveReserves' }),
			client.readContract({ abi: tradingPairAbi, address, blockNumber, functionName: 'totalSupply' }),
			client.readContract({ abi: tradingPairAbi, address, args: [wallet], blockNumber, functionName: 'balanceOf' }),
			cachedPair === undefined ? client.readContract({ abi: tradingPairAbi, address, blockNumber, functionName: 'factory' }) : Promise.resolve(deployments.tradingFactory),
			cachedPair === undefined ? client.readContract({ abi: tradingPairAbi, address, blockNumber, functionName: 'securityPool' }) : Promise.resolve(pool.address),
			cachedPair === undefined ? client.readContract({ abi: tradingPairAbi, address, blockNumber, functionName: 'shareToken' }) : Promise.resolve(pool.shareToken),
			cachedPair === undefined ? client.readContract({ abi: tradingPairAbi, address, blockNumber, functionName: 'universeId' }) : Promise.resolve(BigInt(pool.universeId)),
			cachedPair === undefined ? client.readContract({ abi: tradingPairAbi, address, blockNumber, functionName: 'questionId' }) : Promise.resolve(BigInt(pool.questionId)),
		])
		assertCanonicalPairGraph({
			configuredFactory: deployments.tradingFactory,
			pair: address,
			pairFactory: getAddress(pairFactory),
			pairPool: getAddress(pairPool),
			pairQuestionId: pairQuestionId.toString(),
			pairShareToken: getAddress(pairShareToken),
			pairUniverseId: pairUniverseId.toString(),
			pool: pool.address,
			poolQuestionId: pool.questionId,
			poolShareToken: pool.shareToken,
			poolUniverseId: pool.universeId,
		})
		topology.pairsByPool[pairCacheKey] = address
		pairs.push({
			address,
			effectiveNoReserve: effectiveReserves[1].toString(),
			effectiveYesReserve: effectiveReserves[0].toString(),
			feeBps: bigintToSafeNumber(feeBps),
			noReserve: reserves[1].toString(),
			pool: pool.address,
			shareToken: pool.shareToken,
			status: bigintToSafeNumber(status),
			totalSupply: totalSupply.toString(),
			universeId: pool.universeId,
			walletLiquidity: walletLiquidity.toString(),
			yesReserve: reserves[0].toString(),
		})
	}
	return pairs
}

async function discoverTokenInventory(context: EcosystemDiscoveryContext, universes: readonly UniverseSnapshot[], pools: readonly PoolSnapshot[], blockNumber: bigint) {
	const { client, deployments, wallet } = context
	const addresses = new Map<string, Address>()
	addresses.set(deployments.weth.toLowerCase(), deployments.weth)
	for (const universe of universes) addresses.set(universe.repToken.toLowerCase(), universe.repToken)
	const tokens: TokenInventory[] = []
	for (const address of addresses.values()) {
		const [balance, openOracleCredit, openOracleInternalAllowanceToSelf] = await drainConcurrent([
			client.readContract({ abi: erc20Abi, address, args: [wallet], blockNumber, functionName: 'balanceOf' }),
			client.readContract({ abi: openOracleAbi, address: deployments.openOracle, args: [wallet, address], blockNumber, functionName: 'tokenHolder' }),
			client.readContract({ abi: openOracleAbi, address: deployments.openOracle, args: [wallet, wallet, address], blockNumber, functionName: 'internalAllowance' }),
		])
		const allowances: Record<string, string> = {}
		for (const spender of relevantTokenSpenders(deployments, pools, address)) {
			allowances[spender] = (await client.readContract({ abi: erc20Abi, address, args: [wallet, spender], blockNumber, functionName: 'allowance' })).toString()
		}
		tokens.push({
			address,
			allowances,
			balance: balance.toString(),
			openOracleCredit: openOracleCredit.toString(),
			openOracleInternalAllowanceToSelf: openOracleInternalAllowanceToSelf.toString(),
			symbol: context.tokenSymbols?.[address.toLowerCase()] ?? (sameAddress(address, deployments.weth) ? 'WETH' : 'REP'),
		})
	}
	return tokens
}

export function trustedIndexedReportsForDiscovery(parameters: { deployments: EcosystemDeployments; wallet: Address; reports: readonly OracleGameSnapshot[]; universes: readonly UniverseSnapshot[]; pools: readonly PoolSnapshot[] }) {
	const coordinatorReports = parameters.pools.flatMap(pool =>
		pool.pendingReportId === '0'
			? []
			: [
					{
						coordinator: pool.coordinator,
						pendingReportId: pool.pendingReportId,
						repToken: pool.repToken,
					},
				],
	)
	const trustedReport = trustedOpenOracleReportPredicate({
		coordinatorReports,
		maximumSettlementStepGasLimit: OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT,
		openOracle: parameters.deployments.openOracle,
		trustedRepTokens: parameters.universes.map(universe => universe.repToken),
		wallet: parameters.wallet,
		weth: parameters.deployments.weth,
	})
	return parameters.reports.filter(trustedReport)
}

export async function discoverShareInventory(context: EcosystemDiscoveryContext, pools: readonly PoolSnapshot[], pairs: readonly PairSnapshot[], universes: readonly UniverseSnapshot[], questions: readonly QuestionSnapshot[], blockNumber: bigint, warnings: string[]) {
	const { client, deployments, wallet } = context
	const shares: ShareInventory[] = []
	const universeById = new Map(universes.map(universe => [universe.id, universe]))
	const questionById = new Map(questions.map(question => [question.id, question]))
	const operatorsByShareToken = new Map<string, Map<string, Address>>()
	for (const pair of pairs) {
		const key = pair.shareToken.toLowerCase()
		const operators = operatorsByShareToken.get(key) ?? new Map<string, Address>()
		operators.set(deployments.tradingRouter.toLowerCase(), deployments.tradingRouter)
		operators.set(pair.address.toLowerCase(), pair.address)
		operatorsByShareToken.set(key, operators)
	}
	const operatorsFor = (shareToken: Address) => {
		const key = shareToken.toLowerCase()
		const operators = operatorsByShareToken.get(key) ?? new Map<string, Address>()
		operators.set(deployments.tradingRouter.toLowerCase(), deployments.tradingRouter)
		operatorsByShareToken.set(key, operators)
		return operators
	}
	const migrationTargetsFor = (pool: PoolSnapshot) => {
		const universe = universeById.get(pool.universeId)
		if (universe === undefined || universe.forkTime === '0') return []
		return validForkOutcomeRoutes(questionById.get(universe.forkQuestionId), universe.knownChildOutcomes)
	}
	const plannedKeys = new Set<string>()
	let plannedFanout = 0n
	for (const pool of pools) {
		const key = `${pool.shareToken.toLowerCase()}:${pool.universeId}`
		if (plannedKeys.has(key)) continue
		plannedKeys.add(key)
		const targetCount = BigInt(migrationTargetsFor(pool).length)
		plannedFanout += BigInt(operatorsFor(pool.shareToken).size) + 4n * targetCount
		if (plannedFanout > BigInt(DISCOVERY_AGGREGATE_ITEM_LIMIT)) {
			warnings.push(`Share-inventory discovery truncated because planned approval and migration fan-out is at least ${plannedFanout.toString()} entries, exceeding the configured ${DISCOVERY_AGGREGATE_ITEM_LIMIT.toString()}-entry aggregate limit`)
			return []
		}
	}
	const seen = new Set<string>()
	for (const pool of pools) {
		const key = `${pool.shareToken.toLowerCase()}:${pool.universeId}`
		if (seen.has(key)) continue
		seen.add(key)
		const base = BigInt(pool.universeId) << 8n
		const operators = operatorsFor(pool.shareToken)
		const [invalid, yes, no] = await drainConcurrent([0n, 1n, 2n].map(outcome => client.readContract({ abi: erc1155Abi, address: pool.shareToken, args: [wallet, base | outcome], blockNumber, functionName: 'balanceOf' })))
		if (invalid === undefined || yes === undefined || no === undefined) throw new Error(`Share token ${pool.shareToken} returned incomplete balances`)
		const approvals: Record<string, boolean> = {}
		for (const operator of operators.values()) {
			approvals[operator] = await client.readContract({ abi: erc1155Abi, address: pool.shareToken, args: [wallet, operator], blockNumber, functionName: 'isApprovedForAll' })
		}
		const migrationProgressByRoute: Record<string, string> = {}
		const targetOutcomes = migrationTargetsFor(pool)
		if (targetOutcomes.length > 0) {
			const childUniverses = await mapWithConcurrency(targetOutcomes, DISCOVERY_RPC_CONCURRENCY, async targetOutcome => await client.readContract({ abi: zoltarAbi, address: deployments.zoltar, args: [BigInt(pool.universeId), BigInt(targetOutcome)], blockNumber, functionName: 'getChildUniverseId' }))
			const balances = [invalid, yes, no]
			for (let sourceOutcome = 0; sourceOutcome < balances.length; sourceOutcome += 1) {
				if ((balances[sourceOutcome] ?? 0n) === 0n) continue
				const fromId = base | BigInt(sourceOutcome)
				for (let targetIndex = 0; targetIndex < childUniverses.length; targetIndex += 1) {
					const targetUniverseId = childUniverses[targetIndex]
					const targetOutcome = targetOutcomes[targetIndex]
					if (targetUniverseId === undefined || targetOutcome === undefined) throw new Error(`Missing child universe id for fork outcome index ${targetIndex.toString()}`)
					const migrated = await client.readContract({ abi: shareTokenAbi, address: pool.shareToken, args: [fromId, targetUniverseId, wallet], blockNumber, functionName: 'getMigratedShareAmountAttoShares' })
					migrationProgressByRoute[`${sourceOutcome.toString()}:${targetOutcome}`] = migrated.toString()
				}
			}
		}
		shares.push({ invalid: invalid.toString(), isApprovedForAll: approvals, migrationProgressByRoute, no: no.toString(), shareToken: pool.shareToken, universeId: pool.universeId, yes: yes.toString() })
	}
	return shares
}

async function discoverLpInventory(context: EcosystemDiscoveryContext, pairs: readonly PairSnapshot[], blockNumber: bigint) {
	return await mapWithConcurrency(pairs, DISCOVERY_RPC_CONCURRENCY, async pair => ({
		allowanceToRouter: (await context.client.readContract({ abi: tradingPairAbi, address: pair.address, args: [context.wallet, context.deployments.tradingRouter], blockNumber, functionName: 'allowance' })).toString(),
		balance: pair.walletLiquidity,
		pair: pair.address,
	}))
}

function authenticatedAuctionRefundGeneration(context: EcosystemDiscoveryContext, auction: Address, pendingAttoEth: bigint) {
	const indexed = context.indexedAuctionRefunds?.[auction.toLowerCase()]
	return pendingAttoEth > 0n && indexed !== undefined && BigInt(indexed.pendingAttoEth) === pendingAttoEth ? indexed.generation : undefined
}

async function discoverAuctions(context: EcosystemDiscoveryContext, pools: readonly PoolSnapshot[], blockNumber: bigint): Promise<AuctionSnapshot[]> {
	const auctions: AuctionSnapshot[] = []
	for (const pool of pools) {
		if (pool.truthAuction === zeroAddress) continue
		const started = await context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, blockNumber, functionName: 'auctionStarted' })
		const [minimumBid, finalized, pendingRefund, clearing, storedClearingTick, underfunded, underfundedWinningAttoEth] =
			started === 0n
				? [0n, false, 0n, [false, 0n, 0n, 0n] as const, 0n, false, 0n]
				: await drainConcurrent([
						context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, blockNumber, functionName: 'minBidSizeAttoEth' }),
						context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, blockNumber, functionName: 'finalized' }),
						context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, args: [context.wallet], blockNumber, functionName: 'pendingEthRefundsAttoEth' }),
						context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, blockNumber, functionName: 'computeClearing' }),
						context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, blockNumber, functionName: 'clearingTick' }),
						context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, blockNumber, functionName: 'underfunded' }),
						context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, blockNumber, functionName: 'underfundedWinningAttoEth' }),
					])
		const pendingEthRefundGeneration = authenticatedAuctionRefundGeneration(context, pool.truthAuction, pendingRefund)
		auctions.push({
			address: pool.truthAuction,
			bids: [...(context.indexedAuctionBids?.[pool.truthAuction.toLowerCase()] ?? [])],
			endTime: (started + 7n * 24n * 60n * 60n).toString(),
			finalized,
			hasClearingPrice: finalized ? !underfunded || underfundedWinningAttoEth > 0n : clearing[0],
			clearingTick: (finalized ? storedClearingTick : clearing[1]).toString(),
			minimumBidAttoEth: minimumBid.toString(),
			pendingEthRefund: pendingRefund.toString(),
			...(pendingEthRefundGeneration === undefined ? {} : { pendingEthRefundGeneration }),
			pool: pool.address,
			startTime: started.toString(),
			underfunded,
			underfundedWinningAttoEth: underfundedWinningAttoEth.toString(),
		})
	}
	return auctions
}

async function verifyIndexedReports(context: EcosystemDiscoveryContext, blockNumber: bigint) {
	const verified: OracleGameSnapshot[] = []
	for (const report of context.indexedReports ?? []) {
		if (!sameAddress(report.openOracle, context.deployments.openOracle)) continue
		const stateHash = await context.client.readContract({ abi: openOracleAbi, address: report.openOracle, args: [BigInt(report.reportId)], blockNumber, functionName: 'oracleGame' })
		if (stateHash.toLowerCase() !== report.stateHash.toLowerCase()) continue
		const timestampClock = (report.flags & 1) !== 0
		const settleAt = BigInt(report.reportTimestamp) + BigInt(report.settlementTime)
		const disputeAt = BigInt(report.reportTimestamp) + BigInt(report.disputeDelay)
		const verifiedReport: OracleGameSnapshot = { ...report, stateHash }
		if (timestampClock) {
			verifiedReport.disputeAfterTimestamp = disputeAt.toString()
			verifiedReport.disputeBeforeTimestamp = settleAt.toString()
			verifiedReport.settleAfterTimestamp = settleAt.toString()
		}
		verified.push(verifiedReport)
	}
	return verified
}

export async function discoverEcosystemSnapshot(context: EcosystemDiscoveryContext): Promise<EcosystemSnapshot> {
	context = { ...context, client: limitDiscoveryConcurrency(context.client) }
	const limits = limitsWithDefaults(context.limits)
	for (const [label, value] of Object.entries(limits)) requirePositiveLimit(value, label)
	requireAggregateDiscoveryEnvelope(limits)
	const block = await context.client.getBlock({ blockNumber: context.anchorBlockNumber })
	if (block.hash === null || block.hash === undefined) throw new Error('Canonical discovery anchor has no block hash')
	if (block.number === undefined) throw new Error('Canonical discovery anchor has no block number')
	if (block.baseFeePerGas === null || block.baseFeePerGas === undefined) throw new Error('Canonical discovery anchor has no EIP-1559 base fee')
	if (block.number !== context.anchorBlockNumber) throw new Error(`RPC returned block ${block.number.toString()} for requested anchor ${context.anchorBlockNumber.toString()}`)
	if (context.expectedAnchorHash !== undefined && block.hash.toLowerCase() !== context.expectedAnchorHash.toLowerCase()) {
		throw new Error(`RPC anchor hash ${block.hash} does not match quorum anchor ${context.expectedAnchorHash}`)
	}
	if (context.expectedAnchorBaseFeePerGas !== undefined && block.baseFeePerGas !== context.expectedAnchorBaseFeePerGas) {
		throw new Error(`RPC anchor base fee ${block.baseFeePerGas.toString()} does not match quorum anchor ${context.expectedAnchorBaseFeePerGas.toString()}`)
	}
	const blockNumber = block.number
	const resolvedTopology = await immutableTopologyForAnchor(context, { hash: block.hash, number: blockNumber })
	const topology = resolvedTopology.topology
	const topologyMutation = { changed: resolvedTopology.reset }
	const tradingDeployment = await authenticateConfiguredGraph(context, blockNumber)
	const warnings: string[] = []
	const [chainId, ethBalanceAttoEth, universes, questions, openOracleEthCredit] = await drainConcurrent([
		context.client.getChainId(),
		context.client.getBalance({ address: context.wallet, blockNumber }),
		discoverUniverses(context, blockNumber, limits, topology, topologyMutation, warnings),
		discoverQuestions(context, blockNumber, limits, topology, topologyMutation, warnings),
		context.client.readContract({ abi: openOracleAbi, address: context.deployments.openOracle, args: [context.wallet, zeroAddress], blockNumber, functionName: 'tokenHolder' }),
	])
	const { pools, staged } = await discoverPools(context, blockNumber, block.timestamp, block.baseFeePerGas, limits, warnings, universes, questions, topology, topologyMutation)
	const pairs = tradingDeployment.factory ? await discoverPairs(context, pools, blockNumber, topology, topologyMutation) : []
	const genesisUniswap = context.allowMissingTradingDeployment ? await discoverGenesisUniswap(context, universes, blockNumber) : undefined
	const indexedReports = trustedIndexedReportsForDiscovery({ deployments: context.deployments, pools, reports: context.indexedReports ?? [], universes, wallet: context.wallet })
	context = { ...context, indexedReports }
	const [tokens, shares, lpTokens, auctions, reports] = await drainConcurrent([
		discoverTokenInventory(context, universes, pools, blockNumber),
		discoverShareInventory(context, pools, pairs, universes, questions, blockNumber, warnings),
		discoverLpInventory(context, pairs, blockNumber),
		discoverAuctions(context, pools, blockNumber),
		verifyIndexedReports(context, blockNumber),
	])
	const snapshot: EcosystemSnapshot = {
		anchor: { baseFeePerGas: block.baseFeePerGas.toString(), blockHash: block.hash, blockNumber: blockNumber.toString(), timestamp: block.timestamp.toString() },
		auctions,
		chainId,
		deployments: context.deployments,
		escalationDeposits: [...(context.indexedEscalationDeposits ?? [])],
		pairs,
		pools,
		questions,
		reports,
		schemaVersion: 1,
		stagedOperations: staged,
		tradingDeployment,
		...(genesisUniswap === undefined ? {} : { genesisUniswap }),
		universes,
		wallet: { address: context.wallet, ethBalanceAttoEth: ethBalanceAttoEth.toString(), lpTokens, openOracleEthCredit: openOracleEthCredit.toString(), shares, tokens },
		warnings: canonicalDiscoveryWarnings(warnings),
	}
	context.recordTopologyCache?.(
		{
			...cloneImmutableTopologyData(topology),
			anchor: { blockHash: block.hash, blockNumber: blockNumber.toString() },
			schemaVersion: IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
		},
		topologyMutation.changed,
	)
	return snapshot
}

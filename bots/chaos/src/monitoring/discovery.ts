import { bigintToSafeNumber, encodeAbiParameters, getAddress, zeroAddress, zeroHash, type Address, type Chain, type Hash, type Hex, type PublicClient, type Transport } from '@zoltar/bot-shared/ethereum'
import { auctionAbi, coordinatorAbi, erc1155Abi, erc20Abi, escalationGameAbi, liquidationApprovalRegistryAbi, openOracleAbi, questionDataAbi, securityPoolAbi, securityPoolFactoryAbi, securityPoolForkerAbi, shareTokenAbi, tradingFactoryAbi, tradingPairAbi, tradingRouterAbi, zoltarAbi } from '../contracts/abi.ts'
import { canonicalUintString, type CanonicalUintString } from '../core/units.ts'
import type {
	AuctionBidSnapshot,
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
import { OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT, trustedOpenOracleReportPredicate } from './protocol-index.ts'
import { cloneImmutableTopologyData, emptyImmutableTopologyData, IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION, type CachedPoolDeployment, type CanonicalImmutableTopologyCache, type ImmutableTopologyData } from './topology-cache.ts'

export type ChaosReadClient = PublicClient<Transport, Chain>

export const DISCOVERY_RPC_CONCURRENCY = 12
export const FORK_MIGRATION_WINDOW_SECONDS = 8n * 7n * 24n * 60n * 60n

export function forkMigrationWindowIsOpen(systemState: bigint, forkActivationTime: bigint, timestamp: bigint) {
	return systemState === 1n && forkActivationTime > 0n && timestamp <= forkActivationTime + FORK_MIGRATION_WINDOW_SECONDS
}

export function limitDiscoveryConcurrency(client: ChaosReadClient, maximum = DISCOVERY_RPC_CONCURRENCY): ChaosReadClient {
	if (!Number.isSafeInteger(maximum) || maximum <= 0) throw new Error('Discovery RPC concurrency must be a positive safe integer')
	let active = 0
	const waiting: Array<() => void> = []
	const schedule = async <T>(work: () => Promise<T>) => {
		if (active >= maximum) await new Promise<void>(resolve => waiting.push(resolve))
		active += 1
		try {
			return await work()
		} finally {
			active -= 1
			waiting.shift()?.()
		}
	}
	const limitedMethods = new Set<PropertyKey>(['getBalance', 'getBlock', 'getChainId', 'readContract', 'simulateContract'])
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
	maxQuestions: number
	maxUniverses: number
	maxPools: number
	maxVaultsPerPool: number
	maxStagedOperationsPerPool: number
}

export interface EcosystemDiscoveryContext {
	client: ChaosReadClient
	deployments: EcosystemDeployments
	wallet: Address
	anchorBlockNumber: bigint
	expectedAnchorHash?: Hash
	limits?: Partial<DiscoveryLimits>
	indexedReports?: readonly OracleGameSnapshot[]
	indexedAuctionBids?: Readonly<Record<string, readonly AuctionBidSnapshot[]>>
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
	maxPools: 100,
	maxQuestions: 100,
	maxStagedOperationsPerPool: 100,
	maxUniverses: 100,
	maxVaultsPerPool: 100,
}

function limitsWithDefaults(configured?: Partial<DiscoveryLimits>): DiscoveryLimits {
	return {
		maxPools: configured?.maxPools ?? DEFAULT_LIMITS.maxPools,
		maxQuestions: configured?.maxQuestions ?? DEFAULT_LIMITS.maxQuestions,
		maxStagedOperationsPerPool: configured?.maxStagedOperationsPerPool ?? DEFAULT_LIMITS.maxStagedOperationsPerPool,
		maxUniverses: configured?.maxUniverses ?? DEFAULT_LIMITS.maxUniverses,
		maxVaultsPerPool: configured?.maxVaultsPerPool ?? DEFAULT_LIMITS.maxVaultsPerPool,
	}
}

function requirePositiveLimit(value: unknown, label: string) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error(`${label} must be a positive safe integer`)
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
	let cachedBlock: Awaited<ReturnType<ChaosReadClient['getBlock']>>
	try {
		cachedBlock = await context.client.getBlock({ blockNumber: cachedBlockNumber })
	} catch (error) {
		if (error instanceof Error) return { reset: true, topology: emptyImmutableTopologyData() }
		throw new Error('Immutable topology canonical-history probe threw a non-Error value', { cause: error })
	}
	if (cachedBlock.hash == null || cachedBlock.number !== cachedBlockNumber || cachedBlock.hash.toLowerCase() !== cached.anchor.blockHash.toLowerCase()) {
		return { reset: true, topology: emptyImmutableTopologyData() }
	}
	return { reset: false, topology: cloneImmutableTopologyData(cached) }
}

export async function collectCountedPages<T>(parameters: { count: bigint; label: string; pageSize: number; readPage: (start: bigint, count: bigint) => Promise<readonly T[]> }) {
	if (parameters.count < 0n) throw new Error(`${parameters.label} count cannot be negative`)
	requirePositiveLimit(parameters.pageSize, `${parameters.label} page size`)
	const values: T[] = []
	const pageSize = BigInt(parameters.pageSize)
	for (let start = 0n; start < parameters.count; ) {
		const remaining = parameters.count - start
		const requested = remaining < pageSize ? remaining : pageSize
		const page = await parameters.readPage(start, requested)
		if (page.length !== Number(requested)) {
			throw new Error(`${parameters.label} page at ${start.toString()} returned ${page.length.toString()} entries instead of ${requested.toString()}`)
		}
		values.push(...page)
		start += requested
	}
	return values
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
	const [poolOpenOracle, coordinatorOpenOracle, coordinatorWeth, coordinatorRepToken] = await Promise.all([
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
	const [questionData, forkerZoltar, tradingSecurityPoolFactory, routerFactory] = await Promise.all([
		client.readContract({ abi: zoltarAbi, address: deployments.zoltar, blockNumber, functionName: 'zoltarQuestionData' }),
		client.readContract({ abi: securityPoolForkerAbi, address: deployments.securityPoolForker, blockNumber, functionName: 'zoltar' }),
		client.readContract({ abi: tradingFactoryAbi, address: deployments.tradingFactory, blockNumber, functionName: 'securityPoolFactory' }),
		client.readContract({ abi: tradingRouterAbi, address: deployments.tradingRouter, blockNumber, functionName: 'factory' }),
	])
	requireGraphEdge(getAddress(questionData), deployments.questionData, 'Zoltar question-data edge')
	requireGraphEdge(getAddress(forkerZoltar), deployments.zoltar, 'SecurityPoolForker Zoltar edge')
	requireGraphEdge(getAddress(tradingSecurityPoolFactory), deployments.securityPoolFactory, 'Trading factory security-pool-factory edge')
	requireGraphEdge(getAddress(routerFactory), deployments.tradingFactory, 'Trading router factory edge')
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
	spenders.set(deployments.zoltar.toLowerCase(), deployments.zoltar)
	spenders.set(deployments.openOracle.toLowerCase(), deployments.openOracle)
	for (const pool of pools) {
		if (!sameAddress(token, deployments.weth) && !sameAddress(token, pool.repToken)) continue
		spenders.set(pool.coordinator.toLowerCase(), pool.coordinator)
		if (sameAddress(token, pool.repToken)) spenders.set(pool.address.toLowerCase(), pool.address)
	}
	return [...spenders.values()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))
}

async function discoverUniverses(context: EcosystemDiscoveryContext, blockNumber: bigint, limits: DiscoveryLimits, topology: ImmutableTopologyData, mutation: TopologyMutationState) {
	const { client, deployments, wallet } = context
	const queue = [0n]
	const seen = new Set<string>()
	const universes: UniverseSnapshot[] = []
	const forkBurnDivisor = await client.readContract({ abi: zoltarAbi, address: deployments.zoltar, blockNumber, functionName: 'forkBurnDivisor' })
	const migrationProgressByUniverse = new Map<string, MigrationRepSplitProgressSnapshot[]>()
	for (const progress of context.indexedMigrationRepSplits ?? []) {
		const routes = migrationProgressByUniverse.get(progress.universeId) ?? []
		routes.push(progress)
		migrationProgressByUniverse.set(progress.universeId, routes)
	}
	for (const routes of migrationProgressByUniverse.values()) routes.sort((left, right) => compareUnsignedStrings(left.outcomeIndex, right.outcomeIndex))
	while (queue.length > 0) {
		const universeId = queue.shift()
		if (universeId === undefined) throw new Error('Universe traversal lost its current entry')
		if (seen.has(universeId.toString())) continue
		seen.add(universeId.toString())
		const [raw, threshold, nonDecisionThreshold, migration] = await Promise.all([
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
		const childPageSize = BigInt(limits.maxUniverses)
		for (let start = BigInt(outcomes.length); ; ) {
			const [pageOutcomes, pageChildIds, pageChildren] = await client.readContract({ abi: zoltarAbi, address: deployments.zoltar, args: [universeId, start, childPageSize], blockNumber, functionName: 'getDeployedChildUniverses' })
			if (pageOutcomes.length !== pageChildIds.length || pageOutcomes.length !== pageChildren.length) throw new Error(`Universe ${universeId.toString()} returned mismatched child arrays`)
			if (pageOutcomes.length > limits.maxUniverses) throw new Error(`Universe ${universeId.toString()} exceeded the requested child page size`)
			outcomes.push(...pageOutcomes)
			childIds.push(...pageChildIds)
			if (pageOutcomes.length > 0) mutation.changed = true
			if (pageOutcomes.length < limits.maxUniverses) break
			start += BigInt(pageOutcomes.length)
		}
		if (new Set(outcomes.map(outcome => outcome.toString())).size !== outcomes.length || new Set(childIds.map(childId => childId.toString())).size !== childIds.length) {
			throw new Error(`Universe ${universeId.toString()} returned duplicate immutable child routes`)
		}
		topology.universeChildren[universeId.toString()] = {
			childUniverseIds: childIds.map(childId => childId.toString()),
			outcomeIndexes: outcomes.map(outcome => outcome.toString()),
		}
		for (const childId of childIds) queue.push(childId)
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
	return universes
}

async function discoverQuestions(context: EcosystemDiscoveryContext, blockNumber: bigint, limits: DiscoveryLimits, topology: ImmutableTopologyData, mutation: TopologyMutationState) {
	const { client, deployments } = context
	const count = await client.readContract({ abi: questionDataAbi, address: deployments.questionData, blockNumber, functionName: 'getQuestionCount' })
	if (count < BigInt(topology.questions.length)) {
		throw new Error(`Question registry count ${count.toString()} is below immutable cache count ${topology.questions.length.toString()}`)
	}
	const ids = await collectCountedPages({
		count: count - BigInt(topology.questions.length),
		label: 'Question discovery',
		pageSize: limits.maxQuestions,
		readPage: async (start, pageCount) => await client.readContract({ abi: questionDataAbi, address: deployments.questionData, args: [start + BigInt(topology.questions.length), pageCount], blockNumber, functionName: 'getQuestions' }),
	})
	const discovered = await Promise.all(
		ids.map(async questionId => {
			const [question, createdAt, labels] = await Promise.all([
				client.readContract({ abi: questionDataAbi, address: deployments.questionData, args: [questionId], blockNumber, functionName: 'questions' }),
				client.readContract({ abi: questionDataAbi, address: deployments.questionData, args: [questionId], blockNumber, functionName: 'questionCreatedTimestamp' }),
				client.readContract({ abi: questionDataAbi, address: deployments.questionData, args: [questionId, 0n, 256n], blockNumber, functionName: 'getOutcomeLabels' }),
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
			return snapshot
		}),
	)
	if (discovered.length > 0) mutation.changed = true
	const questions = [...topology.questions.map(question => ({ ...question, outcomeLabels: [...question.outcomeLabels] })), ...discovered]
	if (BigInt(questions.length) !== count) throw new Error('Question registry cache did not reach the canonical question count')
	if (new Set(questions.map(question => question.id)).size !== questions.length) throw new Error('Question registry contains duplicate immutable question IDs')
	topology.questions = questions.map(question => ({ ...question, outcomeLabels: [...question.outcomeLabels] }))
	return questions
}

async function discoverVault(client: ChaosReadClient, pool: Address, escalationGame: Address, vault: Address, blockNumber: bigint): Promise<VaultSnapshot> {
	const [state, openInterest, badDebt] = await Promise.all([
		client.readContract({ abi: securityPoolAbi, address: pool, args: [vault], blockNumber, functionName: 'securityVaults' }),
		client.readContract({ abi: securityPoolAbi, address: pool, args: [vault], blockNumber, functionName: 'getVaultOpenInterestAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address: pool, args: [vault], blockNumber, functionName: 'vaultBadDebtAttoEth' }),
	])
	const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth, feeIndex] = state
	const [repBackingAttoRep, disputeStakedAttoRep] = await Promise.all([
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
	const [count, pendingIds] = await Promise.all([client.readContract({ abi: coordinatorAbi, address: pool.coordinator, blockNumber, functionName: 'getActiveStagedOperationCount' }), client.readContract({ abi: coordinatorAbi, address: pool.coordinator, blockNumber, functionName: 'getPendingSettlementOperationIds' })])
	void warnings
	const entries = await collectCountedPages({
		count,
		label: `Staged-operation discovery for ${pool.coordinator}`,
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
	})
	if (entries.length === 0) return []
	const pending = new Set(pendingIds.map(id => id.toString()))
	let liquidationConfiguration: Promise<readonly [bigint, Address]> | undefined
	const getLiquidationConfiguration = () => {
		liquidationConfiguration ??= Promise.all([
			client.readContract({ abi: coordinatorAbi, address: pool.coordinator, blockNumber, functionName: 'minLiquidationPriceDistanceBps' }),
			client.readContract({ abi: coordinatorAbi, address: pool.coordinator, blockNumber, functionName: 'liquidationApprovalRegistry' }).then(getAddress),
		])
		return liquidationConfiguration
	}
	return await Promise.all(
		entries.map(async ({ id, operation }): Promise<StagedOperationSnapshot> => {
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
						const [registryCoordinator, reservation, approval] = await Promise.all([
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
		}),
	)
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

async function discoverPools(context: EcosystemDiscoveryContext, blockNumber: bigint, anchorTimestamp: bigint, limits: DiscoveryLimits, warnings: string[], universes: readonly UniverseSnapshot[], questions: readonly QuestionSnapshot[], topology: ImmutableTopologyData, mutation: TopologyMutationState) {
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
	const cachedDeploymentCount = topology.poolDeployments.length
	if (count < BigInt(topology.poolDeployments.length)) {
		throw new Error(`Security-pool registry count ${count.toString()} is below immutable cache count ${topology.poolDeployments.length.toString()}`)
	}
	const newDeployments = await collectCountedPages({
		count: count - BigInt(cachedDeploymentCount),
		label: 'Pool discovery',
		pageSize: limits.maxPools,
		readPage: async (start, pageCount) => await client.readContract({ abi: securityPoolFactoryAbi, address: deployments.securityPoolFactory, args: [start + BigInt(cachedDeploymentCount), pageCount], blockNumber, functionName: 'securityPoolDeploymentsRange' }),
	})
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
			pendingReportId,
			totalPoolHeldAttoRep,
			vaultCount,
			questionOutcome,
			forkActivationTime,
			parentForkActivationTime,
			forkDataResult,
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
		] = await Promise.all([
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
			client.readContract({ abi: coordinatorAbi, address: coordinator, blockNumber, functionName: 'pendingReportId' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'getTotalPoolHeldAttoRep' }),
			client.readContract({ abi: securityPoolAbi, address, blockNumber, functionName: 'getVaultCount' }),
			client.readContract({ abi: securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'getQuestionOutcome' }),
			client.readContract({ abi: securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'getForkActivationTime' }),
			deployment.parent === zeroAddress ? Promise.resolve(0n) : client.readContract({ abi: securityPoolForkerAbi, address: deployments.securityPoolForker, args: [deployment.parent], blockNumber, functionName: 'getForkActivationTime' }),
			client.readContract({ abi: securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'forkData' }),
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
		const [auctionableAttoRepAtFork, , , migratedAttoRep, , , , , ownFork, unresolvedEscalationAtFork, outcomeIndex] = forkDataResult
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
		const [escalationCanTriggerOwnFork, escalationForkContinuation, escalationForkCarryFundingComplete, escalationForkResumedAt, escalationGameEndTime, escalationHasReachedNonDecision, escalationNonDecisionState, escalationStartBondAttoRep, escalationNonDecisionThresholdAttoRep, escalationOutcomeBalancesAttoRep] =
			escalationAddress === zeroAddress
				? [false, false, false, 0n, 0n, false, 0n, 0n, 0n, [0n, 0n, 0n] as const]
				: await Promise.all([
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
					])
		const [poolRepBalanceAttoRep, escalationRepBalanceAttoRep, unassignedRepBackingAttoRep] = await Promise.all([
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
			await Promise.all(
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
		const pendingReportSettled = pendingReportId === 0n ? false : (await client.readContract({ abi: openOracleAbi, address: deployments.openOracle, args: [pendingReportId], blockNumber, functionName: 'storedGame' })).settlementTimestamp !== 0n
		const vaultCacheKey = address.toLowerCase()
		const cachedVaults = topology.vaultsByPool[vaultCacheKey] ?? []
		if (vaultCount < BigInt(cachedVaults.length)) {
			throw new Error(`Vault registry ${address} count ${vaultCount.toString()} is below immutable cache count ${cachedVaults.length.toString()}`)
		}
		const newVaultCount = vaultCount - BigInt(cachedVaults.length)
		const newlyRegisteredVaults = await collectCountedPages({
			count: newVaultCount,
			label: `Vault discovery for ${address}`,
			pageSize: limits.maxVaultsPerPool,
			readPage: async (start, pageCount) => await client.readContract({ abi: securityPoolAbi, address, args: [start, pageCount], blockNumber, functionName: 'getVaults' }),
		})
		if (newlyRegisteredVaults.length > 0) mutation.changed = true
		if (newVaultCount > 0n && cachedVaults.length > 0) {
			const boundary = await client.readContract({ abi: securityPoolAbi, address, args: [newVaultCount, 1n], blockNumber, functionName: 'getVaults' })
			const previousHead = cachedVaults[0]
			const boundaryVault = boundary[0]
			if (boundary.length !== 1 || boundaryVault === undefined || previousHead === undefined || !sameAddress(getAddress(boundaryVault), previousHead)) {
				throw new Error(`Vault registry ${address} no longer extends its immutable cached order`)
			}
		}
		const discoveredVaults = [...newlyRegisteredVaults.map(vault => getAddress(vault)), ...cachedVaults]
		if (BigInt(discoveredVaults.length) !== vaultCount || new Set(discoveredVaults.map(vault => vault.toLowerCase())).size !== discoveredVaults.length) {
			throw new Error(`Vault registry ${address} contains duplicate or missing immutable entries`)
		}
		topology.vaultsByPool[vaultCacheKey] = [...discoveredVaults]
		const inspectEveryVault = forkMigrationWindowIsOpen(systemState, forkActivationTime, anchorTimestamp)
		const uniqueVaults = new Map<string, Address>()
		uniqueVaults.set(wallet.toLowerCase(), wallet)
		if (inspectEveryVault) {
			for (const vault of discoveredVaults) uniqueVaults.set(vault.toLowerCase(), getAddress(vault))
		}
		const vaults = await Promise.all([...uniqueVaults.values()].map(vault => discoverVault(client, address, escalationAddress, vault, blockNumber)))
		const vaultDiscoveryComplete = inspectEveryVault || discoveredVaults.every(vault => sameAddress(vault, wallet))
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
			safeEscalationDepositMaximumsAttoRep,
			escalationGame: escalationAddress,
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
			unassignedBadDebtAttoEth: unassignedPosition[2].toString(),
			unassignedCapacityOwnershipAttoRep: unassignedPosition[1].toString(),
			unassignedRepBackingAttoRep: unassignedRepBackingAttoRep.toString(),
			unresolvedEscalationMigrationReadyOutcomes,
			universeId: universeId.toString(),
			stagedOperationCounter: stagedOperationCounter.toString(),
			vaultDiscoveryComplete,
			vaults,
			walletEscalationMaterializedOutcomes: [...materializedByOutcome],
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
		const [status, feeBps, reserves, effectiveReserves, totalSupply, walletLiquidity, pairFactory, pairPool, pairShareToken, pairUniverseId, pairQuestionId] = await Promise.all([
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
	const spendersByToken = new Map<string, Map<string, Address>>()
	for (const token of addresses.values()) {
		spendersByToken.set(
			token.toLowerCase(),
			new Map([
				[deployments.openOracle.toLowerCase(), deployments.openOracle],
				[deployments.zoltar.toLowerCase(), deployments.zoltar],
			]),
		)
	}
	const wethSpenders = spendersByToken.get(deployments.weth.toLowerCase())
	if (wethSpenders === undefined) throw new Error('WETH spender index is missing')
	for (const pool of pools) {
		wethSpenders.set(pool.coordinator.toLowerCase(), pool.coordinator)
		const repSpenders = spendersByToken.get(pool.repToken.toLowerCase())
		if (repSpenders === undefined) throw new Error(`Pool ${pool.address} REP spender index is missing`)
		repSpenders.set(pool.coordinator.toLowerCase(), pool.coordinator)
		repSpenders.set(pool.address.toLowerCase(), pool.address)
	}
	const tokens: TokenInventory[] = []
	for (const address of addresses.values()) {
		const [balance, openOracleCredit, openOracleInternalAllowanceToSelf] = await Promise.all([
			client.readContract({ abi: erc20Abi, address, args: [wallet], blockNumber, functionName: 'balanceOf' }),
			client.readContract({ abi: openOracleAbi, address: deployments.openOracle, args: [wallet, address], blockNumber, functionName: 'tokenHolder' }),
			client.readContract({ abi: openOracleAbi, address: deployments.openOracle, args: [wallet, wallet, address], blockNumber, functionName: 'internalAllowance' }),
		])
		const allowances: Record<string, string> = {}
		const spenders = spendersByToken.get(address.toLowerCase())
		if (spenders === undefined) throw new Error(`Token ${address} spender index is missing`)
		for (const spender of [...spenders.values()].sort((left, right) => left.toLowerCase().localeCompare(right.toLowerCase()))) {
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

async function discoverShareInventory(context: EcosystemDiscoveryContext, pools: readonly PoolSnapshot[], pairs: readonly PairSnapshot[], universes: readonly UniverseSnapshot[], questions: readonly QuestionSnapshot[], blockNumber: bigint) {
	const { client, deployments, wallet } = context
	const shares: ShareInventory[] = []
	const seen = new Set<string>()
	const universeById = new Map(universes.map(universe => [universe.id, universe]))
	const questionById = new Map(questions.map(question => [question.id, question]))
	const pairsByShareToken = new Map<string, PairSnapshot[]>()
	for (const pair of pairs) {
		const key = pair.shareToken.toLowerCase()
		const grouped = pairsByShareToken.get(key) ?? []
		grouped.push(pair)
		pairsByShareToken.set(key, grouped)
	}
	for (const pool of pools) {
		const key = `${pool.shareToken.toLowerCase()}:${pool.universeId}`
		if (seen.has(key)) continue
		seen.add(key)
		const base = BigInt(pool.universeId) << 8n
		const operators = new Map<string, Address>()
		operators.set(deployments.tradingRouter.toLowerCase(), deployments.tradingRouter)
		for (const pair of pairsByShareToken.get(pool.shareToken.toLowerCase()) ?? []) operators.set(pair.address.toLowerCase(), pair.address)
		const [invalid, yes, no] = await Promise.all([0n, 1n, 2n].map(outcome => client.readContract({ abi: erc1155Abi, address: pool.shareToken, args: [wallet, base | outcome], blockNumber, functionName: 'balanceOf' })))
		if (invalid === undefined || yes === undefined || no === undefined) throw new Error(`Share token ${pool.shareToken} returned incomplete balances`)
		const approvals: Record<string, boolean> = {}
		for (const operator of operators.values()) {
			approvals[operator] = await client.readContract({ abi: erc1155Abi, address: pool.shareToken, args: [wallet, operator], blockNumber, functionName: 'isApprovedForAll' })
		}
		const migrationProgressByRoute: Record<string, string> = {}
		const universe = universeById.get(pool.universeId)
		const forkQuestion = universe === undefined ? undefined : questionById.get(universe.forkQuestionId)
		const targetOutcomes = validForkOutcomeRoutes(forkQuestion, universe?.knownChildOutcomes)
		if (universe !== undefined && universe.forkTime !== '0' && targetOutcomes.length > 0) {
			const childUniverses = await Promise.all(targetOutcomes.map(targetOutcome => client.readContract({ abi: zoltarAbi, address: deployments.zoltar, args: [BigInt(pool.universeId), BigInt(targetOutcome)], blockNumber, functionName: 'getChildUniverseId' })))
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
	return await Promise.all(
		pairs.map(async pair => ({
			allowanceToRouter: (await context.client.readContract({ abi: tradingPairAbi, address: pair.address, args: [context.wallet, context.deployments.tradingRouter], blockNumber, functionName: 'allowance' })).toString(),
			balance: pair.walletLiquidity,
			pair: pair.address,
		})),
	)
}

async function discoverAuctions(context: EcosystemDiscoveryContext, pools: readonly PoolSnapshot[], blockNumber: bigint): Promise<AuctionSnapshot[]> {
	const auctions: AuctionSnapshot[] = []
	for (const pool of pools) {
		if (pool.truthAuction === zeroAddress) continue
		const started = await context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, blockNumber, functionName: 'auctionStarted' })
		const [minimumBid, finalized, pendingRefund, clearing] =
			started === 0n
				? [0n, false, 0n, [false, 0n] as const]
				: await Promise.all([
						context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, blockNumber, functionName: 'minBidSizeAttoEth' }),
						context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, blockNumber, functionName: 'finalized' }),
						context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, args: [context.wallet], blockNumber, functionName: 'pendingEthRefundsAttoEth' }),
						context.client.readContract({ abi: auctionAbi, address: pool.truthAuction, blockNumber, functionName: 'computeClearing' }),
					])
		auctions.push({
			address: pool.truthAuction,
			bids: [...(context.indexedAuctionBids?.[pool.truthAuction.toLowerCase()] ?? [])],
			endTime: (started + 7n * 24n * 60n * 60n).toString(),
			finalized,
			hasClearingPrice: clearing[0],
			clearingTick: clearing[1].toString(),
			minimumBidAttoEth: minimumBid.toString(),
			pendingEthRefund: pendingRefund.toString(),
			pool: pool.address,
			startTime: started.toString(),
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
	const block = await context.client.getBlock({ blockNumber: context.anchorBlockNumber })
	if (block.hash === null || block.hash === undefined) throw new Error('Canonical discovery anchor has no block hash')
	if (block.number === undefined) throw new Error('Canonical discovery anchor has no block number')
	if (block.number !== context.anchorBlockNumber) throw new Error(`RPC returned block ${block.number.toString()} for requested anchor ${context.anchorBlockNumber.toString()}`)
	if (context.expectedAnchorHash !== undefined && block.hash.toLowerCase() !== context.expectedAnchorHash.toLowerCase()) {
		throw new Error(`RPC anchor hash ${block.hash} does not match quorum anchor ${context.expectedAnchorHash}`)
	}
	const blockNumber = block.number
	const resolvedTopology = await immutableTopologyForAnchor(context, { hash: block.hash, number: blockNumber })
	const topology = resolvedTopology.topology
	const topologyMutation = { changed: resolvedTopology.reset }
	await authenticateConfiguredGraph(context, blockNumber)
	const warnings: string[] = []
	const [chainId, ethBalanceAttoEth, universes, questions, openOracleEthCredit] = await Promise.all([
		context.client.getChainId(),
		context.client.getBalance({ address: context.wallet, blockNumber }),
		discoverUniverses(context, blockNumber, limits, topology, topologyMutation),
		discoverQuestions(context, blockNumber, limits, topology, topologyMutation),
		context.client.readContract({ abi: openOracleAbi, address: context.deployments.openOracle, args: [context.wallet, zeroAddress], blockNumber, functionName: 'tokenHolder' }),
	])
	const { pools, staged } = await discoverPools(context, blockNumber, block.timestamp, limits, warnings, universes, questions, topology, topologyMutation)
	const pairs = await discoverPairs(context, pools, blockNumber, topology, topologyMutation)
	const indexedReports = trustedIndexedReportsForDiscovery({ deployments: context.deployments, pools, reports: context.indexedReports ?? [], universes, wallet: context.wallet })
	context = { ...context, indexedReports }
	const [tokens, shares, lpTokens, auctions, reports] = await Promise.all([
		discoverTokenInventory(context, universes, pools, blockNumber),
		discoverShareInventory(context, pools, pairs, universes, questions, blockNumber),
		discoverLpInventory(context, pairs, blockNumber),
		discoverAuctions(context, pools, blockNumber),
		verifyIndexedReports(context, blockNumber),
	])
	const snapshot: EcosystemSnapshot = {
		anchor: { blockHash: block.hash, blockNumber: blockNumber.toString(), timestamp: block.timestamp.toString() },
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

import { requireDeployedContracts } from '../../../shared/src/monitoring/deployed-contracts.js'
import { bigintToSafeNumber, getAddress, zeroAddress, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import * as abis from '@zoltar/bot-shared/contracts/abi'
import { CANONICAL_PROXY_DEPLOYER, CANONICAL_PROXY_DEPLOYER_RUNTIME, CANONICAL_UNISWAP_V3_FACTORY, GENESIS_UNISWAP_FEE, genesisUniswapSeederDeployment } from '../core/genesis-uniswap.ts'
import { canonicalUintString, type CanonicalUintString } from '../core/units.ts'
import type { AuctionSnapshot, ChildRepSplitProgressSnapshot, EcosystemSnapshot, MigrationRepSplitProgressSnapshot, OracleGameSnapshot, PairSnapshot, PoolSnapshot, QuestionSnapshot, StagedOperationSnapshot, TokenInventory, UniverseSnapshot } from '../operations/types.ts'
import { validForkOutcomeRoutes } from '../operations/fork-outcomes.ts'
import { assertAnchoredOracleRequestFunding } from '../operations/oracle-request-funding.ts'
import { cloneImmutableTopologyData, emptyCountedRegistryCursor, emptyImmutableTopologyData, IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION, IMMUTABLE_TOPOLOGY_MAXIMUM_RECORD_BYTES, type CachedPoolDeployment, type CountedRegistryCursor, type ImmutableTopologyData } from './topology-cache.ts'
import { contractSimulationReverted, DISCOVERY_RPC_CONCURRENCY, DISCOVERY_RPC_QUEUE_LIMIT, drainConcurrent, limitDiscoveryConcurrency, mapWithConcurrency, requirePositiveLimit, sameAddress, type ChaosReadClient } from './discovery-client.ts'
import { authenticatePoolProtocolBindings, assertCanonicalPairGraph, assertCanonicalPoolGraph, requireGraphEdge } from './discovery-graph.ts'
import { discoverDirectEscalationDepositQuotes, emptyDirectEscalationDepositQuote, minimumSafeVaultDeposit, projectSettlementCollateral, relevantTokenSpenders } from './discovery-escalation.ts'
import { discoverStagedOperations, discoverVault } from './discovery-staged-operations.ts'
import { forkMigrationWindowIsOpen, forkRepMigrationTarget } from './discovery-fork-migration.ts'
import { discoverShareInventory, trustedIndexedReportsForDiscovery } from './discovery-share-inventory.ts'
import { DISCOVERY_AGGREGATE_ITEM_LIMIT, limitsWithDefaults, requireAggregateDiscoveryEnvelope, type DiscoveryLimits, type EcosystemDiscoveryContext } from './discovery-context.ts'
import { advanceVaultRegistryCursor, collectCountedPages, cursorWithCanonicalCount, registryCatchUpWarning, sameRegistryCursor, updateRegistryCommitment, assertRegistryCountNotRegressed } from './discovery-registry.ts'

const UNISWAP_POOL_DISCOVERY_CONCURRENCY = Math.floor(DISCOVERY_RPC_QUEUE_LIMIT / 6)
const DISCOVERY_QUESTION_RESIDENT_UTF8_BYTES = 32 * 1024 * 1024
const OUTCOME_LABEL_PAGE_SIZE = 256n
const utf8Encoder = new TextEncoder()

type TopologyMutationState = {
	changed: boolean
}

async function discoverOutcomeLabels(client: ChaosReadClient, questionData: Address, questionId: bigint, blockNumber: bigint, limits: DiscoveryLimits) {
	const outcomeLabels: string[] = []
	let utf8Bytes = 0
	for (;;) {
		const remaining = limits.maxOutcomeLabelsPerQuestion - outcomeLabels.length
		const requested = remaining === 0 ? 1n : BigInt(Math.min(remaining, Number(OUTCOME_LABEL_PAGE_SIZE)))
		const page = await client.readContract({ abi: abis.zoltarQuestionDataAbi, address: questionData, args: [questionId, BigInt(outcomeLabels.length), requested], blockNumber, functionName: 'getOutcomeLabels' })
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

export function discoveryCoverageIsComplete(warnings: readonly string[]) {
	return !warnings.some(warning => /\bdiscovery\b.*\btruncated\b/i.test(warning))
}

function canonicalDiscoveryWarnings(warnings: readonly string[]) {
	return [...new Set(warnings)].sort((left, right) => left.localeCompare(right))
}

function compareUnsignedStrings(left: string, right: string) {
	const leftValue = BigInt(left)
	const rightValue = BigInt(right)
	if (leftValue < rightValue) return -1
	if (leftValue > rightValue) return 1
	return 0
}

async function authenticateConfiguredGraph(context: EcosystemDiscoveryContext, blockNumber: bigint) {
	const { client, deployments } = context
	const requiredRoots = ['zoltar', 'questionData', 'securityPoolFactory', 'securityPoolForker', 'openOracle', 'weth'] as const
	await requireDeployedContracts(
		client,
		requiredRoots.map(name => ({ name, address: deployments[name] })),
		blockNumber,
	)
	const [forkerZoltar, tradingFactoryCode, tradingRouterCode] = await drainConcurrent([
		client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, blockNumber, functionName: 'zoltar' }),
		client.getCode({ address: deployments.tradingFactory, blockNumber }),
		client.getCode({ address: deployments.tradingRouter, blockNumber }),
	])
	requireGraphEdge(getAddress(forkerZoltar), deployments.zoltar, 'SecurityPoolForker Zoltar edge')
	const factory = tradingFactoryCode !== undefined && tradingFactoryCode !== '0x'
	const router = tradingRouterCode !== undefined && tradingRouterCode !== '0x'
	if (router && !factory) throw new Error('Configured trading router exists without its factory')
	if (!factory) return { factory, router }
	const tradingSecurityPoolFactory = await client.readContract({ abi: abis.twoWayConstantProductFactoryAbi, address: deployments.tradingFactory, blockNumber, functionName: 'securityPoolFactory' })
	requireGraphEdge(getAddress(tradingSecurityPoolFactory), deployments.securityPoolFactory, 'Trading factory security-pool-factory edge')
	if (router) {
		const routerFactory = await client.readContract({ abi: abis.twoWayConstantProductRouterAbi, address: deployments.tradingRouter, blockNumber, functionName: 'factory' })
		requireGraphEdge(getAddress(routerFactory), deployments.tradingFactory, 'Trading router factory edge')
	}
	return { factory, router }
}

async function discoverUniverseUniswap(context: EcosystemDiscoveryContext, universes: readonly UniverseSnapshot[], blockNumber: bigint) {
	const seeder = genesisUniswapSeederDeployment()
	const uniswapFactory = context.deployments.uniswapV3Factory ?? CANONICAL_UNISWAP_V3_FACTORY
	const [factoryCode, proxyCode, seederCode] = await drainConcurrent([context.client.getCode({ address: uniswapFactory, blockNumber }), context.client.getCode({ address: CANONICAL_PROXY_DEPLOYER, blockNumber }), context.client.getCode({ address: seeder.address, blockNumber })])
	if (proxyCode !== undefined && proxyCode !== '0x' && proxyCode.toLowerCase() !== CANONICAL_PROXY_DEPLOYER_RUNTIME) throw new Error('Canonical proxy deployer has unexpected runtime code')
	if (seederCode !== undefined && seederCode !== '0x' && seederCode.toLowerCase() !== seeder.runtime.toLowerCase()) throw new Error('Genesis Uniswap seeder has unexpected runtime code')
	const authenticatedSeeder = seederCode !== undefined && seederCode !== '0x'
	const authenticatedProxy = proxyCode !== undefined && proxyCode !== '0x'
	const factory = factoryCode !== undefined && factoryCode !== '0x'
	const pools = await mapWithConcurrency(universes, UNISWAP_POOL_DISCOVERY_CONCURRENCY, async universe => {
		if (!factory) return { initialized: false, liquidity: '0', repToken: universe.repToken, universeId: universe.id }
		const pool = getAddress(await context.client.readContract({ abi: abis.genesisUniswapV3FactoryAbi, address: uniswapFactory, args: [universe.repToken, context.deployments.weth, GENESIS_UNISWAP_FEE], blockNumber, functionName: 'getPool' }))
		if (pool === zeroAddress) return { initialized: false, liquidity: '0', repToken: universe.repToken, universeId: universe.id }
		const [poolFactory, token0, token1, fee, slot0, liquidity] = await drainConcurrent([
			context.client.readContract({ abi: abis.genesisUniswapV3PoolStateAbi, address: pool, blockNumber, functionName: 'factory' }),
			context.client.readContract({ abi: abis.genesisUniswapV3PoolStateAbi, address: pool, blockNumber, functionName: 'token0' }),
			context.client.readContract({ abi: abis.genesisUniswapV3PoolStateAbi, address: pool, blockNumber, functionName: 'token1' }),
			context.client.readContract({ abi: abis.genesisUniswapV3PoolStateAbi, address: pool, blockNumber, functionName: 'fee' }),
			context.client.readContract({ abi: abis.genesisUniswapV3PoolStateAbi, address: pool, blockNumber, functionName: 'slot0' }),
			context.client.readContract({ abi: abis.genesisUniswapV3PoolStateAbi, address: pool, blockNumber, functionName: 'liquidity' }),
		])
		requireGraphEdge(getAddress(poolFactory), uniswapFactory, `Universe ${universe.id} Uniswap pool ${pool} factory edge`)
		const expected = [universe.repToken.toLowerCase(), context.deployments.weth.toLowerCase()].sort()
		const actual = [getAddress(token0).toLowerCase(), getAddress(token1).toLowerCase()].sort()
		if (actual[0] !== expected[0] || actual[1] !== expected[1] || fee !== BigInt(GENESIS_UNISWAP_FEE)) throw new Error(`Universe ${universe.id} Uniswap pool ${pool} has unexpected immutable token or fee bindings`)
		return { initialized: slot0[0] !== 0n, liquidity: liquidity.toString(), pool, repToken: universe.repToken, universeId: universe.id }
	})
	return { factory, pools, proxy: authenticatedProxy, seeder: authenticatedSeeder }
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
	const forkBurnDivisor = await client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, blockNumber, functionName: 'forkBurnDivisor' })
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
			client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, args: [universeId], blockNumber, functionName: 'universes' }),
			client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, args: [universeId], blockNumber, functionName: 'getForkThresholdAttoRep' }),
			client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, args: [universeId], blockNumber, functionName: 'getNonDecisionThresholdAttoRep' }),
			wallet === undefined ? Promise.resolve(0n) : client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, args: [wallet, universeId], blockNumber, functionName: 'getMigrationRepBalanceAttoRep' }),
		])
		const [forkTime, forkQuestionId, forkingOutcomeIndex, reputationToken, parentUniverseId] = raw
		if (reputationToken === zeroAddress) throw new Error(`Universe ${universeId.toString()} has no REP token`)
		const theoreticalSupply = await client.readContract({ abi: abis.genesisReputationTokenAbi, address: reputationToken, blockNumber, functionName: 'getTotalTheoreticalSupply' })
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
				const [pageOutcomes, pageChildIds, pageChildren] = await client.readContract({ abi: abis.zoltarAbi, address: deployments.zoltar, args: [universeId, start, requestedPageSize], blockNumber, functionName: 'getDeployedChildUniverses' })
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
	const count = await client.readContract({ abi: abis.zoltarQuestionDataAbi, address: deployments.questionData, blockNumber, functionName: 'getQuestionCount' })
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
		readPage: async (start, pageCount) => await client.readContract({ abi: abis.zoltarQuestionDataAbi, address: deployments.questionData, args: [start, pageCount], blockNumber, functionName: 'getQuestions' }),
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
				client.readContract({ abi: abis.zoltarQuestionDataAbi, address: deployments.questionData, args: [questionId], blockNumber, functionName: 'questions' }),
				client.readContract({ abi: abis.zoltarQuestionDataAbi, address: deployments.questionData, args: [questionId], blockNumber, functionName: 'questionCreatedTimestamp' }),
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
	const count = await client.readContract({ abi: abis.securityPoolFactoryAbi, address: deployments.securityPoolFactory, blockNumber, functionName: 'securityPoolDeploymentCount' })
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
		readPage: async (start, pageCount) => await client.readContract({ abi: abis.securityPoolFactoryAbi, address: deployments.securityPoolFactory, args: [start, pageCount], blockNumber, functionName: 'securityPoolDeploymentsRange' }),
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
			cachedDeployment ? Promise.resolve(authenticatedUniverse.repToken) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'repToken' }),
			cachedDeployment ? Promise.resolve(deployment.shareToken) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'shareToken' }),
			cachedDeployment ? Promise.resolve(BigInt(deployment.universeId)) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'universeId' }),
			cachedDeployment ? Promise.resolve(BigInt(deployment.questionId)) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'questionId' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'escalationGame' }),
			cachedDeployment ? Promise.resolve(deployment.truthAuction) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'truthAuction' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'systemState' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'awaitingForkContinuation' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'getPoolAccountingSnapshot' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'shareTokenSupplyAttoShares' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'totalRepBackingUnits' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'totalBadDebtAttoEth' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'minimumVaultRepDepositAttoRep' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'initialEscalationGameDepositAttoRep' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'isPriceValid' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'getRequestPriceCostAttoEth' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'settlementTime' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'lastPrice' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'lastSettlementTimestamp' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'stagedOperationCounter' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'minimumToken1ReportAttoEth' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'gasConsumedOpenOracleReportPrice' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'getSettlementCallbackGasLimit' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'gasUnitsForOneDispute' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'initialReportPriorityFeeAttoEthPerGas' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'targetPriceErrorForDispute' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'openOracleSecurityMultiplierBps' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'protocolFee' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'feePercentage' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'escalationHaltMultiplierBps' }),
			client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'pendingReportId' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'getTotalPoolHeldAttoRep' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'getVaultCount' }),
			client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'getQuestionOutcome' }),
			client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'forkData' }),
			deployment.parent === zeroAddress ? Promise.resolve(undefined) : client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, args: [deployment.parent], blockNumber, functionName: 'forkData' }),
			client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'getOwnForkMigrationStatus' }),
			wallet === undefined ? Promise.resolve([false, 0n, [false, false, false]] as const) : client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address, wallet], blockNumber, functionName: 'getEscalationMigrationEntitlementStatus' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'getCurrentMintingCapacityAttoEth' }),
			client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'statoblastSecurityMultiplierBps' }),
			client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, args: [address], blockNumber, functionName: 'getUnassignedPosition' }),
			cachedDeployment ? Promise.resolve(deployments.securityPoolFactory) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'securityPoolFactory' }),
			cachedDeployment ? Promise.resolve(deployments.securityPoolForker) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'securityPoolForker' }),
			cachedDeployment ? Promise.resolve(deployments.zoltar) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'zoltar' }),
			cachedDeployment ? Promise.resolve(deployments.questionData) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'questionData' }),
			cachedDeployment ? Promise.resolve(coordinator) : client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'priceOracleManagerAndOperatorQueuer' }),
			cachedDeployment ? Promise.resolve(address) : client.readContract({ abi: abis.openOraclePriceCoordinatorAbi, address: coordinator, blockNumber, functionName: 'securityPool' }),
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
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'canTriggerOwnFork' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'forkContinuation' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'isForkCarryFundingComplete' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'forkResumedAt' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'getEscalationGameEndDate' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'hasReachedNonDecision' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'nonDecisionState' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'startBondAttoRep' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'nonDecisionThresholdAttoRep' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'getOutcomeBalancesAttoRep' }),
						client.readContract({ abi: abis.securityPoolAbi, address, blockNumber, functionName: 'isEscalationResolved' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'forkCarrySnapshotInitialized' }),
						client.readContract({ abi: abis.escalationGameAbi, address: escalationAddress, blockNumber, functionName: 'getFinalQuestionResolution' }),
					])
		const [poolRepBalanceAttoRep, escalationRepBalanceAttoRep, unassignedRepBackingAttoRep] = await drainConcurrent([
			client.readContract({ abi: abis.genesisReputationTokenAbi, address: getAddress(repToken), args: [address], blockNumber, functionName: 'balanceOf' }),
			escalationAddress === zeroAddress ? Promise.resolve(0n) : client.readContract({ abi: abis.genesisReputationTokenAbi, address: getAddress(repToken), args: [escalationAddress], blockNumber, functionName: 'balanceOf' }),
			client.readContract({ abi: abis.securityPoolAbi, address, args: [unassignedPosition[0]], blockNumber, functionName: 'backingUnitsToAttoRep' }),
		])
		let escalationResidualSweepExpectedSuccess = false
		if (wallet !== undefined && escalationAddress !== zeroAddress) {
			try {
				await client.simulateContract({ abi: abis.escalationGameAbi, account: wallet, address: escalationAddress, blockNumber, functionName: 'sweepResidualRepToSecurityPool' })
				escalationResidualSweepExpectedSuccess = true
			} catch (error) {
				if (!contractSimulationReverted(error)) throw error
				// Principal, escrow, finality, and zero-balance guards fail closed.
			}
		}
		const safeEscalationDepositMaximumsAttoRep: [CanonicalUintString, CanonicalUintString, CanonicalUintString] = [canonicalUintString(0n), canonicalUintString(0n), canonicalUintString(0n)]
		const escalationMaximum = escalationAddress === zeroAddress ? initialEscalationDeposit : escalationStartBondAttoRep
		if (wallet !== undefined && systemState === 0n && !awaitingForkContinuation && escalationMaximum > 0n) {
			await drainConcurrent(
				[0, 1, 2].map(async outcome => {
					try {
						await client.simulateContract({ abi: abis.securityPoolAbi, account: wallet, address, args: [outcome, escalationMaximum], blockNumber, functionName: 'depositToEscalationGame' })
						safeEscalationDepositMaximumsAttoRep[outcome] = escalationMaximum.toString()
					} catch (error) {
						if (!contractSimulationReverted(error)) throw error
						// Invalid, unhealthy, and below-minimum deposits remain ineligible.
					}
				}),
			)
		}
		const directEscalationDepositQuotes =
			wallet !== undefined && escalationAddress !== zeroAddress && systemState === 0n && !awaitingForkContinuation && !escalationForkContinuation && universe.forkTime === '0'
				? await discoverDirectEscalationDepositQuotes(client, wallet, escalationAddress, escalationMaximum, escalationOutcomeBalancesAttoRep, escalationNonDecisionThresholdAttoRep, blockNumber)
				: ([emptyDirectEscalationDepositQuote(), emptyDirectEscalationDepositQuote(), emptyDirectEscalationDepositQuote()] satisfies PoolSnapshot['directEscalationDepositQuotes'])
		const pendingReportSettled = pendingReportId === 0n ? false : (await client.readContract({ abi: abis.openOracleAbi, address: deployments.openOracle, args: [pendingReportId], blockNumber, functionName: 'storedGame' })).settlementTimestamp !== 0n
		const vaultCacheKey = address.toLowerCase()
		const vaultRegistry = await advanceVaultRegistryCursor({
			cachedVaults: topology.vaultsByPool[vaultCacheKey] ?? [],
			canonicalCount: vaultCount,
			cursor: topology.discoveryCursors.vaultsByPool[vaultCacheKey],
			label: `Vault registry ${address}`,
			limit: limits.maxVaultsPerPool,
			readNewestFirstPage: async (start, pageCount) => await client.readContract({ abi: abis.securityPoolAbi, address, args: [start, pageCount], blockNumber, functionName: 'getVaults' }),
		})
		if (vaultRegistry.changed) mutation.changed = true
		topology.discoveryCursors.vaultsByPool[vaultCacheKey] = vaultRegistry.cursor
		topology.vaultsByPool[vaultCacheKey] = [...vaultRegistry.vaults]
		if (vaultRegistry.cursor.retentionMode === 'overflow' || !vaultRegistry.complete) warnings.push(registryCatchUpWarning(`Vault ${address}`, vaultRegistry.cursor))
		const inspectEveryVault = vaultRegistry.cursor.retentionMode === 'resident' && vaultRegistry.complete && forkMigrationWindowIsOpen(systemState, forkActivationTime, anchorTimestamp)
		const uniqueVaults = new Map<string, Address>()
		if (wallet !== undefined) uniqueVaults.set(wallet.toLowerCase(), wallet)
		if (inspectEveryVault) {
			for (const vault of vaultRegistry.vaults) uniqueVaults.set(vault.toLowerCase(), getAddress(vault))
		}
		const vaults = await mapWithConcurrency([...uniqueVaults.values()], DISCOVERY_RPC_CONCURRENCY, async vault => await discoverVault(client, address, escalationAddress, vault, blockNumber))
		const vaultDiscoveryComplete = vaultRegistry.cursor.retentionMode === 'resident' && vaultRegistry.complete && (inspectEveryVault || vaultRegistry.vaults.every(vault => wallet !== undefined && sameAddress(vault, wallet)))
		const walletVaultRegistered = vaultRegistry.cursor.retentionMode === 'resident' && vaultRegistry.complete && vaultRegistry.vaults.some(vault => wallet !== undefined && sameAddress(vault, wallet))
		const walletVault = vaults.find(vault => wallet !== undefined && sameAddress(vault.address, wallet))
		if (wallet !== undefined && walletVault === undefined) throw new Error(`Pool ${address} omitted the requested wallet vault`)
		const minimumSafeWalletVaultDepositAttoRep = minimumSafeVaultDeposit(minimumDeposit, BigInt(walletVault?.repBackingUnits ?? '0'), totalRepBackingUnits, poolRepBalanceAttoRep)
		const poolQuestion = questionById.get(questionId.toString())
		const forkQuestion = questionById.get(universe.forkQuestionId)
		let feeEndTimestamp: bigint | undefined
		if (universe !== undefined && poolQuestion !== undefined) feeEndTimestamp = BigInt(universe.forkTime) === 0n ? BigInt(poolQuestion.endTime) : BigInt(universe.forkTime)
		const projectedSettlementCollateral = projectSettlementCollateral(accounting, feeEndTimestamp, anchorTimestamp)
		const unresolvedEscalationMigrationReadyOutcomes: string[] = []
		if (wallet !== undefined && inspectEveryVault && forkData.unresolvedEscalationAtFork) {
			for (const outcome of validForkOutcomeRoutes(forkQuestion, universe.knownChildOutcomes)) {
				try {
					await client.simulateContract({ abi: abis.securityPoolForkerAbi, account: wallet, address: deployments.securityPoolForker, args: [address, wallet, BigInt(outcome)], blockNumber, functionName: 'migrateVaultWithUnresolvedEscalation' })
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
		const rawPair = cachedPair ?? (await client.readContract({ abi: abis.twoWayConstantProductFactoryAbi, address: deployments.tradingFactory, args: [pool.address], blockNumber, functionName: 'getPair' }))
		if (rawPair === zeroAddress) continue
		if (cachedPair === undefined) mutation.changed = true
		const address = getAddress(rawPair)
		const [status, feeBps, reserves, effectiveReserves, totalSupply, walletLiquidity, pairFactory, pairPool, pairShareToken, pairUniverseId, pairQuestionId] = await drainConcurrent([
			client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'tradingStatus' }),
			client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'feeBps' }),
			client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'getReserves' }),
			client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'getEffectiveReserves' }),
			client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'totalSupply' }),
			wallet === undefined ? Promise.resolve(0n) : client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, args: [wallet], blockNumber, functionName: 'balanceOf' }),
			cachedPair === undefined ? client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'factory' }) : Promise.resolve(deployments.tradingFactory),
			cachedPair === undefined ? client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'securityPool' }) : Promise.resolve(pool.address),
			cachedPair === undefined ? client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'shareToken' }) : Promise.resolve(pool.shareToken),
			cachedPair === undefined ? client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'universeId' }) : Promise.resolve(BigInt(pool.universeId)),
			cachedPair === undefined ? client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'questionId' }) : Promise.resolve(BigInt(pool.questionId)),
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
	if (wallet === undefined) return []
	const addresses = new Map<string, Address>()
	addresses.set(deployments.weth.toLowerCase(), deployments.weth)
	for (const universe of universes) addresses.set(universe.repToken.toLowerCase(), universe.repToken)
	const tokens: TokenInventory[] = []
	for (const address of addresses.values()) {
		const [balance, openOracleCredit, openOracleInternalAllowanceToSelf] = await drainConcurrent([
			client.readContract({ abi: abis.erc20Abi, address, args: [wallet], blockNumber, functionName: 'balanceOf' }),
			client.readContract({ abi: abis.openOracleAbi, address: deployments.openOracle, args: [wallet, address], blockNumber, functionName: 'tokenHolder' }),
			client.readContract({ abi: abis.openOracleAbi, address: deployments.openOracle, args: [wallet, wallet, address], blockNumber, functionName: 'internalAllowance' }),
		])
		const allowances: Record<string, string> = {}
		for (const spender of relevantTokenSpenders(deployments, pools, address)) {
			allowances[spender] = (await client.readContract({ abi: abis.erc20Abi, address, args: [wallet, spender], blockNumber, functionName: 'allowance' })).toString()
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

async function discoverLpInventory(context: EcosystemDiscoveryContext, pairs: readonly PairSnapshot[], blockNumber: bigint) {
	const wallet = context.wallet
	if (wallet === undefined) return []
	return await mapWithConcurrency(pairs, DISCOVERY_RPC_CONCURRENCY, async pair => ({
		allowanceToRouter: (await context.client.readContract({ abi: abis.twoWayConstantProductPairAbi, address: pair.address, args: [wallet, context.deployments.tradingRouter], blockNumber, functionName: 'allowance' })).toString(),
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
		const started = await context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'auctionStarted' })
		const [minimumBid, finalized, pendingRefund, clearing, storedClearingTick, underfunded, underfundedWinningAttoEth] =
			started === 0n
				? [0n, false, 0n, [false, 0n, 0n, 0n] as const, 0n, false, 0n]
				: await drainConcurrent([
						context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'minBidSizeAttoEth' }),
						context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'finalized' }),
						context.wallet === undefined ? Promise.resolve(0n) : context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, args: [context.wallet], blockNumber, functionName: 'pendingEthRefundsAttoEth' }),
						context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'computeClearing' }),
						context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'clearingTick' }),
						context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'underfunded' }),
						context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'underfundedWinningAttoEth' }),
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
		const stateHash = await context.client.readContract({ abi: abis.openOracleAbi, address: report.openOracle, args: [BigInt(report.reportId)], blockNumber, functionName: 'oracleGame' })
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
		context.wallet === undefined ? Promise.resolve(0n) : context.client.getBalance({ address: context.wallet, blockNumber }),
		discoverUniverses(context, blockNumber, limits, topology, topologyMutation, warnings),
		discoverQuestions(context, blockNumber, limits, topology, topologyMutation, warnings),
		context.wallet === undefined ? Promise.resolve(0n) : context.client.readContract({ abi: abis.openOracleAbi, address: context.deployments.openOracle, args: [context.wallet, zeroAddress], blockNumber, functionName: 'tokenHolder' }),
	])
	const { pools, staged } = await discoverPools(context, blockNumber, block.timestamp, block.baseFeePerGas, limits, warnings, universes, questions, topology, topologyMutation)
	const pairs = tradingDeployment.factory ? await discoverPairs(context, pools, blockNumber, topology, topologyMutation) : []
	const universeUniswap = context.deployments.uniswapV3Factory !== undefined || context.discoverGenesisDeployment ? await discoverUniverseUniswap(context, universes, blockNumber) : undefined
	const genesis = universeUniswap?.pools.find(pool => pool.universeId === '0')
	const genesisUniswap =
		context.discoverGenesisDeployment && universeUniswap !== undefined
			? { factory: universeUniswap.factory, initialized: genesis?.initialized ?? false, liquidity: genesis?.liquidity ?? '0', ...(genesis?.pool === undefined ? {} : { pool: genesis.pool }), proxy: universeUniswap.proxy, seeder: universeUniswap.seeder }
			: undefined
	const indexedReports = context.wallet === undefined ? [] : trustedIndexedReportsForDiscovery({ deployments: context.deployments, pools, reports: context.indexedReports ?? [], universes, wallet: context.wallet })
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
		...(universeUniswap === undefined ? {} : { universeUniswap }),
		universes,
		// The empty wallet is inert planning data; no account RPC uses this placeholder.
		wallet: { address: context.wallet ?? zeroAddress, ethBalanceAttoEth: ethBalanceAttoEth.toString(), lpTokens, openOracleEthCredit: openOracleEthCredit.toString(), shares, tokens },
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

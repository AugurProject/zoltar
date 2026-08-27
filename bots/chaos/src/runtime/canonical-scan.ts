import { createPublicClient, createRpcEndpointPool, defineChain, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { endpointLabel } from '@zoltar/bot-shared/monitoring/connectivity'
import { availableSettledValues, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import type { OperatorSettings } from '../config/settings.ts'
import { assertCanonicalAnchorFreshness } from '../core/canonical-freshness.ts'
import { MUTATING_CONTRACT_SURFACE } from '../contracts/surface.ts'
import { discoverEcosystemSnapshot } from '../monitoring/discovery.ts'
import { carryProofDeploymentProfileId, carryUpdateMatchingCommitment, updateCarryProofJournal } from '../monitoring/carry-proof-scan.ts'
import { archiveCarryProofJournalForProfileReset, CarryProofJournalIdentityMismatchError, loadCarryProofJournal, saveCarryProofJournal, type CarryProofJournal, type CarryProofJournalIdentity } from '../monitoring/carry-proof-journal.ts'
import { OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT, protocolIndexDiscoveryInputs, updateProtocolIndex, type ChaosProtocolIndex } from '../monitoring/protocol-index.ts'
import { immutableTopologyCacheExceedsConfiguredResidentLimits, loadImmutableTopologyCache, saveImmutableTopologyCache, validateImmutableTopologyCache, type CanonicalImmutableTopologyCache, type ImmutableTopologyIdentity, type ImmutableTopologyResidentLimits } from '../monitoring/topology-cache.ts'
import { CHAOS_OPERATION_CATALOG, canonicalLifecyclePresence, evaluateOperationCatalog } from '../operations/catalog.ts'
import type { CanonicalLifecyclePresence, EcosystemSnapshot, EvaluatedOperation, PlanningOptions } from '../operations/types.ts'
import type { WalletBalanceState } from '../state/operator-state.ts'

type RpcPool = ReturnType<typeof createRpcEndpointPool>

export type CanonicalAnchor = {
	blockHash: `0x${string}`
	blockNumber: bigint
	timestamp: bigint
}

export type CanonicalScanResult = {
	anchor: CanonicalAnchor
	canonicalLifecyclePresence: CanonicalLifecyclePresence[]
	canonicalLifecyclePresenceComplete: boolean
	evaluations: EvaluatedOperation[]
	index: ChaosProtocolIndex | undefined
	indexComplete: boolean
	carryProofJournal: CarryProofJournal
	carryProofJournalComplete: boolean
	inventory: WalletBalanceState
	snapshot: EcosystemSnapshot
	topologyCache: CanonicalImmutableTopologyCache
}

export type CanonicalScanOptions = {
	clock?: (() => number) | undefined
}

function requiredConnectivity(settings: OperatorSettings) {
	if (settings.connectivity === undefined) throw new Error('Canonical scanning requires configured RPC connectivity')
	return settings.connectivity
}

export function chaosChain(settings: OperatorSettings) {
	const connectivity = requiredConnectivity(settings)
	return defineChain({
		id: settings.network.chainId,
		name: settings.network.name,
		nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
		rpcUrls: { default: { http: [connectivity.readRpcUrl] } },
	})
}

export function chaosReadEndpoints(settings: OperatorSettings) {
	const connectivity = requiredConnectivity(settings)
	return [connectivity.readRpcUrl, ...connectivity.quorumRpcUrls]
}

export function createChaosReadPool(settings: OperatorSettings) {
	return createRpcEndpointPool(chaosReadEndpoints(settings))
}

export function chaosReadClients(settings: OperatorSettings, pool: RpcPool) {
	const chain = chaosChain(settings)
	return chaosReadEndpoints(settings).map(rpcUrl => ({
		client: createPublicClient({ chain, transport: pool.transportFor(rpcUrl) }),
		endpoint: endpointLabel(rpcUrl),
	}))
}

export function sharedCanonicalBlockNumber(heads: readonly bigint[], requiredQuorum: number) {
	if (!Number.isSafeInteger(requiredQuorum) || requiredQuorum < 1) {
		throw new Error('Canonical scan quorum must be a positive integer')
	}
	if (heads.length < requiredQuorum) {
		throw new ConnectivityDegradedError('Canonical scan does not have enough independent RPC heads for the configured quorum')
	}
	const ordered = [...heads].sort((left, right) => {
		if (left === right) return 0
		return left > right ? -1 : 1
	})
	const shared = ordered[requiredQuorum - 1]
	if (shared === undefined) throw new Error('Canonical scan quorum did not select a block')
	return shared
}

export async function canonicalAnchor(settings: OperatorSettings, pool: RpcPool, nowMilliseconds = Date.now()): Promise<CanonicalAnchor> {
	const connectivity = requiredConnectivity(settings)
	const heads = availableSettledValues(
		await Promise.allSettled(
			chaosReadClients(settings, pool).map(async observation => ({
				...observation,
				chainId: await observation.client.getChainId(),
				blockNumber: await observation.client.getBlockNumber(),
			})),
		),
	)
	if (heads.length < connectivity.rpcQuorum) {
		throw new ConnectivityDegradedError('Canonical scan does not have enough independent RPC heads for the configured quorum')
	}
	const wrongChain = heads.find(observation => observation.chainId !== settings.network.chainId)
	if (wrongChain !== undefined) {
		throw new Error(`RPC ${wrongChain.endpoint} returned chain ID ${wrongChain.chainId.toString()}, expected ${settings.network.chainId.toString()}`)
	}
	const sharedBlockNumber = sharedCanonicalBlockNumber(
		heads.map(observation => observation.blockNumber),
		connectivity.rpcQuorum,
	)
	const capableHeads = heads.filter(observation => observation.blockNumber >= sharedBlockNumber)
	const anchor = await settledQuorumValue(
		`canonical scan block ${sharedBlockNumber.toString()}`,
		capableHeads.map(async ({ client, endpoint }) => {
			const block = await client.getBlock({ blockNumber: sharedBlockNumber })
			if (block.hash == null || block.number === undefined) {
				throw new Error(`RPC ${endpoint} returned a canonical anchor without an identity`)
			}
			return {
				endpoint,
				value: {
					blockHash: block.hash,
					blockNumber: block.number,
					timestamp: block.timestamp,
				},
			}
		}),
		connectivity.rpcQuorum,
	)
	assertCanonicalAnchorFreshness(
		heads.map(observation => observation.blockNumber),
		anchor.blockNumber,
		anchor.timestamp,
		nowMilliseconds,
	)
	return anchor
}

function protocolIndexMatches(index: ChaosProtocolIndex, settings: OperatorSettings, wallet: Address) {
	return (
		index.chainId === settings.network.chainId &&
		index.openOracle.toLowerCase() === settings.deployment.openOracle.toLowerCase() &&
		index.zoltar.toLowerCase() === settings.deployment.zoltar.toLowerCase() &&
		index.securityPoolForker.toLowerCase() === settings.deployment.securityPoolForker.toLowerCase() &&
		index.startBlock === settings.runtime.protocolStartBlock.toString() &&
		index.wallet.toLowerCase() === wallet.toLowerCase()
	)
}

function uniqueAddresses(values: readonly Address[]) {
	return [...new Map(values.map(value => [value.toLowerCase(), value])).values()]
}

function escalationRoutes(snapshot: EcosystemSnapshot) {
	return [
		...new Map(
			snapshot.pools
				.filter(pool => pool.escalationGame !== zeroAddress)
				.map(pool => [
					pool.escalationGame.toLowerCase(),
					{
						escalationGame: pool.escalationGame,
						pool: pool.address,
					},
				]),
		).values(),
	]
}

function immutableTopologyIdentity(settings: OperatorSettings): ImmutableTopologyIdentity {
	return {
		chainId: settings.network.chainId,
		...settings.deployment,
	}
}

export async function loadTopologyCacheForScan(parameters: { identity: ImmutableTopologyIdentity; limits: ImmutableTopologyResidentLimits; previous?: CanonicalImmutableTopologyCache; statePath: string }) {
	try {
		return parameters.previous === undefined ? await loadImmutableTopologyCache(parameters.statePath, parameters.identity, parameters.limits) : validateImmutableTopologyCache(parameters.previous, parameters.limits)
	} catch (error) {
		if (!immutableTopologyCacheExceedsConfiguredResidentLimits(error)) throw error
		return undefined
	}
}

async function discoverWithQuorum(settings: OperatorSettings, pool: RpcPool, wallet: Address, anchor: CanonicalAnchor, index: ChaosProtocolIndex | undefined, topologyCache: CanonicalImmutableTopologyCache | undefined) {
	const connectivity = requiredConnectivity(settings)
	const indexed = index === undefined ? {} : protocolIndexDiscoveryInputs(index)
	return await settledQuorumValue(
		`ecosystem snapshot at ${anchor.blockNumber.toString()}`,
		chaosReadClients(settings, pool).map(async ({ client, endpoint }) => {
			let discoveredTopology: CanonicalImmutableTopologyCache | undefined
			let topologyChanged: boolean | undefined
			const snapshot = await discoverEcosystemSnapshot({
				anchorBlockNumber: anchor.blockNumber,
				client,
				deployments: settings.deployment,
				expectedAnchorHash: anchor.blockHash,
				limits: settings.discovery,
				...indexed,
				...(topologyCache === undefined ? {} : { topologyCache }),
				recordTopologyCache: (cache, changed) => {
					discoveredTopology = cache
					topologyChanged = changed
				},
				wallet,
			})
			if (discoveredTopology === undefined || topologyChanged === undefined) throw new Error(`RPC ${endpoint} did not produce an immutable topology checkpoint`)
			return { endpoint, value: { snapshot, topologyCache: discoveredTopology, topologyChanged } }
		}),
		connectivity.rpcQuorum,
	)
}

async function updateIndexWithQuorum(settings: OperatorSettings, pool: RpcPool, wallet: Address, anchor: CanonicalAnchor, topology: EcosystemSnapshot, previous: ChaosProtocolIndex | undefined) {
	const connectivity = requiredConnectivity(settings)
	const auctionAddresses = uniqueAddresses(topology.auctions.map(auction => auction.address))
	const games = escalationRoutes(topology)
	const coordinatorReports = topology.pools.filter(candidate => candidate.pendingReportId !== '0').map(candidate => ({ coordinator: candidate.coordinator, pendingReportId: candidate.pendingReportId, repToken: candidate.repToken }))
	const trustedRepTokens = uniqueAddresses(topology.universes.map(candidate => candidate.repToken))
	return await settledQuorumValue(
		`protocol event index through ${anchor.blockNumber.toString()}`,
		chaosReadClients(settings, pool).map(async ({ client, endpoint }) => ({
			endpoint,
			value: await updateProtocolIndex({
				anchorBlockNumber: anchor.blockNumber,
				auctionAddresses,
				chainId: settings.network.chainId,
				client,
				coordinatorReports,
				escalationGames: games,
				expectedAnchorHash: anchor.blockHash,
				maxBlockSpan: BigInt(settings.runtime.protocolLogBlockSpan),
				maximumSettlementStepGasLimit: OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT,
				openOracle: settings.deployment.openOracle,
				securityPoolForker: settings.deployment.securityPoolForker,
				...(previous === undefined ? {} : { previous }),
				startBlock: settings.runtime.protocolStartBlock,
				trustedRepTokens,
				wallet,
				weth: settings.deployment.weth,
				zoltar: settings.deployment.zoltar,
			}),
		})),
		connectivity.rpcQuorum,
	)
}

async function canonicalStartBlockHash(settings: OperatorSettings, pool: RpcPool, anchor: CanonicalAnchor) {
	const connectivity = requiredConnectivity(settings)
	if (settings.runtime.protocolStartBlock === anchor.blockNumber) return anchor.blockHash
	return await settledQuorumValue(
		`protocol start block ${settings.runtime.protocolStartBlock.toString()}`,
		chaosReadClients(settings, pool).map(async ({ client, endpoint }) => {
			const block = await client.getBlock({ blockNumber: settings.runtime.protocolStartBlock })
			if (block.hash == null || block.number !== settings.runtime.protocolStartBlock) throw new Error(`RPC ${endpoint} returned a protocol start block without an identity`)
			return { endpoint, value: block.hash }
		}),
		connectivity.rpcQuorum,
	)
}

async function updateCarryWithQuorum(settings: OperatorSettings, pool: RpcPool, wallet: Address, anchor: CanonicalAnchor, topology: EcosystemSnapshot, previous: CarryProofJournal) {
	const connectivity = requiredConnectivity(settings)
	const escalationGames = escalationRoutes(topology)
	const candidates = availableSettledValues(
		await Promise.allSettled(
			chaosReadClients(settings, pool).map(async ({ client, endpoint }) => ({
				endpoint,
				update: await updateCarryProofJournal({
					anchorBlockNumber: anchor.blockNumber,
					chainId: settings.network.chainId,
					client,
					escalationGames,
					expectedAnchorHash: anchor.blockHash,
					knownPools: topology.pools.map(candidate => candidate.address),
					maxBlockSpan: BigInt(settings.runtime.protocolLogBlockSpan),
					previous,
					profileId: carryProofDeploymentProfileId(settings),
					securityPoolForker: settings.deployment.securityPoolForker,
					startBlock: settings.runtime.protocolStartBlock,
					wallet,
				}),
			})),
		),
	)
	if (candidates.length < connectivity.rpcQuorum) throw new ConnectivityDegradedError('Carry proof scan does not have enough independent RPC results for the configured quorum')
	const commitment = await settledQuorumValue(
		`carry proof journal through ${anchor.blockNumber.toString()}`,
		candidates.map(({ endpoint, update }) => Promise.resolve({ endpoint, value: { journalDigest: update.journalDigest, withdrawalsDigest: update.withdrawalsDigest } })),
		connectivity.rpcQuorum,
	)
	return carryUpdateMatchingCommitment(
		candidates.map(candidate => candidate.update),
		commitment,
	)
}

export function snapshotWithProtocolIndex(snapshot: EcosystemSnapshot, index: ChaosProtocolIndex): EcosystemSnapshot {
	const childRepSplitsByPool = new Map<string, Record<string, string>>()
	for (const progress of index.childRepSplits) {
		const key = progress.pool.toLowerCase()
		const routes = childRepSplitsByPool.get(key) ?? {}
		routes[progress.outcomeIndex] = progress.childPoolRepSplitAttoRep
		childRepSplitsByPool.set(key, routes)
	}
	const migrationRepSplitsByUniverse = new Map<string, Record<string, string>>()
	for (const progress of index.migrationRepSplits) {
		const routes = migrationRepSplitsByUniverse.get(progress.universeId) ?? {}
		routes[progress.outcomeIndex] = progress.childMigrationRepAmountAttoRep
		migrationRepSplitsByUniverse.set(progress.universeId, routes)
	}
	return {
		...snapshot,
		auctions: snapshot.auctions.map(auction => ({
			...auction,
			bids: [...(index.auctionBids[auction.address.toLowerCase()] ?? [])],
		})),
		escalationDeposits: index.escalationDeposits.map(deposit => ({ ...deposit })),
		pools: snapshot.pools.map(pool => ({
			...pool,
			forkRepMigrationProgressByOutcome: { ...(childRepSplitsByPool.get(pool.address.toLowerCase()) ?? {}) },
		})),
		reports: index.reports.map(report => ({
			...report,
			game: { ...report.game },
			helper: { ...report.helper },
		})),
		universes: snapshot.universes.map(universe => ({
			...universe,
			migrationRepSplitProgressByOutcome: { ...(migrationRepSplitsByUniverse.get(universe.id) ?? {}) },
		})),
	}
}

export function planningOptions(settings: OperatorSettings, seed: number): PlanningOptions {
	if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
		throw new Error('Planning seed must be an unsigned 32-bit integer')
	}
	return {
		allowHighRisk: settings.strategy.allowHighRiskOperations,
		allowIrreversibleOperations: settings.strategy.allowIrreversibleOperations,
		maxEthSpendAttoEth: settings.strategy.maximumEthPerOperationAttoEth.toString(),
		maxRepSpendAttoRep: settings.strategy.maximumRepPerOperationAttoRep.toString(),
		minimumEthReserveAttoEth: settings.strategy.minimumEthReserveAttoEth.toString(),
		minimumRepReserveAttoRep: settings.strategy.minimumRepReserveAttoRep.toString(),
		seed,
	}
}

export function applyExecutionPolicy(evaluations: readonly EvaluatedOperation[], settings: OperatorSettings, indexComplete: boolean, indexedThroughBlock: string, anchorBlock: string) {
	const enabled = new Set(settings.strategy.enabledEcosystems)
	return evaluations.map(evaluation => {
		const blockers = [...evaluation.eligibility.blockers]
		if (!enabled.has(evaluation.definition.ecosystem)) {
			blockers.push(`The ${evaluation.definition.ecosystem} ecosystem is disabled by policy`)
		}
		if (settings.submission.mode === 'public' && (evaluation.plan?.deadlineTimestamp !== undefined || evaluation.plan?.lastValidBlockNumber !== undefined)) {
			blockers.push('Deadline-bound operations require private submission so the inclusion horizon is enforceable')
		}
		if (!indexComplete && (evaluation.definition.classification === 'selectable' || evaluation.definition.classification === 'lifecycle-obligation')) {
			blockers.push(`Canonical protocol index is backfilling through block ${indexedThroughBlock} of ${anchorBlock}`)
		}
		if (blockers.length === evaluation.eligibility.blockers.length) return evaluation
		return {
			definition: evaluation.definition,
			eligibility: { blockers, eligible: false },
		}
	})
}

export function blockExecutableEvaluations(evaluations: readonly EvaluatedOperation[], reason: string) {
	if (reason.trim() === '') throw new Error('An executable-operation blocker is required')
	return evaluations.map(evaluation => {
		if (evaluation.definition.classification !== 'selectable' && evaluation.definition.classification !== 'lifecycle-obligation') {
			return evaluation
		}
		return {
			definition: evaluation.definition,
			eligibility: {
				blockers: [...evaluation.eligibility.blockers, reason],
				eligible: false,
			},
		}
	})
}

export function discoveryCoverageIsComplete(warnings: readonly string[]) {
	return !warnings.some(warning => /\bdiscovery\b.*\btruncated\b/i.test(warning))
}

export function unavailableOperationCatalog(reason: string): EvaluatedOperation[] {
	if (reason.trim() === '') throw new Error('An unavailable-catalog reason is required')
	return completeOperationCoverage(
		CHAOS_OPERATION_CATALOG.map(definition => ({
			definition: {
				classification: definition.classification,
				contract: definition.contract,
				description: definition.description,
				discoveryInputs: [...definition.discoveryInputs],
				ecosystem: definition.ecosystem,
				id: definition.id,
				label: definition.label,
				method: definition.method,
				risk: definition.risk,
			},
			eligibility: { blockers: [reason], eligible: false },
		})),
	)
}

function surfaceEcosystem(contract: string): EvaluatedOperation['definition']['ecosystem'] {
	if (contract === 'Zoltar' || contract === 'ZoltarQuestionData' || contract === 'GenesisReputationToken' || contract === 'ReputationToken') {
		return 'zoltar'
	}
	if (contract === 'OpenOracle' || contract === 'WETH9') return 'open-oracle'
	if (contract === 'ShareToken' || contract === 'TwoWayConstantProductFactory' || contract === 'TwoWayConstantProductPair' || contract === 'TwoWayConstantProductRouter') {
		return 'trading'
	}
	return 'statoblast'
}

function surfaceBlocker(entry: (typeof MUTATING_CONTRACT_SURFACE)[number]) {
	if (entry.reason !== undefined) return entry.reason
	if (entry.classification === 'prerequisite') {
		return 'This method is submitted only as a prerequisite inside an eligible durable workflow'
	}
	return 'This classified protocol method has no independently executable chaos plan'
}

export function completeOperationCoverage(evaluations: readonly EvaluatedOperation[]): EvaluatedOperation[] {
	const completed = [...evaluations]
	for (const entry of MUTATING_CONTRACT_SURFACE) {
		const represented = completed.some(evaluation => (entry.operationId === undefined ? evaluation.definition.contract === entry.contract && evaluation.definition.method === entry.method : evaluation.definition.id === entry.operationId))
		if (represented) continue
		const id = entry.operationId ?? `surface.${entry.contract.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}.${entry.method.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`
		completed.push({
			definition: {
				classification: entry.classification,
				contract: entry.contract,
				description: entry.reason ?? `${entry.contract}.${entry.method} is classified as ${entry.classification.replace('-', ' ')}.`,
				discoveryInputs: [],
				ecosystem: surfaceEcosystem(entry.contract),
				id,
				label: `${entry.contract}.${entry.method}`,
				method: entry.method,
				risk: entry.classification === 'prerequisite' ? 'medium' : 'high',
			},
			eligibility: {
				blockers: [surfaceBlocker(entry)],
				eligible: false,
			},
		})
	}
	return completed
}

export function walletInventory(snapshot: EcosystemSnapshot): WalletBalanceState {
	const tokenByAddress = new Map(snapshot.wallet.tokens.map(token => [token.address.toLowerCase(), token]))
	const weth = tokenByAddress.get(snapshot.deployments.weth.toLowerCase())
	return {
		eth: snapshot.wallet.ethBalanceAttoEth,
		rep: snapshot.universes.map(universe => {
			const token = tokenByAddress.get(universe.repToken.toLowerCase())
			return {
				balance: token?.balance ?? '0',
				symbol: token?.symbol ?? 'REP',
				token: universe.repToken,
				universeId: universe.id,
			}
		}),
		weth: weth?.balance ?? '0',
	}
}

async function loadCarryJournalForScan(settings: OperatorSettings, identity: CarryProofJournalIdentity, profileResetAuthorized: boolean) {
	try {
		return await loadCarryProofJournal(settings.runtime.stateFile, identity)
	} catch (error) {
		if (!profileResetAuthorized || !(error instanceof CarryProofJournalIdentityMismatchError)) throw error
		await archiveCarryProofJournalForProfileReset(settings.runtime.stateFile)
		return await loadCarryProofJournal(settings.runtime.stateFile, identity)
	}
}

export async function performCanonicalScan(
	settings: OperatorSettings,
	pool: RpcPool,
	wallet: Address,
	seed: number,
	previousIndex: ChaosProtocolIndex | undefined,
	previousCarryProofJournal?: CarryProofJournal,
	carryProfileResetAuthorized = false,
	previousTopologyCache?: CanonicalImmutableTopologyCache,
	options: CanonicalScanOptions = {},
): Promise<CanonicalScanResult> {
	const anchor = await canonicalAnchor(settings, pool, options.clock?.() ?? Date.now())
	if (settings.runtime.protocolStartBlock > anchor.blockNumber) {
		throw new Error(`Configured protocol start block ${settings.runtime.protocolStartBlock.toString()} is ahead of canonical block ${anchor.blockNumber.toString()}`)
	}
	const compatibleIndex = previousIndex !== undefined && protocolIndexMatches(previousIndex, settings, wallet) ? previousIndex : undefined
	const startBlockHash = await canonicalStartBlockHash(settings, pool, anchor)
	const compatibleCarryJournal =
		previousCarryProofJournal ??
		(await loadCarryJournalForScan(
			settings,
			{
				chainId: settings.network.chainId,
				initialCursor: { blockHash: startBlockHash, blockNumber: settings.runtime.protocolStartBlock.toString() },
				profileId: carryProofDeploymentProfileId(settings),
				securityPoolForker: settings.deployment.securityPoolForker,
				startBlock: settings.runtime.protocolStartBlock.toString(),
			},
			carryProfileResetAuthorized,
		))
	const topologyIdentity = immutableTopologyIdentity(settings)
	const cachedTopology = await loadTopologyCacheForScan({
		identity: topologyIdentity,
		limits: settings.discovery,
		...(previousTopologyCache === undefined ? {} : { previous: previousTopologyCache }),
		statePath: settings.runtime.stateFile,
	})
	const discovery = await discoverWithQuorum(settings, pool, wallet, anchor, compatibleIndex, cachedTopology)
	if (discovery.topologyChanged) await saveImmutableTopologyCache(settings.runtime.stateFile, topologyIdentity, discovery.topologyCache, settings.discovery)
	const topology = discovery.snapshot
	const discoveryComplete = discoveryCoverageIsComplete(topology.warnings)
	const [updated, carryUpdated] = discoveryComplete ? await Promise.all([updateIndexWithQuorum(settings, pool, wallet, anchor, topology, compatibleIndex), updateCarryWithQuorum(settings, pool, wallet, anchor, topology, compatibleCarryJournal)]) : [undefined, undefined]
	const carryJournal = carryUpdated?.journal ?? compatibleCarryJournal
	await saveCarryProofJournal(settings.runtime.stateFile, carryJournal)
	const indexedThroughBlock = updated?.toBlock ?? compatibleIndex?.cursor.blockNumber ?? 'not started'
	const carryIndexedThroughBlock = carryUpdated?.toBlock ?? carryJournal.cursor.blockNumber
	const indexedSnapshot =
		updated?.complete === true
			? snapshotWithProtocolIndex(topology, updated.index)
			: {
					...topology,
					warnings: [...topology.warnings, updated === undefined ? `Protocol event index is paused at block ${indexedThroughBlock} until canonical discovery is complete` : `Protocol event index is backfilling through block ${updated.toBlock} of ${anchor.blockNumber.toString()}`],
				}
	const snapshot: EcosystemSnapshot = {
		...indexedSnapshot,
		forkedCarryWithdrawals: carryUpdated?.complete === true ? carryUpdated.withdrawals.map(candidate => ({ ...candidate, proof: { ...candidate.proof, merkleMountainRangeSiblings: [...candidate.proof.merkleMountainRangeSiblings], nullifierSiblings: [...candidate.proof.nullifierSiblings] } })) : [],
		warnings: [
			...indexedSnapshot.warnings,
			...(carryUpdated?.complete === true ? [] : [discoveryComplete ? `Carry proof journal is backfilling through block ${carryIndexedThroughBlock} of ${anchor.blockNumber.toString()}` : `Carry proof journal is paused at block ${carryIndexedThroughBlock} until canonical discovery is complete`]),
		],
	}
	const allIndexesComplete = updated?.complete === true && carryUpdated?.complete === true
	const evaluated = completeOperationCoverage(evaluateOperationCatalog(snapshot, planningOptions(settings, seed)))
	const lifecyclePresence = canonicalLifecyclePresence(snapshot, planningOptions(settings, seed))
	let evaluations = applyExecutionPolicy(evaluated, settings, allIndexesComplete, updated?.complete === true ? carryIndexedThroughBlock : indexedThroughBlock, anchor.blockNumber.toString())
	if (!discoveryCoverageIsComplete(topology.warnings)) {
		evaluations = blockExecutableEvaluations(evaluations, 'Canonical discovery reached a configured scan limit; raise the discovery limit and complete a full scan before execution')
	}
	return {
		anchor,
		carryProofJournal: carryJournal,
		carryProofJournalComplete: carryUpdated?.complete === true,
		canonicalLifecyclePresence: lifecyclePresence,
		canonicalLifecyclePresenceComplete: discoveryComplete && allIndexesComplete,
		evaluations,
		index: updated?.index ?? compatibleIndex,
		indexComplete: updated?.complete === true,
		inventory: walletInventory(snapshot),
		snapshot,
		topologyCache: discovery.topologyCache,
	}
}

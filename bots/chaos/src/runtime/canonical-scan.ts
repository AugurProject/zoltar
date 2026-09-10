import { CARRY_STORAGE_MAXIMUM_WITHDRAWALS } from '../monitoring/carry-proof-storage.ts'
import { scanCarryStorage } from '../monitoring/carry-storage-scan.ts'
import { availableHistoryExecutionReady } from './scan-readiness.ts'
import { indexWithCurrentRefunds, snapshotWithProtocolIndex } from './protocol-index-snapshot.ts'
import { createPublicClient, createRpcEndpointPool, defineChain, zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'
import { endpointLabel } from '@zoltar/bot-shared/monitoring/connectivity'
import { availableSettledValues, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError } from '@zoltar/bot-shared/monitoring/resilience'
import { MAXIMUM_DISCOVERY_AGGREGATE_ITEMS, type OperatorSettings } from '../config/settings.ts'
import { assertCanonicalAnchorFreshness } from '../core/canonical-freshness.ts'
import { MUTATING_CONTRACT_SURFACE } from '../contracts/surface.ts'
import { discoverEcosystemSnapshot, limitDiscoveryConcurrency, type ChaosReadClient } from '../monitoring/discovery.ts'
import { OPEN_ORACLE_SETTLEMENT_STEP_GAS_LIMIT, protocolIndexDiscoveryInputs, type ChaosProtocolIndex } from '../monitoring/protocol-index.ts'
import { updateProtocolIndexWithQuorum } from '../monitoring/protocol-index-quorum.ts'
import { snapshotProtocolIndex } from '../state/protocol-index-store.ts'
import { immutableTopologyCacheExceedsConfiguredResidentLimits, loadImmutableTopologyCache, saveImmutableTopologyCache, validateImmutableTopologyCache, type CanonicalImmutableTopologyCache, type ImmutableTopologyIdentity, type ImmutableTopologyResidentLimits } from '../monitoring/topology-cache.ts'
import { CHAOS_OPERATION_CATALOG, canonicalLifecyclePresence, evaluateOperationCatalog } from '../operations/catalog.ts'
import type { CanonicalLifecyclePresence, EcosystemSnapshot, EvaluatedOperation, PlanningOptions } from '../operations/types.ts'
import type { WalletBalanceState } from '../state/operator-state.ts'
import { assertOperationEthFunding } from '../execution/safety.ts'
import { genesisInitializationDefinitionIds } from './selection.ts'
import { applyLiveNoveltyInventoryReadiness } from './live-readiness.ts'

type RpcPool = ReturnType<typeof createRpcEndpointPool>

const readClientsByPool = new WeakMap<RpcPool, Map<string, ChaosReadClient>>()

export type CanonicalAnchor = {
	baseFeePerGas: bigint
	blockHash: `0x${string}`
	blockNumber: bigint
	timestamp: bigint
}

export type CanonicalScanResult = {
	anchor: CanonicalAnchor
	canonicalLifecyclePresence: CanonicalLifecyclePresence[]
	canonicalLifecyclePresenceComplete: boolean
	evaluations: EvaluatedOperation[]
	/** Current state and the available log range are ready for execution. */
	executionReady: boolean
	index: ChaosProtocolIndex | undefined
	indexComplete: boolean
	carryProofsComplete: boolean
	inventory: WalletBalanceState
	inventoryAddress?: Address | undefined
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
	let clients = readClientsByPool.get(pool)
	if (clients === undefined) {
		clients = new Map()
		readClientsByPool.set(pool, clients)
	}
	return chaosReadEndpoints(settings).map(rpcUrl => ({
		client: (() => {
			const clientKey = `${chain.id.toString()}:${rpcUrl}`
			const current = clients.get(clientKey)
			if (current !== undefined) return current
			const created = limitDiscoveryConcurrency(createPublicClient({ chain, transport: pool.transportFor(rpcUrl) }))
			clients.set(clientKey, created)
			return created
		})(),
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
			if (block.baseFeePerGas == null) throw new Error(`RPC ${endpoint} returned a canonical anchor without an EIP-1559 base fee`)
			return {
				endpoint,
				value: {
					baseFeePerGas: block.baseFeePerGas,
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

export async function discoverWithQuorum(settings: OperatorSettings, pool: RpcPool, wallet: Address | undefined, anchor: CanonicalAnchor, index: ChaosProtocolIndex | undefined, topologyCache: CanonicalImmutableTopologyCache | undefined) {
	const connectivity = requiredConnectivity(settings)
	const indexed = index === undefined ? {} : protocolIndexDiscoveryInputs(index)
	return await settledQuorumValue(
		`ecosystem snapshot at ${anchor.blockNumber.toString()}`,
		chaosReadClients(settings, pool).map(async ({ client, endpoint }) => {
			let discoveredTopology: CanonicalImmutableTopologyCache | undefined
			let topologyChanged: boolean | undefined
			const snapshot = await discoverEcosystemSnapshot({
				discoverGenesisDeployment: settings.strategy.initializeGenesisUniverse,
				anchorBlockNumber: anchor.blockNumber,
				client,
				deployments: settings.deployment,
				expectedAnchorBaseFeePerGas: anchor.baseFeePerGas,
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
	return await updateProtocolIndexWithQuorum(
		{
			anchorBlockNumber: anchor.blockNumber,
			auctionAddresses,
			chainId: settings.network.chainId,
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
		},
		chaosReadClients(settings, pool),
		connectivity.rpcQuorum,
	)
}

async function updateCarryWithQuorum(settings: OperatorSettings, pool: RpcPool, wallet: Address, anchor: CanonicalAnchor, topology: EcosystemSnapshot) {
	const connectivity = requiredConnectivity(settings)
	const candidates = availableSettledValues(
		await Promise.allSettled(
			chaosReadClients(settings, pool).map(async ({ client, endpoint }) => ({
				endpoint,
				update: await scanCarryStorage({ client, wallet, escalationGames: escalationRoutes(topology), securityPoolForker: settings.deployment.securityPoolForker, anchorBlockNumber: anchor.blockNumber, expectedAnchorHash: anchor.blockHash, maximumItems: MAXIMUM_DISCOVERY_AGGREGATE_ITEMS }),
			})),
		),
	)
	if (candidates.length < connectivity.rpcQuorum) throw new ConnectivityDegradedError('Carry storage scan does not have enough independent RPC results for the configured quorum')
	const digest = await settledQuorumValue(
		'carry proofs from anchored contract storage',
		candidates.map(({ endpoint, update }) => Promise.resolve({ endpoint, value: update.digest })),
		connectivity.rpcQuorum,
	)
	const selected = candidates.find(candidate => candidate.update.digest === digest)
	if (selected === undefined) throw new Error('Carry storage quorum result is missing')
	return selected.update
}

export function planningOptions(settings: OperatorSettings, seed: number): PlanningOptions {
	if (!Number.isSafeInteger(seed) || seed < 0 || seed > 0xffff_ffff) {
		throw new Error('Planning seed must be an unsigned 32-bit integer')
	}
	return {
		allowHighRisk: settings.strategy.allowHighRiskOperations,
		allowIrreversibleOperations: settings.strategy.allowIrreversibleOperations,
		immutableTopologyCapacity: {
			...settings.discovery,
			maximumAggregateItems: MAXIMUM_DISCOVERY_AGGREGATE_ITEMS,
		},
		maximumBlockIntervalSeconds: settings.network.maximumBlockIntervalSeconds,
		maxEthSpendAttoEth: settings.strategy.maximumEthPerOperationAttoEth.toString(),
		maximumGasCostAttoEth: settings.strategy.maximumGasCostAttoEth.toString(),
		maxRepSpendAttoRep: settings.strategy.maximumRepPerOperationAttoRep.toString(),
		minimumEthReserveAttoEth: settings.strategy.minimumEthReserveAttoEth.toString(),
		minimumRepReserveAttoRep: settings.strategy.minimumRepReserveAttoRep.toString(),
		seed,
		submissionMode: settings.submission.mode,
		workflowValidForBlocks: Number(settings.strategy.workflowValidForBlocks),
	}
}

export type ExecutionPolicyScope = 'durable-continuation' | 'novel-selection'

export function applyExecutionPolicy(evaluations: readonly EvaluatedOperation[], settings: OperatorSettings, indexComplete: boolean, indexedThroughBlock: string, anchorBlock: string, ethBalanceAttoEth: bigint, scope: ExecutionPolicyScope = 'novel-selection') {
	const enabled = new Set(settings.strategy.enabledEcosystems)
	const selectableOperationAllowlist = settings.strategy.selectableOperationAllowlist === undefined ? undefined : new Set(settings.strategy.selectableOperationAllowlist)
	return evaluations.map(evaluation => {
		const blockers = [...evaluation.eligibility.blockers]
		if (!enabled.has(evaluation.definition.ecosystem)) {
			blockers.push(`The ${evaluation.definition.ecosystem} ecosystem is disabled by policy`)
		}
		const genesisInitializerExemption = settings.strategy.initializeGenesisUniverse && genesisInitializationDefinitionIds.has(evaluation.definition.id)
		if (scope === 'novel-selection' && evaluation.definition.classification === 'selectable' && !genesisInitializerExemption && selectableOperationAllowlist !== undefined && !selectableOperationAllowlist.has(evaluation.definition.id)) {
			blockers.push('Random selection is disabled for this operation. Enable it in the operation catalog.')
		}
		if (settings.submission.mode === 'public' && evaluation.plan?.terminalSubmission !== undefined) {
			blockers.push('Terminal next-block operations require private submission so their persisted fee and inclusion ceilings are enforceable')
		} else if (settings.submission.mode === 'public' && (evaluation.plan?.deadlineTimestamp !== undefined || evaluation.plan?.lastValidBlockNumber !== undefined)) {
			blockers.push('Deadline-bound operations require private submission so the inclusion horizon is enforceable')
		}
		if (!indexComplete && (evaluation.definition.classification === 'selectable' || evaluation.definition.classification === 'lifecycle-obligation')) {
			blockers.push(`Checking existing obligations before execution: protocol history is backfilling through block ${indexedThroughBlock} of ${anchorBlock}`)
		}
		if (evaluation.plan !== undefined) {
			try {
				assertOperationEthFunding(evaluation.plan, ethBalanceAttoEth, settings.strategy)
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error)
				if (message !== `${evaluation.plan.id} cannot fund all remaining workflow steps while retaining the wallet ETH reserve`) throw error
				blockers.push(message)
			}
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
				abiEntryKind: definition.abiEntryKind ?? 'function',
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

function surfaceCoverageId(entry: (typeof MUTATING_CONTRACT_SURFACE)[number]) {
	return `surface.${entry.contract.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}.${entry.method.replaceAll(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()}`
}

export function completeOperationCoverage(evaluations: readonly EvaluatedOperation[]): EvaluatedOperation[] {
	const completed = [...evaluations]
	for (const entry of MUTATING_CONTRACT_SURFACE) {
		const coverageId = surfaceCoverageId(entry)
		const represented = completed.some(evaluation => evaluation.definition.contract === entry.contract && evaluation.definition.method === entry.method && (evaluation.definition.abiEntryKind ?? 'function') === entry.abiEntryKind)
		if (represented) continue
		const operationTarget = entry.operationId === undefined ? undefined : CHAOS_OPERATION_CATALOG.find(definition => definition.id === entry.operationId)
		const coverageExplanation = surfaceBlocker(entry)
		completed.push({
			definition: {
				abiEntryKind: entry.abiEntryKind,
				classification: entry.classification,
				contract: entry.contract,
				description: coverageExplanation,
				discoveryInputs: [],
				ecosystem: surfaceEcosystem(entry.contract),
				id: coverageId,
				independentlyExecutable: false,
				label: `${entry.contract}.${entry.method}`,
				method: entry.method,
				risk: operationTarget?.risk ?? (entry.classification === 'prerequisite' ? 'medium' : 'high'),
			},
			eligibility: {
				blockers: [coverageExplanation],
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

export async function performCanonicalScan(settings: OperatorSettings, pool: RpcPool, wallet: Address | undefined, seed: number, previousIndex: ChaosProtocolIndex | undefined, previousTopologyCache?: CanonicalImmutableTopologyCache, options: CanonicalScanOptions = {}): Promise<CanonicalScanResult> {
	const anchor = await canonicalAnchor(settings, pool, options.clock?.() ?? Date.now())
	if (settings.runtime.protocolStartBlock > anchor.blockNumber) {
		throw new Error(`Configured protocol start block ${settings.runtime.protocolStartBlock.toString()} is ahead of canonical block ${anchor.blockNumber.toString()}`)
	}
	// The event index uses an empty wallet scope for public protocol history only.
	// Discovery always receives the actual optional account, never this index scope.
	const indexWallet = wallet ?? zeroAddress
	const compatibleIndex = previousIndex !== undefined && protocolIndexMatches(previousIndex, settings, indexWallet) ? previousIndex : undefined
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
	const updatedCandidate = discoveryComplete ? await updateIndexWithQuorum(settings, pool, indexWallet, anchor, topology, compatibleIndex) : undefined
	const partialIndex = updatedCandidate?.index ?? compatibleIndex
	const historyWarning =
		partialIndex?.availableStartBlock === undefined
			? undefined
			: `Protocol log history is unavailable for blocks ${partialIndex.startBlock} through ${(BigInt(partialIndex.availableStartBlock) - 1n).toString()}; indexing available logs from block ${partialIndex.availableStartBlock} through ${partialIndex.cursor.blockNumber}. Known claims can be recovered, including carry claims verified from contract storage. Older claims may be undiscovered.`
	const carryUpdated = wallet !== undefined && discoveryComplete ? await updateCarryWithQuorum(settings, pool, wallet, anchor, topology) : undefined
	const updated = updatedCandidate === undefined ? undefined : { ...updatedCandidate, index: snapshotProtocolIndex(updatedCandidate.toBlock === anchor.blockNumber.toString() ? indexWithCurrentRefunds(topology, updatedCandidate.index) : updatedCandidate.index, settings.network.chainId) }
	const indexedThroughBlock = updated?.toBlock ?? compatibleIndex?.cursor.blockNumber ?? 'not started'
	const indexedSnapshot =
		updated !== undefined && updated.toBlock === anchor.blockNumber.toString()
			? snapshotWithProtocolIndex(topology, updated.index)
			: {
					...topology,
					warnings: [...topology.warnings, updated === undefined ? `Protocol event index is paused at block ${indexedThroughBlock} until canonical discovery is complete` : `Protocol event index is backfilling through block ${updated.toBlock} of ${anchor.blockNumber.toString()}`],
				}
	const snapshot: EcosystemSnapshot = {
		...indexedSnapshot,
		forkedCarryWithdrawalPresence: carryUpdated?.complete === true ? carryUpdated.withdrawalPresence.map(candidate => ({ ...candidate })) : [],
		forkedCarryWithdrawals: carryUpdated?.complete === true ? carryUpdated.withdrawals.map(candidate => ({ ...candidate, proof: { ...candidate.proof, merkleMountainRangeSiblings: [...candidate.proof.merkleMountainRangeSiblings], nullifierSiblings: [...candidate.proof.nullifierSiblings] } })) : [],
		warnings: [
			...indexedSnapshot.warnings,
			...(historyWarning === undefined ? [] : [historyWarning]),
			...(wallet === undefined || carryUpdated?.complete === true ? [] : ['Carry proof storage discovery is incomplete']),
			...(carryUpdated?.complete === true && carryUpdated.withdrawalCandidateCount > CARRY_STORAGE_MAXIMUM_WITHDRAWALS
				? [`Carry proof action verification is rotating up to ${CARRY_STORAGE_MAXIMUM_WITHDRAWALS.toString()} anchored proofs across ${carryUpdated.withdrawalCandidateCount.toString()} raw unconsumed wallet identities; lifecycle presence remains complete`]
				: []),
		],
	}
	const allIndexesComplete = updated?.complete === true && carryUpdated?.complete === true
	const executionReady = wallet !== undefined && availableHistoryExecutionReady(updated?.index, anchor.blockNumber, discoveryComplete, carryUpdated?.complete === true)
	const evaluated = wallet === undefined ? unavailableOperationCatalog('No execution account configured') : completeOperationCoverage(evaluateOperationCatalog(snapshot, planningOptions(settings, seed)))
	const lifecyclePresence = wallet === undefined ? [] : canonicalLifecyclePresence(snapshot, planningOptions(settings, seed))
	const inventory = walletInventory(snapshot)
	let evaluations = applyExecutionPolicy(evaluated, settings, executionReady, indexedThroughBlock, anchor.blockNumber.toString(), BigInt(snapshot.wallet.ethBalanceAttoEth))
	if (settings.runtime.execute) evaluations = applyLiveNoveltyInventoryReadiness(evaluations, inventory, snapshot.universes, settings.strategy)
	if (!discoveryCoverageIsComplete(topology.warnings)) {
		evaluations = blockExecutableEvaluations(evaluations, 'Canonical discovery reached a configured scan limit; raise the discovery limit and complete a full scan before execution')
	}
	return {
		anchor,
		carryProofsComplete: carryUpdated?.complete === true,
		canonicalLifecyclePresence: lifecyclePresence,
		canonicalLifecyclePresenceComplete: discoveryComplete && allIndexesComplete,
		evaluations,
		executionReady,
		index: updated?.index ?? compatibleIndex,
		indexComplete: updated?.complete === true,
		inventory,
		inventoryAddress: discoveryComplete ? wallet : undefined,
		snapshot,
		topologyCache: discovery.topologyCache,
	}
}

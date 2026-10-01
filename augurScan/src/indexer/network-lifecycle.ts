import { runtimeConfig } from '../config.ts'
import type { IndexerLease, PersistedIndexerOwnershipState } from '../database.ts'
import type { Hash } from '../ethereum.ts'
import {
	ChainConfigurationError,
	databaseFailureMessage,
	findEarliestAvailableLogProvider,
	isLocalIndexerFailure,
	isPermanentHistoricalLogError,
	recordOwnershipEvent,
	rpcFailureLogMessage,
	rpcQueueSaturatedMessage,
	runIndexerOwnershipLifecycle,
	runOwnedNetworkLifecycle,
	safeIndexerFailureReason,
	withVerifiedProvider,
} from '../indexer-runtime.ts'
import { type IndexerRpcProvider, initialIndexStartBlock, manifestChangeRequiresFullReplay } from './planning.ts'
import { discoverStateStartBlock, findManifestDeployment, historicalCodeUnavailable, selectProvider } from './network-provider.ts'
import { assertLease, type NetworkIndexerState, requireLease } from './network-state.ts'
import { poll, reconcileManifestBackfill } from './network-synchronization.ts'

const OWNERSHIP_EVENT_STATES = new Map<string, PersistedIndexerOwnershipState>([
	['acquired', 'owned'],
	['standby', 'standby'],
	['released', 'released'],
	['release-failed', 'release-failed'],
])
const persistedOwnershipState = (eventType: string): PersistedIndexerOwnershipState => OWNERSHIP_EVENT_STATES.get(eventType) ?? 'unknown'
const SEED_REPLAY_REASONS = new Map<string | undefined, string>([
	['abi-redecode', 'ABI snapshot changed'],
	['projection-rebuild', 'projection source changed'],
])
export async function run(state: NetworkIndexerState): Promise<void> {
	console.info(`[${state.network.id}] indexer state: starting`)
	console.info(`[${state.network.id}] RPC providers: ${state.providers.list.map(({ endpoint }) => endpoint).join(', ')}`)
	await runIndexerOwnershipLifecycle({
		networkId: state.network.id,
		onEvent: async event => {
			recordOwnershipEvent(state.network.id, event)
			await state.database.recordIndexerOwnership(state.network.chainId, state.network.id, persistedOwnershipState(event.type), 'backendPid' in event ? event.backendPid : undefined, state.provenance?.indexerRunId)
		},
		acquire: () => state.database.tryAcquireIndexerLock(state.network.chainId),
		seed: lease => seed(state, lease),
		runOwned: async lease => {
			state.lease = lease
			try {
				await runOwnedNetworkLifecycle({
					reconcile: () => reconcileManifestBackfill(state),
					poll: () => poll(state),
					runWithProvider: operation => withProviderFailover(state, operation),
					failure: (message, nextRetryAt, reason) => recordFailure(state, message, nextRetryAt, requireLease(state), reason),
					recover: error => recoverPrunedLogFailure(state, error),
					intervalMs: runtimeConfig.pollIntervalMs,
					signal: state.signal,
				})
			} finally {
				state.lease = undefined
			}
		},
		failure: async (message, lease) => {
			if (lease === undefined) {
				console.error(`[${state.network.id}] indexer state: degraded; ownership unavailable: ${message}`)
				return
			}
			await recordFailure(state, message, new Date(Date.now() + runtimeConfig.pollIntervalMs), lease)
		},
		standby: () => console.info(`[${state.network.id}] indexer state: standby; another replica owns the network indexer lock`),
		intervalMs: runtimeConfig.pollIntervalMs,
		signal: state.signal,
	})
}

async function seed(state: NetworkIndexerState, lease: IndexerLease): Promise<void> {
	const [checkpoint, storedStartBlock, storedBlockTip] = await Promise.all([state.database.checkpoint(state.network.chainId, lease), state.database.networkStartBlock(state.network.chainId, lease), state.database.storedBlockTip(state.network.chainId, lease)])
	let retainedBoundary = checkpoint?.number ?? storedBlockTip
	if (storedStartBlock !== undefined) {
		if (state.configuredStartBlock > storedStartBlock) {
			await state.database.seedNetwork(state.network, {
				lease,
				resetCanonicalHistoryOnManifestChange: true,
				preserveStoredStart: true,
				appliedSourceHashes: state.provenance,
			})
			throw new Error('Stored history boundary validation unexpectedly succeeded')
		}
		state.network = { ...state.network, startBlock: storedStartBlock }
		const observedHead = await withProviderFailover(state, async () => {
			const head = await state.providers.client.getBlockNumber()
			await discoverStateStartBlock(state, head)
			return head
		})
		if (retainedBoundary === undefined) retainedBoundary = observedHead
		await validateManifestChange(state, retainedBoundary, storedStartBlock, lease)
		const manifestChanged = await seedNetwork(state, lease)
		if (checkpoint !== undefined && manifestChanged) reportManifestReplay(state, checkpoint)
		return
	}
	await withProviderFailover(state, async () => {
		const observedHead = await state.providers.client.getBlockNumber()
		await discoverStateStartBlock(state, observedHead)
		const startBlock = await initialIndexStartBlock(state.network.contracts, state.configuredStartBlock, observedHead, (address, searchStart, indexedBoundary, startBlockKnownAbsent) => findManifestDeployment(state, address, searchStart, indexedBoundary, startBlockKnownAbsent))
		state.network = { ...state.network, startBlock }
		console.info(`[${state.network.id}] initial index boundary: block #${startBlock}; earliest tracked deployment discovered through observed head #${observedHead}`)
	})
	const manifestChanged = await seedNetwork(state, lease)
	if (checkpoint !== undefined && manifestChanged) reportManifestReplay(state, checkpoint)
}

async function seedNetwork(state: NetworkIndexerState, lease: IndexerLease): Promise<boolean> {
	const replayPlan = state.provenance === undefined ? undefined : await state.database.sourceReplayPlan(state.network.chainId, state.provenance, lease)
	const changed = await state.database.seedNetwork(state.network, {
		lease,
		resetCanonicalHistoryOnManifestChange: true,
		preserveStoredStart: true,
		sourceReplayPlan: replayPlan,
		appliedSourceHashes: state.provenance,
	})
	state.lastSeedReplayReason = changed ? replayPlan?.reason : undefined
	return changed
}

async function validateManifestChange(state: NetworkIndexerState, checkpoint: bigint, storedStartBlock: bigint, lease: IndexerLease): Promise<void> {
	const [storedContracts, cursors] = await Promise.all([state.database.contracts(state.network.chainId, lease), state.database.logScanCursors(state.network.chainId, lease)])
	await withProviderFailover(state, () =>
		manifestChangeRequiresFullReplay(state.network.contracts, storedContracts, cursors, checkpoint, state.configuredStartBlock, storedStartBlock, (address, searchStart, indexedBoundary, startBlockKnownAbsent) => findManifestDeployment(state, address, searchStart, indexedBoundary, startBlockKnownAbsent)),
	)
}

function reportManifestReplay(state: Pick<NetworkIndexerState, 'network' | 'lastSeedReplayReason'>, checkpoint: { readonly number: bigint; readonly hash: Hash }): void {
	const reason = SEED_REPLAY_REASONS.get(state.lastSeedReplayReason) ?? 'canonical manifest changed'
	state.lastSeedReplayReason = undefined
	console.info(`[${state.network.id}] ${reason} at indexed block #${checkpoint.number}; replaying canonical interpretations from block #${state.network.startBlock}`)
}

async function withProviderFailover<T>(state: Pick<NetworkIndexerState, 'network' | 'providers' | 'stateBoundary'>, operation: () => Promise<T>): Promise<T> {
	state.providers.failoverSawPrunedLogFailure = false
	return await withVerifiedProvider(
		state.providers.list,
		state.network.chainId,
		async provider => {
			selectProvider(state, provider)
			return await operation()
		},
		isLocalIndexerFailure,
		provider => selectProvider(state, provider),
		state.providers.verified,
		(_provider, error) => {
			if (isPermanentHistoricalLogError(error)) state.providers.failoverSawPrunedLogFailure = true
		},
	)
}

async function recordFailure(state: Pick<NetworkIndexerState, 'database' | 'network' | 'providers' | 'progress'>, message: string, nextRetryAt: Date, lease: IndexerLease, reason?: string): Promise<void> {
	await state.database.recordFailure(state.network.chainId, message, nextRetryAt, lease)
	const localFailure = message === databaseFailureMessage || message === rpcQueueSaturatedMessage
	const logMessage = localFailure ? `${message}${reason === undefined ? '' : ` (reason: ${reason})`}` : rpcFailureLogMessage(message, state.providers.diagnostics.activeEndpoint(), reason)
	state.progress.lastReportedPhase = 'degraded'
	console.error(`[${state.network.id}] indexer state: degraded; ${logMessage}`)
}

async function advancePastPrunedLogs(state: NetworkIndexerState, provider: IndexerRpcProvider, availableStart: bigint): Promise<void> {
	const previousStart = state.network.startBlock
	selectProvider(state, provider)
	if (availableStart === previousStart) {
		console.warn(`[${state.network.id}] selected ${provider.endpoint}, which can serve the existing log coverage floor #${availableStart}; continuing without changing coverage`)
		return
	}
	await assertLease(state)
	await state.database.advanceNetworkStartBlock(state.network.chainId, availableStart, requireLease(state), state.provenance)
	state.network = { ...state.network, startBlock: availableStart }
	historicalCodeUnavailable(state.providers).clear()
	state.progress.indexingStartReported = false
	state.progress.sample = undefined
	state.progress.lastReportedPhase = undefined
	state.progress.lastDeploymentScanAt = undefined
	console.warn(`[${state.network.id}] RPC log history before block #${availableStart} is pruned; advanced index coverage from block #${previousStart} to earliest retrievable block #${availableStart} using ${provider.endpoint} and continuing`)
}

async function recoverPrunedLogFailure(state: NetworkIndexerState, error: unknown): Promise<boolean> {
	if (isLocalIndexerFailure(error)) return false
	if (!isPermanentHistoricalLogError(error) && !state.providers.failoverSawPrunedLogFailure) return false
	const availability = await findEarliestAvailableLogProvider(
		state.providers.list,
		state.network.startBlock,
		async provider => {
			if (!state.providers.verified.has(provider)) {
				const remoteChainId = await provider.getChainId()
				if (remoteChainId !== state.network.chainId) throw new ChainConfigurationError(`RPC chain mismatch: configured ${state.network.chainId}, received ${remoteChainId}`)
				state.providers.verified.add(provider)
			}
			return await provider.client.getBlockNumber()
		},
		async ({ logClient }, blockNumber) => {
			await logClient.getLogs({ fromBlock: blockNumber, toBlock: blockNumber })
		},
		(provider, providerError) => {
			console.warn(`[${state.network.id}] skipped ${provider.endpoint} while locating retrievable log history; ${safeIndexerFailureReason(providerError)}`)
		},
	)
	if (availability === undefined) return false
	await advancePastPrunedLogs(state, availability.provider, availability.startBlock)
	return true
}

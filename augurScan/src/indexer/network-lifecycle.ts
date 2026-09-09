import { runtimeConfig } from '../config.ts'
import type { IndexerLease } from '../database.ts'
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
import { NetworkIndexerProvider } from './network-provider.ts'
import { type IndexerRpcProvider, initialIndexStartBlock, manifestChangeRequiresFullReplay } from './planning.ts'

export abstract class NetworkIndexerLifecycle extends NetworkIndexerProvider {
	protected abstract reconcileManifestBackfill(): Promise<void>
	protected abstract poll(): Promise<boolean>
	protected abstract assertLease(): Promise<void>
	protected abstract requireLease(): IndexerLease

	async run(): Promise<void> {
		console.info(`[${this.network.id}] indexer state: starting`)
		console.info(`[${this.network.id}] RPC providers: ${this.providers.map(({ endpoint }) => endpoint).join(', ')}`)
		await runIndexerOwnershipLifecycle({
			networkId: this.network.id,
			onEvent: async event => {
				recordOwnershipEvent(this.network.id, event)
				await this.database.recordIndexerOwnership(
					this.network.chainId,
					this.network.id,
					event.type === 'acquired' ? 'owned' : event.type === 'standby' ? 'standby' : event.type === 'released' ? 'released' : event.type === 'release-failed' ? 'release-failed' : 'unknown',
					'backendPid' in event ? event.backendPid : undefined,
					this.provenance?.indexerRunId,
				)
			},
			acquire: () => this.database.tryAcquireIndexerLock(this.network.chainId),
			seed: lease => this.seed(lease),
			runOwned: async lease => {
				this.lease = lease
				try {
					await runOwnedNetworkLifecycle({
						reconcile: () => this.reconcileManifestBackfill(),
						poll: () => this.poll(),
						runWithProvider: operation => this.withProviderFailover(operation),
						failure: (message, nextRetryAt, reason) => this.recordFailure(message, nextRetryAt, this.requireLease(), reason),
						recover: error => this.recoverPrunedLogFailure(error),
						intervalMs: runtimeConfig.pollIntervalMs,
						signal: this.signal,
					})
				} finally {
					this.lease = undefined
				}
			},
			failure: async (message, lease) => {
				if (lease === undefined) {
					console.error(`[${this.network.id}] indexer state: degraded; ownership unavailable: ${message}`)
					return
				}
				await this.recordFailure(message, new Date(Date.now() + runtimeConfig.pollIntervalMs), lease)
			},
			standby: () => console.info(`[${this.network.id}] indexer state: standby; another replica owns the network indexer lock`),
			intervalMs: runtimeConfig.pollIntervalMs,
			signal: this.signal,
		})
	}

	protected async seed(lease: IndexerLease): Promise<void> {
		const [checkpoint, storedStartBlock, storedBlockTip] = await Promise.all([this.database.checkpoint(this.network.chainId, lease), this.database.networkStartBlock(this.network.chainId, lease), this.database.storedBlockTip(this.network.chainId, lease)])
		let retainedBoundary = checkpoint?.number ?? storedBlockTip
		if (storedStartBlock !== undefined) {
			if (this.configuredStartBlock > storedStartBlock) {
				await this.database.seedNetwork(this.network, {
					lease,
					resetCanonicalHistoryOnManifestChange: true,
					preserveStoredStart: true,
					appliedSourceHashes: this.provenance,
				})
				throw new Error('Stored history boundary validation unexpectedly succeeded')
			}
			this.network = { ...this.network, startBlock: storedStartBlock }
			const observedHead = await this.withProviderFailover(async () => {
				const head = await this.client.getBlockNumber()
				await this.discoverStateStartBlock(head)
				return head
			})
			if (retainedBoundary === undefined) retainedBoundary = observedHead
			await this.validateManifestChange(retainedBoundary, storedStartBlock, lease)
			const manifestChanged = await this.seedNetwork(lease)
			if (checkpoint !== undefined && manifestChanged) this.reportManifestReplay(checkpoint)
			return
		}
		await this.withProviderFailover(async () => {
			const observedHead = await this.client.getBlockNumber()
			await this.discoverStateStartBlock(observedHead)
			const startBlock = await initialIndexStartBlock(this.network.contracts, this.configuredStartBlock, observedHead, (address, searchStart, indexedBoundary, startBlockKnownAbsent) => this.findManifestDeployment(address, searchStart, indexedBoundary, startBlockKnownAbsent))
			this.network = { ...this.network, startBlock }
			console.info(`[${this.network.id}] initial index boundary: block #${startBlock}; earliest tracked deployment discovered through observed head #${observedHead}`)
		})
		const manifestChanged = await this.seedNetwork(lease)
		if (checkpoint !== undefined && manifestChanged) this.reportManifestReplay(checkpoint)
	}

	protected async seedNetwork(lease: IndexerLease): Promise<boolean> {
		const replayPlan = this.provenance === undefined ? undefined : await this.database.sourceReplayPlan(this.network.chainId, this.provenance, lease)
		const changed = await this.database.seedNetwork(this.network, {
			lease,
			resetCanonicalHistoryOnManifestChange: true,
			preserveStoredStart: true,
			sourceReplayPlan: replayPlan,
			appliedSourceHashes: this.provenance,
		})
		this.lastSeedReplayReason = changed ? replayPlan?.reason : undefined
		return changed
	}

	protected async validateManifestChange(checkpoint: bigint, storedStartBlock: bigint, lease: IndexerLease): Promise<void> {
		const [storedContracts, cursors] = await Promise.all([this.database.contracts(this.network.chainId, lease), this.database.logScanCursors(this.network.chainId, lease)])
		await this.withProviderFailover(() =>
			manifestChangeRequiresFullReplay(this.network.contracts, storedContracts, cursors, checkpoint, this.configuredStartBlock, storedStartBlock, (address, searchStart, indexedBoundary, startBlockKnownAbsent) => this.findManifestDeployment(address, searchStart, indexedBoundary, startBlockKnownAbsent)),
		)
	}

	protected reportManifestReplay(checkpoint: { readonly number: bigint; readonly hash: Hash }): void {
		const reason = this.lastSeedReplayReason === 'abi-redecode' ? 'ABI snapshot changed' : this.lastSeedReplayReason === 'projection-rebuild' ? 'projection source changed' : 'canonical manifest changed'
		this.lastSeedReplayReason = undefined
		console.info(`[${this.network.id}] ${reason} at indexed block #${checkpoint.number}; replaying canonical interpretations from block #${this.network.startBlock}`)
	}

	protected async withProviderFailover<T>(operation: () => Promise<T>): Promise<T> {
		this.failoverSawPrunedLogFailure = false
		return await withVerifiedProvider(
			this.providers,
			this.network.chainId,
			async provider => {
				this.selectProvider(provider)
				return await operation()
			},
			isLocalIndexerFailure,
			provider => this.selectProvider(provider),
			this.verifiedProviders,
			(_provider, error) => {
				if (isPermanentHistoricalLogError(error)) this.failoverSawPrunedLogFailure = true
			},
		)
	}

	protected rpcFailureReason(error: unknown): string {
		return this.rpcDiagnostics.failureReason(error)
	}

	protected async recordFailure(message: string, nextRetryAt: Date, lease: IndexerLease, reason?: string): Promise<void> {
		await this.database.recordFailure(this.network.chainId, message, nextRetryAt, lease)
		const localFailure = message === databaseFailureMessage || message === rpcQueueSaturatedMessage
		const logMessage = localFailure ? `${message}${reason === undefined ? '' : ` (reason: ${reason})`}` : rpcFailureLogMessage(message, this.rpcDiagnostics.activeEndpoint(), reason)
		this.lastReportedPhase = 'degraded'
		console.error(`[${this.network.id}] indexer state: degraded; ${logMessage}`)
	}

	protected async advancePastPrunedLogs(provider: IndexerRpcProvider, availableStart: bigint): Promise<void> {
		const previousStart = this.network.startBlock
		this.selectProvider(provider)
		if (availableStart === previousStart) {
			console.warn(`[${this.network.id}] selected ${provider.endpoint}, which can serve the existing log coverage floor #${availableStart}; continuing without changing coverage`)
			return
		}
		await this.assertLease()
		await this.database.advanceNetworkStartBlock(this.network.chainId, availableStart, this.requireLease(), this.provenance)
		this.network = { ...this.network, startBlock: availableStart }
		this.historicalCodeUnavailable().clear()
		this.indexingStartReported = false
		this.lastProgressLogAt = undefined
		this.progressSample = undefined
		this.lastReportedPhase = undefined
		this.lastDeploymentScanAt = undefined
		console.warn(`[${this.network.id}] RPC log history before block #${availableStart} is pruned; advanced index coverage from block #${previousStart} to earliest retrievable block #${availableStart} using ${provider.endpoint} and continuing`)
	}

	protected async recoverPrunedLogFailure(error: unknown): Promise<boolean> {
		if (isLocalIndexerFailure(error)) return false
		if (!isPermanentHistoricalLogError(error) && !this.failoverSawPrunedLogFailure) return false
		const availability = await findEarliestAvailableLogProvider(
			this.providers,
			this.network.startBlock,
			async provider => {
				if (!this.verifiedProviders.has(provider)) {
					const remoteChainId = await provider.getChainId()
					if (remoteChainId !== this.network.chainId) throw new ChainConfigurationError(`RPC chain mismatch: configured ${this.network.chainId}, received ${remoteChainId}`)
					this.verifiedProviders.add(provider)
				}
				return await provider.client.getBlockNumber()
			},
			async ({ logClient }, blockNumber) => {
				await logClient.getLogs({ fromBlock: blockNumber, toBlock: blockNumber })
			},
			(provider, providerError) => {
				console.warn(`[${this.network.id}] skipped ${provider.endpoint} while locating retrievable log history; ${safeIndexerFailureReason(providerError)}`)
			},
		)
		if (availability === undefined) return false
		await this.advancePastPrunedLogs(availability.provider, availability.startBlock)
		return true
	}
}

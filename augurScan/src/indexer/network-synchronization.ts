import { type ContractDeploymentObservation, DatabaseConsistencyError, type IndexedBlock, type IndexerLease } from '../database.ts'
import { errorChainIncludes } from '../error-chain.ts'
import type { Address, Hash, Log } from '../ethereum.ts'
import {
	ChainContinuityError,
	commitSparseCanonicalBatch,
	contractDeploymentCandidateFrom,
	contractDeploymentScanDue,
	deploymentReadBudget,
	findSparseCanonicalAncestor,
	indexerLogSources,
	indexerOperationFailureReason,
	indexerProgressMessage,
	indexerWaitingMessage,
	indexingCompletion,
	isPrunedHistoricalStateError,
	LeaseLostError,
	leaseFailureNames,
	readHistoricalCodeWithPermanentFallback,
	scanDiscoveredLogCoverage,
} from '../indexer-runtime.ts'
import { rpcQueueSaturationFrom } from '../rpc-request-queue.ts'
import { bigintToSafeNumber, unixSecondsToDate } from '../time.ts'
import type { ContractMetadata, TokenMetadata } from '../types.ts'
import { NetworkIndexerLifecycle } from './network-lifecycle.ts'
import { findContractDeploymentBlock, type LogScanInput, logScanCursorUpdates, manifestReplayAncestor, planManifestBackfill, type RpcBlockHeader, reorgSearchFloor } from './planning.ts'

export abstract class NetworkIndexerSynchronization extends NetworkIndexerLifecycle {
	protected abstract refreshRichListBalances(blockNumber: bigint, blockHash: Hash): Promise<void>
	protected abstract refreshEntityStateSnapshots(blockNumber: bigint, blockHash: Hash): Promise<void>
	protected abstract getNextLogSegment(
		fromBlock: bigint,
		maximumToBlock: bigint,
		contracts: readonly ContractMetadata[],
	): Promise<{
		readonly toBlock: bigint
		readonly logs: readonly Log[]
		readonly endBlockHash?: Hash
		readonly endBlockHeader?: RpcBlockHeader
		readonly scanInputs: readonly LogScanInput[]
		readonly deploymentObservations: readonly ContractDeploymentObservation[]
	}>
	protected abstract mergeLogs(target: Map<bigint, Log[]>, logs: readonly Log[]): void
	protected abstract getKnownLogs(blockNumber: bigint, addresses: readonly Address[], contracts: ReadonlyMap<string, ContractMetadata>, blockHash: Hash): Promise<Log[]>
	protected abstract getAllLogs(fromBlock: bigint, toBlock: bigint, addresses: readonly Address[], contracts: ReadonlyMap<string, ContractMetadata>, expectedBlockHash: (blockNumber: bigint) => Promise<Hash>): Promise<readonly Log[]>
	protected abstract indexBlock(
		number: bigint,
		observedHead: bigint,
		currentContracts: ReadonlyMap<string, ContractMetadata>,
		currentTokenMetadata: ReadonlyMap<string, TokenMetadata>,
		expectedParentHash: Hash | undefined,
		block: RpcBlockHeader,
		prefetchedLogs: readonly Log[],
		getDiscoveredLogs: (addresses: readonly Address[], contracts: ReadonlyMap<string, ContractMetadata>) => Promise<readonly Log[]>,
	): Promise<{ block: IndexedBlock; contracts: Map<string, ContractMetadata>; tokenMetadata: Map<string, TokenMetadata> }>

	protected reportProgress(startBlock: bigint, endBlock: bigint, observedHead: bigint): void {
		const phase = endBlock >= observedHead ? 'live' : 'backfilling'
		const now = Date.now()
		const previousSample = this.progressSample
		let blocksPerSecond = previousSample?.blocksPerSecond
		if (previousSample !== undefined && endBlock > previousSample.block && now - previousSample.sampledAt >= 1_000) {
			const observedRate = bigintToSafeNumber(endBlock - previousSample.block, 'Indexer progress block count') / ((now - previousSample.sampledAt) / 1_000)
			blocksPerSecond = blocksPerSecond === undefined ? observedRate : blocksPerSecond * 0.7 + observedRate * 0.3
			this.progressSample = { block: endBlock, sampledAt: now, blocksPerSecond }
		} else if (previousSample === undefined || endBlock < previousSample.block) {
			this.progressSample = { block: endBlock, sampledAt: now }
		}
		if (phase === 'backfilling' && this.lastReportedPhase === phase && this.lastProgressLogAt !== undefined && now - this.lastProgressLogAt < 30_000) return
		this.lastReportedPhase = phase
		this.lastProgressLogAt = now
		console.info(indexerProgressMessage(this.network.id, startBlock, endBlock, observedHead, this.network.startBlock, blocksPerSecond))
	}

	protected reportWaitingForStart(observedHead: bigint): void {
		if (this.lastReportedPhase === 'live') return
		this.lastReportedPhase = 'live'
		this.lastProgressLogAt = Date.now()
		console.info(indexerWaitingMessage(this.network.id, this.network.startBlock, observedHead))
	}

	protected async assertLease(): Promise<void> {
		try {
			await this.requireLease().assertHeld()
		} catch (error) {
			throw new LeaseLostError('Indexer lease was lost; reacquiring', { cause: error })
		}
	}

	protected requireLease(): IndexerLease {
		if (this.lease === undefined) throw new LeaseLostError('Indexer lease is unavailable; reacquiring')
		return this.lease
	}

	protected withManifestDeploymentBlocks(contracts: ReadonlyMap<string, ContractMetadata>): Map<string, ContractMetadata> {
		const configured = new Map(this.network.contracts.map(([address, , , deploymentBlock]) => [address.toLowerCase(), deploymentBlock]))
		return new Map(
			[...contracts].map(([key, contract]) => {
				const deploymentBlock = configured.get(key)
				return [key, deploymentBlock === undefined ? contract : { ...contract, deploymentBlock, deploymentBlockExact: true }]
			}),
		)
	}

	protected async reconcileManifestBackfill(): Promise<void> {
		await this.assertLease()
		const checkpoint = await this.database.checkpoint(this.network.chainId, this.requireLease())
		if (checkpoint === undefined) return
		const [storedContracts, cursors] = await Promise.all([this.database.contracts(this.network.chainId, this.requireLease()), this.database.logScanCursors(this.network.chainId, this.requireLease())])
		const replayStart = await planManifestBackfill(
			this.network.contracts,
			storedContracts,
			cursors,
			checkpoint.number,
			this.configuredStartBlock,
			(address, startBlock, indexedBoundary, startBlockKnownAbsent) => this.findManifestDeployment(address, startBlock, indexedBoundary, startBlockKnownAbsent),
			this.network.startBlock,
		)
		if (replayStart === undefined) return
		const requestedAncestor = manifestReplayAncestor(replayStart, this.network.startBlock)
		const storedAncestor = requestedAncestor < 0n ? undefined : await this.database.canonicalCheckpointAtOrBefore(this.network.chainId, requestedAncestor, this.requireLease())
		const ancestor = storedAncestor?.number ?? -1n
		const ancestorHash = storedAncestor?.hash
		await this.assertLease()
		await this.database.rewind(this.network.chainId, ancestor, ancestorHash, this.requireLease(), 'manifest-reset', this.provenance)
		this.indexingStartReported = false
		this.lastReportedPhase = undefined
		console.info(`[${this.network.id}] manifest history gap detected; rewound to ${ancestor < 0n ? 'before the configured start block' : `block #${ancestor}`} to replay from block #${replayStart}`)
	}

	protected async reconcileReorg(): Promise<void> {
		const checkpoint = await this.database.checkpoint(this.network.chainId, this.requireLease())
		if (checkpoint === undefined) return
		const remote = await this.getBlockHeader(checkpoint.number)
		if (remote.hash === checkpoint.hash) return
		const floor = reorgSearchFloor(this.network.startBlock, checkpoint.number, this.network.confirmationDepth)
		const ancestor = await findSparseCanonicalAncestor(
			checkpoint.number - 1n,
			floor,
			blockNumber => this.database.canonicalCheckpointAtOrBefore(this.network.chainId, blockNumber, this.requireLease()),
			async blockNumber => (await this.getBlockHeader(blockNumber)).hash,
		)
		if (ancestor !== undefined) {
			await this.assertLease()
			await this.database.rewind(this.network.chainId, ancestor.number, ancestor.hash, this.requireLease(), 'chain-reorg', this.provenance)
			return
		}
		await this.assertLease()
		await this.database.rewind(this.network.chainId, -1n, undefined, this.requireLease(), 'chain-reorg', this.provenance)
	}

	protected async refreshContractDeployment(indexedBoundary: bigint): Promise<void> {
		const now = Date.now()
		if (!contractDeploymentScanDue(this.lastDeploymentScanAt, now)) return
		try {
			let candidate: ContractMetadata | undefined
			try {
				const candidates = await this.database.contractDeploymentCandidates(this.network.chainId, indexedBoundary, this.requireLease())
				candidate = contractDeploymentCandidateFrom(candidates, this.historicalCodeUnavailable())
			} catch (error) {
				if (errorChainIncludes(error, leaseFailureNames)) throw error
				console.warn(`[${this.network.id}] contract deployment check skipped: ${indexerOperationFailureReason(error, this.rpcDiagnostics.activeNumber(), 'storage')}`)
				return
			}
			if (candidate === undefined) return
			let resolved: ContractDeploymentObservation['deployment']
			try {
				const readWithinBudget = deploymentReadBudget()
				let deployment: { readonly block: bigint; readonly exact: boolean } | undefined
				for (let attempt = 0; attempt < 2; attempt++) {
					const searchStart = this.stateStartBlock > this.network.startBlock ? this.stateStartBlock : this.network.startBlock
					if (indexedBoundary <= searchStart) return
					try {
						const historicalRead = await readHistoricalCodeWithPermanentFallback(
							() => findContractDeploymentBlock(searchStart, indexedBoundary, blockNumber => readWithinBudget(() => this.client.getBytecode({ address: candidate.address, blockNumber }))),
							error => this.rememberHistoricalCodeUnavailable(candidate.address, error),
						)
						if (historicalRead.status === 'unavailable') return
						deployment = historicalRead.value
						break
					} catch (error) {
						if (!isPrunedHistoricalStateError(error) || attempt > 0) throw error
						await this.discoverStateStartBlock(await this.client.getBlockNumber(), this.stateStartBlock, true)
					}
				}
				resolved =
					deployment === undefined
						? undefined
						: {
								...deployment,
								timestamp: unixSecondsToDate((await readWithinBudget(() => this.getBlockHeader(deployment.block))).timestamp, 'Deployment block timestamp'),
							}
			} catch (error) {
				if (rpcQueueSaturationFrom(error) !== undefined) throw error
				console.warn(`[${this.network.id}] contract deployment check skipped: ${indexerOperationFailureReason(error, this.rpcDiagnostics.activeNumber(), 'rpc')}`)
				return
			}
			try {
				await this.assertLease()
				await this.database.recordContractDeployment(this.network.chainId, candidate.address, indexedBoundary, resolved, this.requireLease())
			} catch (error) {
				if (errorChainIncludes(error, leaseFailureNames)) throw error
				console.warn(`[${this.network.id}] contract deployment check skipped: ${indexerOperationFailureReason(error, this.rpcDiagnostics.activeNumber(), 'storage')}`)
			}
		} finally {
			this.lastDeploymentScanAt = Date.now()
		}
	}

	protected async poll(): Promise<boolean> {
		await this.assertLease()
		await this.database.recordIndexerOwnership(this.network.chainId, this.network.id, 'owned', this.requireLease().backendPid, this.provenance?.indexerRunId, this.requireLease().connection)
		await this.reconcileReorg()
		const observedHead = await this.client.getBlockNumber()
		if (!this.stateBoundaryDiscovered && observedHead >= this.network.startBlock) await this.discoverStateStartBlock(observedHead)
		const checkpoint = await this.database.checkpoint(this.network.chainId, this.requireLease())
		const nextBlock = checkpoint === undefined ? this.network.startBlock : checkpoint.number + 1n
		if (nextBlock > observedHead) {
			if (checkpoint !== undefined) {
				await this.refreshRichListBalances(checkpoint.number, checkpoint.hash)
				await this.refreshEntityStateSnapshots(checkpoint.number, checkpoint.hash)
			}
			await this.assertLease()
			await this.database.updateObservedHead(this.network.chainId, observedHead, 'live', this.requireLease())
			if (checkpoint === undefined) this.reportWaitingForStart(observedHead)
			else if (this.lastReportedPhase !== 'live') this.reportProgress(observedHead, observedHead, observedHead)
			if (checkpoint !== undefined) await this.refreshContractDeployment(checkpoint.number)
			return true
		}

		if (!this.indexingStartReported) {
			const completion = indexingCompletion(this.network.startBlock, nextBlock - 1n, observedHead)
			console.info(`[${this.network.id}] indexer state: backfilling; fetching from block #${nextBlock}; observed head #${observedHead}; ${completion.percentage}% complete; ${completion.remainingBlocks} blocks behind; estimating ETA`)
			this.progressSample = { block: nextBlock - 1n, sampledAt: Date.now() }
			this.indexingStartReported = true
		}
		const batchStart = nextBlock
		let contracts = this.withManifestDeploymentBlocks(await this.database.contracts(this.network.chainId, this.requireLease()))
		let tokenMetadata = await this.database.tokenMetadata(this.network.chainId, this.requireLease())
		const storedCursors = await this.database.logScanCursors(this.network.chainId, this.requireLease())
		const initialContracts = indexerLogSources([...contracts.values()])
		const initialAddresses = initialContracts.map(({ address }) => address)
		for (const address of initialAddresses) {
			const cursor = storedCursors.get(address.toLowerCase())
			if (cursor !== undefined && cursor.lastRetrievedBlock >= nextBlock) throw new DatabaseConsistencyError(`Log cursor ${address} is ahead of the network checkpoint`)
		}
		let segment: {
			readonly toBlock: bigint
			readonly logs: readonly Log[]
			readonly endBlockHash?: Hash
			readonly endBlockHeader?: RpcBlockHeader
			readonly scanInputs: readonly LogScanInput[]
			readonly deploymentObservations: readonly ContractDeploymentObservation[]
		}
		try {
			segment = await this.getNextLogSegment(nextBlock, observedHead, initialContracts)
			if (segment.endBlockHash !== undefined && segment.endBlockHeader?.hash !== segment.endBlockHash) throw new ChainContinuityError(`Canonical chain changed after querying logs through block ${segment.toBlock}`)
		} catch (error) {
			if (error instanceof ChainContinuityError) return false
			throw error
		}
		const end = segment.toBlock
		for (const observation of segment.deploymentObservations) {
			const key = observation.contractAddress.toLowerCase()
			const contract = contracts.get(key)
			if (contract === undefined) continue
			contracts.set(key, {
				...contract,
				deploymentCheckedBlock: observation.checkedBlock,
				...(observation.deployment === undefined
					? {}
					: {
							deploymentBlock: observation.deployment.block,
							deploymentTimestamp: observation.deployment.timestamp,
							deploymentBlockExact: observation.deployment.exact,
						}),
			})
		}
		console.info(`[${this.network.id}] fetched ${segment.logs.length} protocol log${segment.logs.length === 1 ? '' : 's'} for blocks #${nextBlock}-#${end}`)
		const logsByBlock = new Map<bigint, Log[]>()
		this.mergeLogs(logsByBlock, segment.logs)
		const headerPromises = new Map<bigint, Promise<RpcBlockHeader>>()
		if (segment.endBlockHeader !== undefined) headerPromises.set(end, Promise.resolve(segment.endBlockHeader))
		const headerAt = async (blockNumber: bigint): Promise<RpcBlockHeader> => {
			const existing = headerPromises.get(blockNumber)
			if (existing !== undefined) return await existing
			const pending = this.getBlockHeader(blockNumber)
			headerPromises.set(blockNumber, pending)
			return await pending
		}
		const processedBlocks = new Set<bigint>()
		const blocksToStore: IndexedBlock[] = []
		let previousStoredNumber = checkpoint?.number
		let previousStoredHash = checkpoint?.hash
		while (!processedBlocks.has(end) && !this.signal.aborted) {
			const targetBlock = [...new Set([...logsByBlock.keys(), end])].filter(blockNumber => blockNumber >= batchStart && blockNumber <= end && !processedBlocks.has(blockNumber)).sort((left, right) => (left < right ? -1 : left > right ? 1 : 0))[0]
			if (targetBlock === undefined) throw new Error(`Sparse log segment did not retain its end checkpoint at block ${end}`)
			const header = await headerAt(targetBlock)
			const expectedParentHash = previousStoredNumber !== undefined && targetBlock === previousStoredNumber + 1n ? previousStoredHash : undefined
			let indexed: { block: IndexedBlock; contracts: Map<string, ContractMetadata>; tokenMetadata: Map<string, TokenMetadata> }
			try {
				indexed = await this.indexBlock(targetBlock, observedHead, contracts, tokenMetadata, expectedParentHash, header, logsByBlock.get(targetBlock) ?? [], async (discoveredAddresses, discoveredContracts) => {
					const coverage = await scanDiscoveredLogCoverage(
						targetBlock,
						end,
						discoveredAddresses,
						discoveredContracts,
						addresses => this.getKnownLogs(targetBlock, addresses, discoveredContracts, header.hash),
						(fromBlock, toBlock, addresses) => this.getAllLogs(fromBlock, toBlock, addresses, discoveredContracts, async blockNumber => (await headerAt(blockNumber)).hash),
					)
					this.mergeLogs(logsByBlock, coverage.remainingLogs)
					return coverage.currentBlockLogs
				})
			} catch (error) {
				if (error instanceof ChainContinuityError) {
					await this.reconcileReorg()
					return false
				}
				throw error
			}
			const isSegmentEnd = targetBlock === end
			const block = isSegmentEnd
				? {
						...indexed.block,
						contractDeploymentObservations: segment.deploymentObservations,
						logScanCursors: logScanCursorUpdates(indexed.contracts, segment.scanInputs, end, this.network.startBlock, batchStart),
					}
				: indexed.block
			blocksToStore.push(block)
			contracts = indexed.contracts
			tokenMetadata = indexed.tokenMetadata
			previousStoredNumber = targetBlock
			previousStoredHash = indexed.block.hash
			processedBlocks.add(targetBlock)
		}
		if (processedBlocks.size > 0) {
			this.signal.throwIfAborted()
			const indexedEndHash = blocksToStore.at(-1)?.hash
			if (indexedEndHash === undefined || (segment.endBlockHash !== undefined && indexedEndHash !== segment.endBlockHash)) {
				await this.reconcileReorg()
				return false
			}
			const anchors = [...(checkpoint === undefined ? [] : [{ number: checkpoint.number, hash: checkpoint.hash }]), { number: end, hash: indexedEndHash }]
			try {
				await commitSparseCanonicalBatch(
					anchors,
					async blockNumber => (await this.getBlockHeader(blockNumber)).hash,
					async validateBeforeCommit => {
						this.signal.throwIfAborted()
						await this.assertLease()
						await this.database.storeBlocks(this.network.chainId, blocksToStore, this.requireLease(), this.provenance, async () => {
							this.signal.throwIfAborted()
							await validateBeforeCommit()
							this.signal.throwIfAborted()
						})
					},
				)
			} catch (error) {
				if (!(error instanceof ChainContinuityError)) throw error
				await this.reconcileReorg()
				return false
			}
			const indexedThrough = end
			this.reportProgress(batchStart, indexedThrough, observedHead)
			await this.refreshContractDeployment(indexedThrough)
		}
		return end >= observedHead
	}
}

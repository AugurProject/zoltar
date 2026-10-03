import { scanBlockTimeMs, startScanReport } from '@zoltar/core-shared/monitoring/scanStatus'
import { runtimeConfig } from '../config.ts'
import { type ContractDeploymentObservation, DatabaseConsistencyError, type IndexedBlock } from '../database.ts'
import { errorChainIncludes } from '../error-chain.ts'
import type { Hash, Log } from '../ethereum.ts'
import {
	ChainContinuityError,
	commitSparseCanonicalBatch,
	contractDeploymentCandidateFrom,
	contractDeploymentScanDue,
	deploymentReadBudget,
	findSparseCanonicalAncestor,
	indexerLogSources,
	indexerOperationFailureReason,
	indexerProgressDetails,
	indexerWaitingMessage,
	indexingCompletion,
	isPrunedHistoricalStateError,
	leaseFailureNames,
	readHistoricalCodeWithPermanentFallback,
	scanDiscoveredLogCoverage,
} from '../indexer-runtime.ts'
import { rpcQueueSaturationFrom } from '../rpc-request-queue.ts'
import { bigintToSafeNumber, unixSecondsToDate } from '../time.ts'
import type { ContractMetadata, TokenMetadata } from '../types.ts'
import { findContractDeploymentBlock, type LogScanInput, logScanCursorUpdates, manifestReplayAncestor, planManifestBackfill, type RpcBlockHeader, reorgSearchFloor } from './planning.ts'
import { createBlockPrefetch } from './block-prefetch.ts'
import { indexBlock, refreshEntityStateSnapshots, refreshRichListBalances } from './ingestion-operations.ts'
import { getAllLogs, getKnownLogs, getNextLogSegment, mergeLogs } from './log-scanner.ts'
import { discoverStateStartBlock, findManifestDeployment, getBlockHeader, getFullBlock, historicalCodeUnavailable, rememberHistoricalCodeUnavailable } from './network-provider.ts'
import { assertLease, type NetworkIndexerState, requireLease } from './network-state.ts'

/** Collaborators a poll delegates to; replaceable so replay tests can isolate one ingestion stage. */
export type PollOperations = {
	readonly reconcileReorg: typeof reconcileReorg
	readonly refreshContractDeployment: typeof refreshContractDeployment
	readonly getNextLogSegment: typeof getNextLogSegment
	readonly getBlockHeader: typeof getBlockHeader
	readonly getFullBlock: typeof getFullBlock
	readonly indexBlock: typeof indexBlock
}

function reportProgress(state: Pick<NetworkIndexerState, 'network' | 'progress'>, startBlock: bigint, endBlock: bigint, observedHead: bigint, scanReport: ReturnType<typeof startScanReport>, logsAdded: number): void {
	const phase = endBlock >= observedHead ? 'live' : 'backfilling'
	const now = Date.now()
	const previousSample = state.progress.sample
	let blocksPerSecond = previousSample?.blocksPerSecond
	if (previousSample !== undefined && endBlock > previousSample.block && now - previousSample.sampledAt >= 1_000) {
		const observedRate = bigintToSafeNumber(endBlock - previousSample.block, 'Indexer progress block count') / ((now - previousSample.sampledAt) / 1_000)
		blocksPerSecond = blocksPerSecond === undefined ? observedRate : blocksPerSecond * 0.7 + observedRate * 0.3
		state.progress.sample = { block: endBlock, sampledAt: now, blocksPerSecond }
	} else if (previousSample === undefined || endBlock < previousSample.block) {
		state.progress.sample = { block: endBlock, sampledAt: now }
	}
	state.progress.lastReportedPhase = phase
	scanReport.update({ block: endBlock, fromBlock: startBlock, observedHead, status: phase, details: { ...indexerProgressDetails(startBlock, endBlock, observedHead, state.network.startBlock, blocksPerSecond), logsAdded } })
}

function reportWaitingForStart(state: Pick<NetworkIndexerState, 'network' | 'progress'>, observedHead: bigint): void {
	if (state.progress.lastReportedPhase === 'live') return
	state.progress.lastReportedPhase = 'live'
	console.info(indexerWaitingMessage(state.network.id, state.network.startBlock, observedHead))
}

function withManifestDeploymentBlocks(network: NetworkIndexerState['network'], contracts: ReadonlyMap<string, ContractMetadata>): Map<string, ContractMetadata> {
	const configured = new Map(network.contracts.map(([address, , , deploymentBlock]) => [address.toLowerCase(), deploymentBlock]))
	return new Map(
		[...contracts].map(([key, contract]) => {
			const deploymentBlock = configured.get(key)
			return [key, deploymentBlock === undefined ? contract : { ...contract, deploymentBlock, deploymentBlockExact: true }]
		}),
	)
}

export async function reconcileManifestBackfill(state: NetworkIndexerState): Promise<void> {
	await assertLease(state)
	const checkpoint = await state.database.checkpoint(state.network.chainId, requireLease(state))
	if (checkpoint === undefined) return
	const [storedContracts, cursors] = await Promise.all([state.database.contracts(state.network.chainId, requireLease(state)), state.database.logScanCursors(state.network.chainId, requireLease(state))])
	const replayStart = await planManifestBackfill(
		state.network.contracts,
		storedContracts,
		cursors,
		checkpoint.number,
		state.configuredStartBlock,
		(address, startBlock, indexedBoundary, startBlockKnownAbsent) => findManifestDeployment(state, address, startBlock, indexedBoundary, startBlockKnownAbsent),
		state.network.startBlock,
	)
	if (replayStart === undefined) return
	const requestedAncestor = manifestReplayAncestor(replayStart, state.network.startBlock)
	const storedAncestor = requestedAncestor < 0n ? undefined : await state.database.canonicalCheckpointAtOrBefore(state.network.chainId, requestedAncestor, requireLease(state))
	const ancestor = storedAncestor?.number ?? -1n
	const ancestorHash = storedAncestor?.hash
	await assertLease(state)
	await state.database.rewind(state.network.chainId, ancestor, ancestorHash, requireLease(state), 'manifest-reset', state.provenance)
	state.progress.indexingStartReported = false
	state.progress.lastReportedPhase = undefined
	console.info(`[${state.network.id}] manifest history gap detected; rewound to ${ancestor < 0n ? 'before the configured start block' : `block #${ancestor}`} to replay from block #${replayStart}`)
}

async function reconcileReorg(state: NetworkIndexerState): Promise<void> {
	const checkpoint = await state.database.checkpoint(state.network.chainId, requireLease(state))
	if (checkpoint === undefined) return
	const remote = await getBlockHeader(state.providers, checkpoint.number)
	if (remote.hash === checkpoint.hash) return
	const floor = reorgSearchFloor(state.network.startBlock, checkpoint.number, state.network.confirmationDepth)
	const ancestor = await findSparseCanonicalAncestor(
		checkpoint.number - 1n,
		floor,
		blockNumber => state.database.canonicalCheckpointAtOrBefore(state.network.chainId, blockNumber, requireLease(state)),
		async blockNumber => (await getBlockHeader(state.providers, blockNumber)).hash,
	)
	if (ancestor !== undefined) {
		await assertLease(state)
		await state.database.rewind(state.network.chainId, ancestor.number, ancestor.hash, requireLease(state), 'chain-reorg', state.provenance)
		return
	}
	await assertLease(state)
	await state.database.rewind(state.network.chainId, -1n, undefined, requireLease(state), 'chain-reorg', state.provenance)
}

async function refreshContractDeployment(state: NetworkIndexerState, indexedBoundary: bigint): Promise<void> {
	const now = Date.now()
	if (!contractDeploymentScanDue(state.progress.lastDeploymentScanAt, now)) return
	try {
		let candidate: ContractMetadata | undefined
		try {
			const candidates = await state.database.contractDeploymentCandidates(state.network.chainId, indexedBoundary, requireLease(state))
			candidate = contractDeploymentCandidateFrom(candidates, historicalCodeUnavailable(state.providers))
		} catch (error) {
			if (errorChainIncludes(error, leaseFailureNames)) throw error
			console.warn(`[${state.network.id}] contract deployment check skipped: ${indexerOperationFailureReason(error, state.providers.diagnostics.activeNumber(), 'storage')}`)
			return
		}
		if (candidate === undefined) return
		let resolved: ContractDeploymentObservation['deployment']
		try {
			const readWithinBudget = deploymentReadBudget()
			let deployment: { readonly block: bigint; readonly exact: boolean } | undefined
			for (let attempt = 0; attempt < 2; attempt++) {
				const searchStart = state.stateBoundary.startBlock > state.network.startBlock ? state.stateBoundary.startBlock : state.network.startBlock
				if (indexedBoundary <= searchStart) return
				try {
					const historicalRead = await readHistoricalCodeWithPermanentFallback(
						() => findContractDeploymentBlock(searchStart, indexedBoundary, blockNumber => readWithinBudget(() => state.providers.client.getBytecode({ address: candidate.address, blockNumber }))),
						error => rememberHistoricalCodeUnavailable(state, candidate.address, error),
					)
					if (historicalRead.status === 'unavailable') return
					deployment = historicalRead.value
					break
				} catch (error) {
					if (!isPrunedHistoricalStateError(error) || attempt > 0) throw error
					await discoverStateStartBlock(state, await state.providers.client.getBlockNumber(), state.stateBoundary.startBlock, true)
				}
			}
			resolved =
				deployment === undefined
					? undefined
					: {
							...deployment,
							timestamp: unixSecondsToDate((await readWithinBudget(() => getBlockHeader(state.providers, deployment.block))).timestamp, 'Deployment block timestamp'),
						}
		} catch (error) {
			if (rpcQueueSaturationFrom(error) !== undefined) throw error
			console.warn(`[${state.network.id}] contract deployment check skipped: ${indexerOperationFailureReason(error, state.providers.diagnostics.activeNumber(), 'rpc')}`)
			return
		}
		try {
			await assertLease(state)
			await state.database.recordContractDeployment(state.network.chainId, candidate.address, indexedBoundary, resolved, requireLease(state))
		} catch (error) {
			if (errorChainIncludes(error, leaseFailureNames)) throw error
			console.warn(`[${state.network.id}] contract deployment check skipped: ${indexerOperationFailureReason(error, state.providers.diagnostics.activeNumber(), 'storage')}`)
		}
	} finally {
		state.progress.lastDeploymentScanAt = Date.now()
	}
}

export async function poll(state: NetworkIndexerState, operations: PollOperations = pollOperations): Promise<boolean> {
	const scanReport = startScanReport({
		network: state.network,
		blockTimeMs: scanBlockTimeMs(state.network.chainId, runtimeConfig.scanBlockTimeMsOverride),
		readHead: () => state.providers.client.getBlockNumber(),
	})
	try {
		return await pollWithReport(state, operations, scanReport)
	} catch (error) {
		scanReport.update({ status: 'failed' })
		throw error
	} finally {
		await scanReport.finish(state.signal.aborted ? 'incomplete' : undefined)
	}
}

async function pollWithReport(state: NetworkIndexerState, operations: PollOperations, scanReport: ReturnType<typeof startScanReport>): Promise<boolean> {
	await assertLease(state)
	await state.database.recordIndexerOwnership(state.network.chainId, state.network.id, 'owned', requireLease(state).backendPid, state.provenance?.indexerRunId, requireLease(state).connection)
	await operations.reconcileReorg(state)
	const observedHead = await state.providers.client.getBlockNumber()
	scanReport.update({ observedHead })
	if (!state.stateBoundary.discovered && observedHead >= state.network.startBlock) await discoverStateStartBlock(state, observedHead)
	const checkpoint = await state.database.checkpoint(state.network.chainId, requireLease(state))
	const nextBlock = checkpoint === undefined ? state.network.startBlock : checkpoint.number + 1n
	if (nextBlock > observedHead) {
		if (checkpoint !== undefined) {
			await refreshRichListBalances(state, checkpoint.number, checkpoint.hash)
			await refreshEntityStateSnapshots(state, checkpoint.number, checkpoint.hash)
		}
		await assertLease(state)
		await state.database.updateObservedHead(state.network.chainId, observedHead, 'live', requireLease(state))
		if (checkpoint === undefined) reportWaitingForStart(state, observedHead)
		scanReport.update({ block: checkpoint?.number, status: checkpoint === undefined ? 'waiting' : 'live', details: { blocksScanned: 0, logsAdded: 0 } })
		if (checkpoint !== undefined) await operations.refreshContractDeployment(state, checkpoint.number)
		return true
	}

	if (!state.progress.indexingStartReported) {
		const completion = indexingCompletion(state.network.startBlock, nextBlock - 1n, observedHead)
		console.info(`[${state.network.id}] indexer state: backfilling; fetching from block #${nextBlock}; observed head #${observedHead}; ${completion.percentage}% complete; ${completion.remainingBlocks} blocks behind; estimating ETA`)
		state.progress.sample = { block: nextBlock - 1n, sampledAt: Date.now() }
		state.progress.indexingStartReported = true
	}
	const batchStart = nextBlock
	const maximumBatchEnd = nextBlock + BigInt(runtimeConfig.logScanRangeSize - 1)
	const batchEnd = maximumBatchEnd < observedHead ? maximumBatchEnd : observedHead
	scanReport.update({ fromBlock: batchStart, block: batchEnd, status: 'incomplete' })
	let contracts = withManifestDeploymentBlocks(state.network, await state.database.contracts(state.network.chainId, requireLease(state)))
	let tokenMetadata = await state.database.tokenMetadata(state.network.chainId, requireLease(state))
	const storedCursors = await state.database.logScanCursors(state.network.chainId, requireLease(state))
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
		segment = await operations.getNextLogSegment(state, nextBlock, batchEnd, initialContracts)
		if (segment.endBlockHash !== undefined && segment.endBlockHeader?.hash !== segment.endBlockHash) throw new ChainContinuityError(`Canonical chain changed after querying logs through block ${segment.toBlock}`)
	} catch (error) {
		if (error instanceof ChainContinuityError) return false
		throw error
	}
	const end = segment.toBlock
	scanReport.update({ block: end })
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
	const logsByBlock = new Map<bigint, Log[]>()
	mergeLogs(logsByBlock, segment.logs)
	const headerPromises = new Map<bigint, Promise<RpcBlockHeader>>()
	if (segment.endBlockHeader !== undefined) headerPromises.set(end, Promise.resolve(segment.endBlockHeader))
	const headerAt = async (blockNumber: bigint): Promise<RpcBlockHeader> => {
		const existing = headerPromises.get(blockNumber)
		if (existing !== undefined) return await existing
		const pending = operations.getBlockHeader(state.providers, blockNumber)
		headerPromises.set(blockNumber, pending)
		return await pending
	}
	const takeFullBlock = createBlockPrefetch(batchStart, end, number => operations.getFullBlock(state.providers, number), state.signal)
	let processedBlockCount = 0
	let committedLogs = 0
	let commitCheckpoint = checkpoint === undefined ? undefined : { number: checkpoint.number, hash: checkpoint.hash }
	const blocksToStore: IndexedBlock[] = []
	let previousStoredNumber = checkpoint?.number
	let previousStoredHash = checkpoint?.hash
	// Keep durable progress and memory bounded while the RPC scan covers up to 100,000 blocks.
	const commitPendingBlocks = async (): Promise<boolean> => {
		state.signal.throwIfAborted()
		const lastBlock = blocksToStore.at(-1)
		const indexedEndHash = lastBlock?.hash
		if (lastBlock === undefined || indexedEndHash === undefined || (lastBlock.number === end && segment.endBlockHash !== undefined && indexedEndHash !== segment.endBlockHash)) {
			scanReport.update({ status: 'incomplete' })
			await operations.reconcileReorg(state)
			return false
		}
		const anchors = [...(commitCheckpoint === undefined ? [] : [{ number: commitCheckpoint.number, hash: commitCheckpoint.hash }]), { number: lastBlock.number, hash: indexedEndHash }, ...(segment.endBlockHash === undefined || lastBlock.number === end ? [] : [{ number: end, hash: segment.endBlockHash }])]
		try {
			await commitSparseCanonicalBatch(
				anchors,
				async blockNumber => (await operations.getBlockHeader(state.providers, blockNumber)).hash,
				async validateBeforeCommit => {
					state.signal.throwIfAborted()
					await assertLease(state)
					await state.database.storeBlocks(state.network.chainId, blocksToStore, requireLease(state), state.provenance, async () => {
						state.signal.throwIfAborted()
						await validateBeforeCommit()
						state.signal.throwIfAborted()
					})
				},
			)
		} catch (error) {
			if (!(error instanceof ChainContinuityError)) throw error
			scanReport.update({ status: 'incomplete' })
			await operations.reconcileReorg(state)
			return false
		}
		committedLogs += blocksToStore.reduce((total, block) => total + block.logs.length, 0)
		commitCheckpoint = { number: lastBlock.number, hash: indexedEndHash }
		reportProgress(state, batchStart, lastBlock.number, observedHead, scanReport, committedLogs)
		blocksToStore.length = 0
		return true
	}
	while (previousStoredNumber !== end && !state.signal.aborted) {
		const targetBlock = previousStoredNumber !== undefined && previousStoredNumber >= batchStart ? previousStoredNumber + 1n : batchStart
		const header = await takeFullBlock(targetBlock)
		headerPromises.set(targetBlock, Promise.resolve(header))
		const expectedParentHash = previousStoredNumber !== undefined && targetBlock === previousStoredNumber + 1n ? previousStoredHash : undefined
		let indexed: { block: IndexedBlock; contracts: Map<string, ContractMetadata>; tokenMetadata: Map<string, TokenMetadata> }
		try {
			indexed = await operations.indexBlock(
				state,
				targetBlock,
				observedHead,
				contracts,
				tokenMetadata,
				expectedParentHash,
				header,
				logsByBlock.get(targetBlock) ?? [],
				async (discoveredAddresses, discoveredContracts) => {
					const coverage = await scanDiscoveredLogCoverage(
						targetBlock,
						end,
						discoveredAddresses,
						discoveredContracts,
						addresses => getKnownLogs(state.providers, targetBlock, addresses, discoveredContracts, header.hash),
						(fromBlock, toBlock, addresses) => getAllLogs(state, fromBlock, toBlock, addresses, discoveredContracts, async blockNumber => (await headerAt(blockNumber)).hash),
					)
					mergeLogs(logsByBlock, coverage.remainingLogs)
					return coverage.currentBlockLogs
				},
				operations.getBlockHeader,
			)
		} catch (error) {
			if (error instanceof ChainContinuityError) {
				scanReport.update({ status: 'incomplete' })
				await operations.reconcileReorg(state)
				return false
			}
			throw error
		}
		const isSegmentEnd = targetBlock === end
		const isCommitEnd = blocksToStore.length + 1 >= 100 || isSegmentEnd
		const block = isCommitEnd
			? {
					...indexed.block,
					contractDeploymentObservations: isSegmentEnd ? segment.deploymentObservations : indexed.block.contractDeploymentObservations,
					logScanCursors: logScanCursorUpdates(indexed.contracts, segment.scanInputs, targetBlock, state.network.startBlock, batchStart),
				}
			: indexed.block
		blocksToStore.push(block)
		contracts = indexed.contracts
		tokenMetadata = indexed.tokenMetadata
		previousStoredNumber = targetBlock
		previousStoredHash = indexed.block.hash
		processedBlockCount++
		headerPromises.delete(targetBlock)
		logsByBlock.delete(targetBlock)
		if (isCommitEnd && !(await commitPendingBlocks())) return false
	}
	if (processedBlockCount > 0) {
		state.signal.throwIfAborted()
		await operations.refreshContractDeployment(state, end)
	}
	return end >= observedHead
}

const pollOperations: PollOperations = { reconcileReorg, refreshContractDeployment, getNextLogSegment, getBlockHeader, getFullBlock, indexBlock }

import { safeIndexerFailure } from './indexer-runtime.ts'

export {
	addressActivityFrom,
	boundedDeploymentRead,
	commitCanonicalRead,
	compactIndexerDuration,
	confirmCanonicalBlock,
	contractDeploymentScanDue,
	createRpcDiagnosticContext,
	deploymentReadBudget,
	indexerOperationFailureReason,
	indexerProgressMessage,
	indexerWaitingMessage,
	indexingCompletion,
	isLocalIndexerFailure,
	isProtocolActivitySource,
	isProtocolEvidenceEmitter,
	isSplittableLogRangeError,
	nextIndexerOwnershipStatus,
	ownershipFailureLogMessage,
	queryCanonicalLogRange,
	retryDelayMs,
	rpcFailureLogMessage,
	rpcIndexerFailureReason,
	rpcProviderLabel,
	runIndexerOwnershipLifecycle,
	runNetworkLifecycle,
	runOwnedNetworkLifecycle,
	safeIndexerFailure,
	safeIndexerFailureReason,
	waitForIndexerDelay,
	withVerifiedProvider,
} from './indexer-runtime.ts'
export { createRpcRequestQueue, RpcQueueSaturatedError, withRpcRequestQueue } from './rpc-request-queue.ts'

import type { EvidenceProvenance, ScannerDatabase } from './database.ts'
import type { NetworkConfig } from './types.ts'

export * from './indexer/planning.ts'

import { NetworkIndexer } from './indexer/block-ingestion.ts'

export const startIndexers = (
	networks: readonly NetworkConfig[],
	database: ScannerDatabase,
	signal: AbortSignal,
	options: {
		readonly provenance?: EvidenceProvenance
	} = {},
): readonly Promise<void>[] => networks.map((network) => runIndexerTask(network.id, () => new NetworkIndexer(network, database, signal, options).run()))

export const runIndexerTask = async (networkId: string, run: () => Promise<void>): Promise<void> => {
	try {
		await run()
		console.info(`[${networkId}] indexer state: stopped`)
	} catch (error) {
		const message = safeIndexerFailure(error)
		console.error(`[${networkId}] indexer state: stopped; ${message}`)
	}
}

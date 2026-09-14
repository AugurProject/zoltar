import { SQL } from 'bun'
import { scannerDatabaseOptions } from './history.ts'
import * as connection from './connection.ts'
import * as networks from './network-repository.ts'
import * as observations from './observation-repository.ts'
import * as history from './history-repository.ts'
import * as persistence from './persistence-operations.ts'

export class ScannerDatabase {
	readonly sql: SQL
	constructor(url: string, maxConnections = 10, connectionTimeoutSeconds = 5) {
		this.sql = new SQL(url, scannerDatabaseOptions(maxConnections, connectionTimeoutSeconds))
	}
	close = connection.close
	read = connection.read
	recordIndexerOwnership = connection.recordIndexerOwnership
	latestEventId = connection.latestEventId
	eventsAfter = connection.eventsAfter
	pruneLiveEvents = connection.pruneLiveEvents
	auditIntegrity = connection.auditIntegrity
	expectedLeaseReleased = connection.expectedLeaseReleased
	tryAcquireIndexerLock = connection.tryAcquireIndexerLock
	seedNetwork = networks.seedNetwork
	sourceReplayPlan = networks.sourceReplayPlan
	upsertContract = networks.upsertContract
	contracts = networks.contracts
	contractDeploymentCandidates = networks.contractDeploymentCandidates
	recordContractDeployment = networks.recordContractDeployment
	tokenMetadata = networks.tokenMetadata
	logScanCursors = networks.logScanCursors
	richListBalanceTargets = networks.richListBalanceTargets
	stateSnapshotTargets = networks.stateSnapshotTargets
	storeEntityStateSnapshots = observations.storeEntityStateSnapshots
	storeRichListBalances = observations.storeRichListBalances
	checkpoint = history.checkpoint
	networkStartBlock = history.networkStartBlock
	hasStoredBlocks = history.hasStoredBlocks
	storedBlockTip = history.storedBlockTip
	canonicalHash = history.canonicalHash
	canonicalCheckpointAtOrBefore = history.canonicalCheckpointAtOrBefore
	rewind = history.rewind
	storeBlock = persistence.storeBlock
	storeBlocks = persistence.storeBlocks
	persistBlockInTransaction = persistence.persistBlockInTransaction
	updateObservedHead = persistence.updateObservedHead
	advanceNetworkStartBlock = persistence.advanceNetworkStartBlock
	recordFailure = persistence.recordFailure
}

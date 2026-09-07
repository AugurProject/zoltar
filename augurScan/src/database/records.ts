import type { SQL } from 'bun'
import { databaseJsonText } from '../database-json.ts'
import type { Address, Hash, Hex } from '../ethereum.ts'
import type { ContractMetadata, DecodedRecord, ManifestContract, StoredLog, TokenMetadata } from '../types.ts'

export type EvidenceProvenance = {
	readonly indexerRunId: string
	readonly abiSourceHash: string
	readonly applicationSourceHash: string
	readonly projectionSourceHash: string
}

export type InterpretationSourceHashes = Pick<EvidenceProvenance, 'abiSourceHash' | 'applicationSourceHash' | 'projectionSourceHash'>

export const serializedInterpretation = (value: unknown): string => {
	try {
		return databaseJsonText(value)
	} catch (error) {
		const reason = error instanceof Error ? error.message : 'Unknown serialization error'
		throw new DatabaseConsistencyError(`Unable to serialize evidence interpretation: ${reason}`)
	}
}

export type StoredTransaction = {
	readonly hash: Hash
	readonly transactionIndex: number
	readonly from: Address
	readonly to: Address | null
	readonly value: bigint
	readonly input: Hex
	readonly status: 'success'
	readonly gasUsed: bigint
	readonly receipt: unknown
	readonly decoded: DecodedRecord
}

export type IndexedBlock = {
	readonly number: bigint
	readonly hash: Hash
	readonly parentHash: Hash
	readonly timestamp: Date
	readonly observedHead: bigint
	readonly finalizedThrough: bigint
	readonly contracts: readonly ContractMetadata[]
	readonly tokenMetadata: readonly TokenMetadata[]
	readonly transactions: readonly StoredTransaction[]
	readonly logs: readonly StoredLog[]
	readonly addressActivity: readonly AddressActivity[]
	readonly contractDeploymentObservations: readonly ContractDeploymentObservation[]
	readonly logScanCursors: readonly LogScanCursor[]
}

export type ContractDeploymentObservation = {
	readonly contractAddress: Address
	readonly checkedBlock: bigint
	readonly deployment?: {
		readonly block: bigint
		readonly timestamp: Date
		readonly exact: boolean
	}
}

export type LogScanCursor = {
	readonly contractAddress: Address
	readonly startBlock: bigint
	readonly lastRetrievedBlock: bigint
}

export const manifestContractSetChanged = (
	configured: readonly ManifestContract[],
	stored: readonly {
		readonly address: string
		readonly label: string
		readonly kind: string
		readonly configuredDeploymentBlock?: bigint
	}[],
): boolean => {
	const identity = ({ address, label, kind }: { readonly address: string; readonly label: string; readonly kind: string }): string =>
		`${address.toLowerCase()}\u0000${label}\u0000${kind}`
	const configuredIdentities = configured.map(([address, label, kind]) => identity({ address, label, kind })).sort()
	const storedIdentities = stored.map(identity).sort()
	if (configuredIdentities.length !== storedIdentities.length || configuredIdentities.some((value, index) => value !== storedIdentities[index])) return true
	const storedByIdentity = new Map(stored.map((contract) => [identity(contract), contract]))
	return configured.some(([address, label, kind, deploymentBlock]) => {
		const storedContract = storedByIdentity.get(identity({ address, label, kind }))
		return storedContract?.configuredDeploymentBlock !== deploymentBlock
	})
}

export type AddressActivity = {
	readonly transactionHash: Hash
	readonly address: Address
	readonly poolAddress?: Address
	readonly role: 'sender' | 'referenced'
}

type RichListAsset = {
	readonly address: Address
	readonly kind: 'rep' | 'weth'
}

type RichListBalanceIdentity = {
	readonly owner: Address
	readonly assetAddress: Address
	readonly assetKind: 'native' | 'rep' | 'weth'
}

export type RichListBalance =
	| (RichListBalanceIdentity & {
			readonly readStatus?: 'success'
			readonly balance: bigint
			readonly readFailureReason?: never
	  })
	| (RichListBalanceIdentity & {
			readonly readStatus: 'failed'
			readonly balance?: never
			readonly readFailureReason: string
	  })

export type RichListBalanceTargets = {
	readonly addresses: readonly Address[]
	readonly assets: readonly RichListAsset[]
}

export type LiveEvent = {
	readonly id: number
	readonly event: string
	readonly payload: unknown
}

export type IntegrityIssue = {
	readonly chainId: number
	readonly code: string
	readonly detail: string
}

export type StoredCheckpoint = {
	readonly startBlock: bigint
	readonly indexedBlock?: bigint
	readonly indexedHash?: string
}

export const contractMetadataFromRow = (row: Record<string, unknown>): ContractMetadata => {
	const address = String(row['address']) as Address
	return {
		address,
		label: String(row['label']),
		kind: String(row['kind']),
		provenance: String(row['provenance']),
		...(row['discovery_block'] === null || row['discovery_block'] === undefined ? {} : { discoveryBlock: BigInt(String(row['discovery_block'])) }),
		...(row['discovery_tx_hash'] === null || row['discovery_tx_hash'] === undefined ? {} : { discoveryTxHash: String(row['discovery_tx_hash']) as Hash }),
		...(row['configured_deployment_block'] === null || row['configured_deployment_block'] === undefined
			? {}
			: { configuredDeploymentBlock: BigInt(String(row['configured_deployment_block'])) }),
		...(row['deployment_block'] === null || row['deployment_block'] === undefined ? {} : { deploymentBlock: BigInt(String(row['deployment_block'])) }),
		...(row['deployment_timestamp'] === null || row['deployment_timestamp'] === undefined
			? {}
			: { deploymentTimestamp: new Date(String(row['deployment_timestamp'])) }),
		...(row['deployment_block_exact'] === null || row['deployment_block_exact'] === undefined
			? {}
			: { deploymentBlockExact: row['deployment_block_exact'] === true || row['deployment_block_exact'] === 'true' }),
		...(row['deployment_checked_block'] === null || row['deployment_checked_block'] === undefined
			? {}
			: { deploymentCheckedBlock: BigInt(String(row['deployment_checked_block'])) }),
	}
}

export type RewindCheckpoint = {
	readonly indexedBlock?: bigint
	readonly indexedHash?: string
}

export type DatabaseConsistencyDiagnostic =
	| { readonly code: 'lease-backend-moved'; readonly expectedBackendPid: number; readonly observedBackendPid: number }
	| { readonly code: 'lease-not-held'; readonly expectedBackendPid: number }
	| { readonly code: 'lease-release-failed'; readonly expectedBackendPid: number }
	| { readonly code: 'checkpoint-before-start'; readonly indexedBlock: bigint; readonly storedStartBlock: bigint }
	| { readonly code: 'manifest-backfill-ancestor-missing'; readonly ancestor: bigint }
	| { readonly code: 'manifest-history-before-start'; readonly replayStart: bigint; readonly storedStartBlock: bigint }
	| { readonly code: 'start-block-history-mismatch'; readonly configuredStartBlock: bigint; readonly storedStartBlock: bigint }
	| {
			readonly code: 'start-block-mismatch'
			readonly configuredStartBlock: bigint
			readonly storedStartBlock: bigint
			readonly indexedBlock: bigint
	  }

export class DatabaseConsistencyError extends Error {
	override name = 'DatabaseConsistencyError'

	constructor(
		message: string,
		readonly diagnostic?: DatabaseConsistencyDiagnostic,
	) {
		super(message)
	}
}

export class IndexerLeaseReleaseError extends Error {
	override name = 'IndexerLeaseReleaseError'

	constructor(
		message: string,
		readonly releaseConfirmed: boolean,
		cause: unknown,
	) {
		super(message, { cause })
	}
}

export const databaseConsistencyDiagnosticMessage = (error: DatabaseConsistencyError): string | undefined => {
	const diagnostic = error.diagnostic
	if (diagnostic?.code === 'lease-backend-moved') {
		if (!Number.isSafeInteger(diagnostic.expectedBackendPid) || !Number.isSafeInteger(diagnostic.observedBackendPid)) return undefined
		return `Indexer lease moved from PostgreSQL backend ${diagnostic.expectedBackendPid} to ${diagnostic.observedBackendPid}; use a direct connection or a session-mode pooler`
	}
	if (diagnostic?.code === 'lease-not-held') {
		if (!Number.isSafeInteger(diagnostic.expectedBackendPid)) return undefined
		return `Indexer lease is no longer held by PostgreSQL backend ${diagnostic.expectedBackendPid}`
	}
	if (diagnostic?.code === 'lease-release-failed') {
		if (!Number.isSafeInteger(diagnostic.expectedBackendPid)) return undefined
		return `Indexer lease unlock failed on PostgreSQL backend ${diagnostic.expectedBackendPid}; lock ownership may already be lost`
	}
	if (diagnostic?.code === 'checkpoint-before-start') {
		if (typeof diagnostic.indexedBlock !== 'bigint' || typeof diagnostic.storedStartBlock !== 'bigint') return undefined
		return `Stored checkpoint ${diagnostic.indexedBlock} is below configured start block ${diagnostic.storedStartBlock}; rebuild the augurScan database from the configured start block`
	}
	if (diagnostic?.code === 'manifest-backfill-ancestor-missing') {
		if (typeof diagnostic.ancestor !== 'bigint' || diagnostic.ancestor < 0n) return undefined
		return `Manifest backfill cannot find canonical block ${diagnostic.ancestor}; rebuild the augurScan database from the configured start block`
	}
	if (diagnostic?.code === 'manifest-history-before-start') {
		if (typeof diagnostic.replayStart !== 'bigint' || typeof diagnostic.storedStartBlock !== 'bigint') return undefined
		return `Newly tracked deployment block ${diagnostic.replayStart} predates the stored index start ${diagnostic.storedStartBlock}; rebuild the augurScan database to capture its complete history`
	}
	if (diagnostic?.code === 'start-block-history-mismatch') {
		if (typeof diagnostic.configuredStartBlock !== 'bigint' || typeof diagnostic.storedStartBlock !== 'bigint') return undefined
		return `Cannot change the configured start block from ${diagnostic.storedStartBlock} to ${diagnostic.configuredStartBlock} while an effective index start is retained; rebuild the augurScan database from the new start block`
	}
	if (diagnostic?.code === 'start-block-mismatch') {
		if (typeof diagnostic.configuredStartBlock !== 'bigint' || typeof diagnostic.storedStartBlock !== 'bigint' || typeof diagnostic.indexedBlock !== 'bigint')
			return undefined
		return `Cannot change the configured start block from ${diagnostic.storedStartBlock} to ${diagnostic.configuredStartBlock} while checkpoint ${diagnostic.indexedBlock} exists; rebuild the augurScan database from the new start block`
	}
	return undefined
}

export const assertIndexerLeaseObservation = (expectedBackendPid: number, observedBackendPid: number, held: boolean): void => {
	if (observedBackendPid !== expectedBackendPid)
		throw new DatabaseConsistencyError(
			`Indexer lease moved from PostgreSQL backend ${expectedBackendPid} to ${observedBackendPid}; use a direct connection or a session-mode pooler`,
			{ code: 'lease-backend-moved', expectedBackendPid, observedBackendPid },
		)
	if (!held)
		throw new DatabaseConsistencyError(`Indexer lease is no longer held by PostgreSQL backend ${expectedBackendPid}`, {
			code: 'lease-not-held',
			expectedBackendPid,
		})
}

export const assertIndexerLeaseReleaseObservation = (expectedBackendPid: number, observedBackendPid: number, unlocked: boolean): void => {
	assertIndexerLeaseObservation(expectedBackendPid, observedBackendPid, true)
	if (!unlocked)
		throw new DatabaseConsistencyError(`Indexer lease unlock failed on PostgreSQL backend ${expectedBackendPid}; lock ownership may already be lost`, {
			code: 'lease-release-failed',
			expectedBackendPid,
		})
}

export const assertBlockAppend = (block: Pick<IndexedBlock, 'number' | 'parentHash'>, checkpoint: StoredCheckpoint): void => {
	if (checkpoint.indexedBlock === undefined) {
		if (checkpoint.indexedHash !== undefined) throw new DatabaseConsistencyError('The database checkpoint has a block hash without a block number')
		if (block.number < checkpoint.startBlock)
			throw new DatabaseConsistencyError(`Cannot index block ${block.number}; the network starts at block ${checkpoint.startBlock}`)
		return
	}
	if (checkpoint.indexedHash === undefined) throw new DatabaseConsistencyError('The database checkpoint has a block number without a block hash')
	const expectedNumber = checkpoint.indexedBlock + 1n
	if (block.number < expectedNumber)
		throw new DatabaseConsistencyError(`Cannot index block ${block.number}; the database checkpoint is already block ${checkpoint.indexedBlock}`)
	if (block.number === expectedNumber && block.parentHash !== checkpoint.indexedHash)
		throw new DatabaseConsistencyError(`Block ${block.number} does not extend the current database checkpoint`)
}

export const assertStartBlockCompatible = (configuredStartBlock: bigint, storedStartBlock: bigint, indexedBlock?: bigint, hasStoredBlocks = false): void => {
	if (indexedBlock === undefined) {
		if (!hasStoredBlocks || configuredStartBlock === storedStartBlock) return
		throw new DatabaseConsistencyError(
			`Cannot change the configured start block from ${storedStartBlock} to ${configuredStartBlock} while an effective index start is retained; rebuild the augurScan database from the new start block`,
			{ code: 'start-block-history-mismatch', configuredStartBlock, storedStartBlock },
		)
	}
	if (indexedBlock < storedStartBlock)
		throw new DatabaseConsistencyError(
			`Stored checkpoint ${indexedBlock} is below configured start block ${storedStartBlock}; rebuild the augurScan database from the configured start block`,
			{ code: 'checkpoint-before-start', indexedBlock, storedStartBlock },
		)
	if (configuredStartBlock === storedStartBlock) return
	throw new DatabaseConsistencyError(
		`Cannot change the configured start block from ${storedStartBlock} to ${configuredStartBlock} while checkpoint ${indexedBlock} exists; rebuild the augurScan database from the new start block`,
		{ code: 'start-block-mismatch', configuredStartBlock, storedStartBlock, indexedBlock },
	)
}

export const assertLogScanCursorUpdate = (blockNumber: bigint, cursor: LogScanCursor): void => {
	if (cursor.lastRetrievedBlock !== blockNumber)
		throw new DatabaseConsistencyError(`Log cursor ${cursor.contractAddress} must advance to committed block ${blockNumber}`)
	if (cursor.startBlock < 0n || cursor.lastRetrievedBlock < cursor.startBlock)
		throw new DatabaseConsistencyError(`Log cursor ${cursor.contractAddress} has an invalid retrieval boundary`)
}

export const assertContractDeploymentObservation = (blockNumber: bigint, observation: ContractDeploymentObservation): void => {
	if (observation.checkedBlock !== blockNumber)
		throw new DatabaseConsistencyError(`Contract deployment observation ${observation.contractAddress} must be anchored to committed block ${blockNumber}`)
	if (observation.deployment !== undefined && (observation.deployment.block < 0n || observation.deployment.block > observation.checkedBlock))
		throw new DatabaseConsistencyError(`Contract deployment observation ${observation.contractAddress} has an invalid deployment boundary`)
}

export const assertRewindTarget = (ancestor: bigint, ancestorHash: string | undefined, checkpoint: RewindCheckpoint, targetIsCanonical: boolean): void => {
	if (checkpoint.indexedBlock === undefined || checkpoint.indexedHash === undefined)
		throw new DatabaseConsistencyError('Cannot rewind a network without a complete indexed checkpoint')
	if (ancestor < -1n || ancestor >= checkpoint.indexedBlock)
		throw new DatabaseConsistencyError('The rewind target must precede the current database checkpoint')
	if (ancestor === -1n) {
		if (ancestorHash !== undefined) throw new DatabaseConsistencyError('A full rewind must not specify an ancestor hash')
		return
	}
	if (ancestorHash === undefined || !targetIsCanonical) throw new DatabaseConsistencyError('The rewind target is not a canonical stored block')
}

export const rewindDepth = (previousBlock: bigint, startBlock: bigint, ancestor: bigint): bigint => previousBlock - (ancestor < 0n ? startBlock - 1n : ancestor)

export const replayCursorRequiresReset = (cursor: number, prunedThroughId: number, latestId: number): boolean => cursor < prunedThroughId || cursor > latestId

export const lockLiveEventWriter = async (sql: SQL): Promise<void> => {
	await sql`SELECT singleton FROM live_event_state WHERE singleton FOR UPDATE`
}

export type HistoryInvalidationReason = 'chain-reorg' | 'manifest-reset' | 'start-boundary-advanced' | 'abi-redecode' | 'projection-rebuild'

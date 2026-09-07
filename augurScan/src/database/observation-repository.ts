import { databaseJsonText } from '../database-json.ts'
import type { Hash } from '../ethereum.ts'
import type { EntityStateSnapshot } from '../snapshots.ts'
import { type IndexerLease, withIndexerLease } from './history.ts'
import { ScannerNetworkRepository } from './network-repository.ts'
import { DatabaseConsistencyError, type EvidenceProvenance, type RichListBalance } from './records.ts'

export class ScannerObservationRepository extends ScannerNetworkRepository {
	async storeEntityStateSnapshots(
		chainId: number,
		blockNumber: bigint,
		blockHash: Hash,
		blockTimestamp: Date,
		snapshots: readonly EntityStateSnapshot[],
		lease: IndexerLease,
		provenance?: EvidenceProvenance,
	): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			const canonicalRows = await transaction`
				SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${blockNumber.toString()}
					AND hash = ${blockHash} AND canonical
			`
			if (canonicalRows.length !== 1) throw new DatabaseConsistencyError('Cannot store entity snapshots for a noncanonical block')
			for (const snapshot of snapshots) {
				await transaction`
					INSERT INTO entity_state_observations (
						chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
						source_method, read_status, read_result, read_failure_reason, canonical, observed_at,
						indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
					) VALUES (
						${chainId}, ${snapshot.entityType}, ${snapshot.entityIdentity}, ${blockNumber.toString()}, ${blockHash}, ${blockTimestamp},
						${snapshot.sourceMethod}, ${snapshot.readStatus}, (${snapshot.readResult === undefined ? null : databaseJsonText(snapshot.readResult)}::text)::jsonb,
						${snapshot.readFailureReason ?? null}, true, now(), ${provenance?.indexerRunId ?? null}, ${provenance?.abiSourceHash ?? null},
						${provenance?.applicationSourceHash ?? null}, ${provenance?.projectionSourceHash ?? null}
					)
				`
				await transaction`
					INSERT INTO entity_state_snapshots (
						chain_id, entity_type, entity_identity, block_number, block_hash, block_timestamp,
						source_method, read_status, read_result, read_failure_reason, canonical, observed_at,
						indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
					) VALUES (
						${chainId}, ${snapshot.entityType}, ${snapshot.entityIdentity}, ${blockNumber.toString()}, ${blockHash}, ${blockTimestamp},
						${snapshot.sourceMethod}, ${snapshot.readStatus}, (${snapshot.readResult === undefined ? null : databaseJsonText(snapshot.readResult)}::text)::jsonb,
						${snapshot.readFailureReason ?? null}, true, now(), ${provenance?.indexerRunId ?? null}, ${provenance?.abiSourceHash ?? null},
						${provenance?.applicationSourceHash ?? null}, ${provenance?.projectionSourceHash ?? null}
					)
					ON CONFLICT (chain_id, entity_type, entity_identity, block_hash, source_method) DO UPDATE SET
						read_status = EXCLUDED.read_status, read_result = EXCLUDED.read_result,
						read_failure_reason = EXCLUDED.read_failure_reason, canonical = true, observed_at = now(),
						indexer_run_id = EXCLUDED.indexer_run_id, abi_source_hash = EXCLUDED.abi_source_hash,
						application_source_hash = EXCLUDED.application_source_hash, projection_source_hash = EXCLUDED.projection_source_hash
				`
			}
		})
	}

	async storeRichListBalances(
		chainId: number,
		blockNumber: bigint,
		blockHash: Hash,
		balances: readonly RichListBalance[],
		lease: IndexerLease,
		provenance?: EvidenceProvenance,
	): Promise<void> {
		if (balances.length === 0) return
		await withIndexerLease(lease, async (transaction) => {
			const canonicalRows = await transaction`
				SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${blockNumber.toString()} AND hash = ${blockHash} AND canonical
			`
			if (canonicalRows.length !== 1) throw new DatabaseConsistencyError('Cannot store rich-list balances for a noncanonical block')
			for (const balance of balances) {
				const readStatus = balance.readStatus ?? 'success'
				await transaction`
					INSERT INTO address_balance_observations (
						chain_id, block_hash, block_number, address, asset_address, asset_kind,
						read_status, balance, read_failure_reason, canonical,
						observed_at, indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
					) VALUES (
						${chainId}, ${blockHash}, ${blockNumber.toString()}, ${balance.owner.toLowerCase()},
						${balance.assetAddress.toLowerCase()}, ${balance.assetKind}, ${readStatus},
						${balance.balance?.toString() ?? null}, ${balance.readFailureReason ?? null}, true,
						now(), ${provenance?.indexerRunId ?? null}, ${provenance?.abiSourceHash ?? null},
						${provenance?.applicationSourceHash ?? null}, ${provenance?.projectionSourceHash ?? null}
					)
				`
				if (balance.readStatus === 'failed') continue
				await transaction`
					INSERT INTO address_balance_snapshots (chain_id, block_hash, block_number, address, asset_address, asset_kind, balance, canonical, observed_at)
					VALUES (${chainId}, ${blockHash}, ${blockNumber.toString()}, ${balance.owner.toLowerCase()}, ${balance.assetAddress.toLowerCase()}, ${balance.assetKind}, ${balance.balance.toString()}, true, now())
					ON CONFLICT (chain_id, block_hash, address, asset_address) DO UPDATE SET
						asset_kind = EXCLUDED.asset_kind, balance = EXCLUDED.balance, canonical = true, observed_at = now()
				`
			}
		})
	}
}

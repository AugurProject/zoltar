import { databaseJsonText } from '../database-json.ts'
import type { Hash } from '../ethereum.ts'
import { canonicalHistoryPolicies, captureDirectObservationInvalidation, captureHistoryInvalidation, type IndexerLease, invalidateHistoryPolicy, recordChainReorganization, withIndexerLease, withOptionalIndexerLease } from './history.ts'
import { ScannerObservationRepository } from './observation-repository.ts'
import { assertRewindTarget, type EvidenceProvenance, type HistoryInvalidationReason, lockLiveEventWriter, rewindDepth } from './records.ts'

export class ScannerHistoryRepository extends ScannerObservationRepository {
	async checkpoint(chainId: number, lease?: IndexerLease): Promise<{ readonly number: bigint; readonly hash: Hash } | undefined> {
		return await withOptionalIndexerLease(this.sql, lease, async sql => {
			const rows = await sql`SELECT indexed_block, indexed_hash FROM networks WHERE chain_id = ${chainId}`
			const row = rows[0]
			if (row === undefined || row['indexed_block'] === null || row['indexed_hash'] === null) return undefined
			return { number: BigInt(String(row['indexed_block'])), hash: String(row['indexed_hash']) as Hash }
		})
	}

	async networkStartBlock(chainId: number, lease?: IndexerLease): Promise<bigint | undefined> {
		return await withOptionalIndexerLease(this.sql, lease, async sql => {
			const rows = await sql`SELECT start_block FROM networks WHERE chain_id = ${chainId}`
			const startBlock = rows[0]?.['start_block']
			return startBlock === undefined ? undefined : BigInt(String(startBlock))
		})
	}

	async hasStoredBlocks(chainId: number, lease?: IndexerLease): Promise<boolean> {
		return await withOptionalIndexerLease(this.sql, lease, async sql => {
			const rows = await sql`SELECT EXISTS (SELECT 1 FROM blocks WHERE chain_id = ${chainId}) AS present`
			return rows[0]?.['present'] === true
		})
	}

	async storedBlockTip(chainId: number, lease?: IndexerLease): Promise<bigint | undefined> {
		return await withOptionalIndexerLease(this.sql, lease, async sql => {
			const rows = await sql`SELECT max(number) AS number FROM blocks WHERE chain_id = ${chainId}`
			const number = rows[0]?.['number']
			return number === null || number === undefined ? undefined : BigInt(String(number))
		})
	}

	async canonicalHash(chainId: number, number: bigint, lease?: IndexerLease): Promise<Hash | undefined> {
		return await withOptionalIndexerLease(this.sql, lease, async sql => {
			const rows = await sql`SELECT hash FROM blocks WHERE chain_id = ${chainId} AND number = ${number.toString()} AND canonical`
			const hash = rows[0]?.['hash']
			return hash === undefined ? undefined : (String(hash) as Hash)
		})
	}

	async canonicalCheckpointAtOrBefore(chainId: number, number: bigint, lease?: IndexerLease): Promise<{ readonly number: bigint; readonly hash: Hash } | undefined> {
		return await withOptionalIndexerLease(this.sql, lease, async sql => {
			const rows = await sql`
				SELECT number, hash FROM blocks
				WHERE chain_id = ${chainId} AND number <= ${number.toString()} AND canonical
				ORDER BY number DESC LIMIT 1
			`
			const row = rows[0]
			return row === undefined ? undefined : { number: BigInt(String(row['number'])), hash: String(row['hash']) as Hash }
		})
	}

	async rewind(chainId: number, ancestor: bigint, ancestorHash: Hash | undefined, lease: IndexerLease, reason: Extract<HistoryInvalidationReason, 'chain-reorg' | 'manifest-reset'> = 'chain-reorg', provenance?: EvidenceProvenance): Promise<void> {
		await withIndexerLease(lease, async transaction => {
			const checkpointRows = await transaction`SELECT start_block, indexed_block, indexed_hash FROM networks WHERE chain_id = ${chainId} FOR UPDATE`
			const checkpoint = checkpointRows[0]
			if (checkpoint === undefined) throw new Error(`Network ${chainId} must be seeded before rewinding`)
			const targetRows = ancestor < 0n ? [] : await transaction`SELECT 1 FROM blocks WHERE chain_id = ${chainId} AND number = ${ancestor.toString()} AND hash = ${ancestorHash ?? ''} AND canonical`
			assertRewindTarget(
				ancestor,
				ancestorHash,
				{
					...(checkpoint['indexed_block'] === null ? {} : { indexedBlock: BigInt(String(checkpoint['indexed_block'])) }),
					...(checkpoint['indexed_hash'] === null ? {} : { indexedHash: String(checkpoint['indexed_hash']) }),
				},
				targetRows.length === 1,
			)
			const previousBlock = BigInt(String(checkpoint['indexed_block']))
			const reorgDepth = rewindDepth(previousBlock, BigInt(String(checkpoint['start_block'])), ancestor)
			const invalidationId = await recordChainReorganization(transaction, chainId, previousBlock, typeof checkpoint['indexed_hash'] === 'string' ? checkpoint['indexed_hash'] : undefined, ancestor, ancestorHash, reorgDepth, reason, [reason], provenance)
			await captureHistoryInvalidation(transaction, invalidationId, chainId, ancestor)
			await captureDirectObservationInvalidation(transaction, invalidationId, chainId, { afterBlock: ancestor })
			for (const policy of canonicalHistoryPolicies) await invalidateHistoryPolicy(transaction, policy, chainId, { comparison: '>', block: ancestor })
			await transaction`DELETE FROM log_scan_cursors WHERE chain_id = ${chainId} AND start_block > ${ancestor.toString()}`
			await transaction`
				UPDATE log_scan_cursors SET
					last_retrieved_block = GREATEST(start_block - 1, ${ancestor.toString()}::bigint),
					updated_at = now()
				WHERE chain_id = ${chainId} AND last_retrieved_block > ${ancestor.toString()}
			`
			await transaction`
				UPDATE contracts SET
					deployment_block = CASE WHEN deployment_block > ${ancestor.toString()} THEN NULL ELSE deployment_block END,
					deployment_timestamp = CASE WHEN deployment_block > ${ancestor.toString()} THEN NULL ELSE deployment_timestamp END,
					deployment_block_exact = CASE WHEN deployment_block > ${ancestor.toString()} THEN NULL ELSE deployment_block_exact END,
					deployment_checked_block = CASE WHEN deployment_checked_block > ${ancestor.toString()} THEN NULL ELSE deployment_checked_block END
				WHERE chain_id = ${chainId} AND (deployment_block > ${ancestor.toString()} OR deployment_checked_block > ${ancestor.toString()})
			`
			await transaction`
				UPDATE contracts SET canonical = false
				WHERE chain_id = ${chainId} AND provenance <> 'manifest'
					AND (discovery_block IS NULL OR discovery_block >= ${String(checkpoint['start_block'])})
					AND (discovery_block IS NULL OR discovery_block > ${ancestor.toString()})
			`
			await transaction`
				UPDATE contracts AS contract SET
					label = discovery.label,
					kind = discovery.kind,
					provenance = discovery.provenance,
					discovery_block = discovery.block_number,
					discovery_tx_hash = discovery.tx_hash,
					canonical = true
				FROM (
					SELECT DISTINCT ON (address) address, label, kind, provenance, block_number, tx_hash
					FROM contract_discoveries
					WHERE chain_id = ${chainId} AND canonical
					ORDER BY address, block_number DESC
				) AS discovery
				WHERE contract.chain_id = ${chainId}
					AND contract.address = discovery.address
					AND NOT contract.canonical
			`
			await transaction`
				UPDATE token_metadata AS metadata SET canonical = true, updated_at = now()
				FROM (
					SELECT DISTINCT ON (candidate.address) candidate.address, candidate.block_hash
					FROM token_metadata AS candidate
					JOIN blocks AS block ON block.chain_id = candidate.chain_id AND block.hash = candidate.block_hash
					WHERE candidate.chain_id = ${chainId} AND block.canonical
					ORDER BY candidate.address, candidate.read_block DESC, candidate.updated_at DESC
				) AS previous
				WHERE metadata.chain_id = ${chainId}
					AND metadata.address = previous.address
					AND metadata.block_hash = previous.block_hash
					AND NOT metadata.canonical
			`
			await transaction`
				UPDATE networks SET indexed_block = ${ancestor < 0n ? null : ancestor.toString()}, indexed_hash = ${ancestorHash ?? null},
					indexed_timestamp = (SELECT timestamp FROM blocks WHERE chain_id = ${chainId} AND hash = ${ancestorHash ?? null}), phase = 'backfilling',
					last_reorg_at = now(), last_reorg_depth = ${reorgDepth.toString()}, updated_at = now()
				WHERE chain_id = ${chainId}
			`
			await lockLiveEventWriter(transaction)
			await transaction`
				INSERT INTO live_events (event, payload)
				VALUES ('reorg', (${databaseJsonText({ chainId, previousBlock: previousBlock.toString(), ancestor: ancestor.toString(), depth: reorgDepth.toString(), reason })}::text)::jsonb)
			`
		})
	}
}

import type { SQL } from 'bun'
import { databaseJsonText } from '../database-json.ts'
import { storeLogProjections } from '../database-projections.ts'
import {
	captureDirectObservationInvalidation,
	captureHistoryInvalidation,
	type IndexerLease,
	invalidateCanonicalHistory,
	recordChainReorganization,
	withIndexerLease,
} from './history.ts'
import { ScannerHistoryRepository } from './history-repository.ts'
import {
	assertBlockAppend,
	assertContractDeploymentObservation,
	assertLogScanCursorUpdate,
	DatabaseConsistencyError,
	type EvidenceProvenance,
	type IndexedBlock,
	lockLiveEventWriter,
	serializedInterpretation,
} from './records.ts'

export class ScannerDatabase extends ScannerHistoryRepository {
	async storeBlock(chainId: number, block: IndexedBlock, lease: IndexerLease, provenance?: EvidenceProvenance): Promise<void> {
		await this.storeBlocks(chainId, [block], lease, provenance)
	}

	async storeBlocks(
		chainId: number,
		blocks: readonly IndexedBlock[],
		lease: IndexerLease,
		provenance?: EvidenceProvenance,
		validateBeforeCommit: () => Promise<void> = async () => {},
	): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			for (const block of blocks) await this.#storeBlock(transaction, chainId, block, provenance)
			await validateBeforeCommit()
		})
	}

	async #storeBlock(transaction: SQL, chainId: number, block: IndexedBlock, provenance?: EvidenceProvenance): Promise<void> {
		const checkpointRows = await transaction`SELECT start_block, indexed_block, indexed_hash FROM networks WHERE chain_id = ${chainId} FOR UPDATE`
		const checkpoint = checkpointRows[0]
		if (checkpoint === undefined) throw new Error(`Network ${chainId} must be seeded before indexing`)
		assertBlockAppend(block, {
			startBlock: BigInt(String(checkpoint['start_block'])),
			...(checkpoint['indexed_block'] === null ? {} : { indexedBlock: BigInt(String(checkpoint['indexed_block'])) }),
			...(checkpoint['indexed_hash'] === null ? {} : { indexedHash: String(checkpoint['indexed_hash']) }),
		})
		await transaction`
				INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical, finalized)
				VALUES (${chainId}, ${block.number.toString()}, ${block.hash}, ${block.parentHash}, ${block.timestamp}, true, ${block.number <= block.finalizedThrough})
				ON CONFLICT (chain_id, hash) DO UPDATE SET canonical = true, finalized = EXCLUDED.finalized
			`
		for (const metadata of block.tokenMetadata) {
			const readStatus = metadata.readError === undefined ? 'success' : 'failed'
			await transaction`
					INSERT INTO token_metadata_observations (
						chain_id, address, block_hash, name, symbol, decimals, read_status, read_error, read_block, canonical,
						observed_at, indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash
					) VALUES (
						${chainId}, ${metadata.address.toLowerCase()}, ${block.hash}, ${metadata.name ?? null}, ${metadata.symbol ?? null},
						${metadata.decimals ?? null}, ${readStatus}, ${metadata.readError ?? null}, ${metadata.readBlock.toString()}, true,
						now(), ${provenance?.indexerRunId ?? null}, ${provenance?.abiSourceHash ?? null},
						${provenance?.applicationSourceHash ?? null}, ${provenance?.projectionSourceHash ?? null}
					)
				`
			if (readStatus === 'failed') {
				const successfulCurrentMetadata = await transaction`
						SELECT 1 FROM token_metadata
						WHERE chain_id = ${chainId} AND address = ${metadata.address.toLowerCase()}
							AND canonical AND read_error IS NULL
						LIMIT 1
					`
				if (successfulCurrentMetadata.length > 0) continue
			}
			await transaction`UPDATE token_metadata SET canonical = false WHERE chain_id = ${chainId} AND address = ${metadata.address.toLowerCase()} AND canonical AND block_hash <> ${block.hash}`
			await transaction`
					INSERT INTO token_metadata (chain_id, address, block_hash, name, symbol, decimals, read_error, read_block, canonical, updated_at)
					VALUES (${chainId}, ${metadata.address.toLowerCase()}, ${block.hash}, ${metadata.name ?? null}, ${metadata.symbol ?? null}, ${metadata.decimals ?? null}, ${metadata.readError ?? null}, ${metadata.readBlock.toString()}, true, now())
					ON CONFLICT (chain_id, address, block_hash) DO UPDATE SET name = EXCLUDED.name, symbol = EXCLUDED.symbol, decimals = EXCLUDED.decimals, read_error = EXCLUDED.read_error, read_block = EXCLUDED.read_block, canonical = true, updated_at = now()
				`
		}
		for (const contract of block.contracts) {
			if (contract.discoveryTxHash === undefined || contract.discoveryBlock === undefined)
				throw new Error('Dynamic contract discovery is missing its chain position')
			await transaction`
					INSERT INTO contract_discoveries (chain_id, address, block_hash, block_number, tx_hash, label, kind, provenance, canonical)
					VALUES (${chainId}, ${contract.address.toLowerCase()}, ${block.hash}, ${contract.discoveryBlock.toString()}, ${contract.discoveryTxHash}, ${contract.label}, ${contract.kind}, ${contract.provenance}, true)
					ON CONFLICT (chain_id, address, block_hash, tx_hash) DO UPDATE SET canonical = true
				`
			await transaction`
					INSERT INTO contracts (chain_id, address, label, kind, provenance, discovery_block, discovery_tx_hash, canonical, deployment_block, deployment_timestamp, deployment_block_exact, deployment_checked_block)
					VALUES (${chainId}, ${contract.address.toLowerCase()}, ${contract.label}, ${contract.kind}, ${contract.provenance}, ${contract.discoveryBlock?.toString() ?? null}, ${contract.discoveryTxHash ?? null}, true, ${contract.discoveryBlock.toString()}, ${block.timestamp}, true, ${block.number.toString()})
					ON CONFLICT (chain_id, address) DO UPDATE SET
						canonical = true,
						label = CASE WHEN contracts.provenance = 'manifest' THEN contracts.label ELSE EXCLUDED.label END,
						kind = CASE WHEN contracts.provenance = 'manifest' THEN contracts.kind ELSE EXCLUDED.kind END,
						provenance = CASE WHEN contracts.provenance = 'manifest' THEN contracts.provenance ELSE EXCLUDED.provenance END,
						discovery_block = CASE WHEN contracts.provenance = 'manifest' THEN contracts.discovery_block ELSE EXCLUDED.discovery_block END,
						discovery_tx_hash = CASE WHEN contracts.provenance = 'manifest' THEN contracts.discovery_tx_hash ELSE EXCLUDED.discovery_tx_hash END,
						deployment_block = COALESCE(contracts.deployment_block, EXCLUDED.deployment_block),
						deployment_timestamp = COALESCE(contracts.deployment_timestamp, EXCLUDED.deployment_timestamp),
						deployment_block_exact = COALESCE(contracts.deployment_block_exact, EXCLUDED.deployment_block_exact),
						deployment_checked_block = GREATEST(contracts.deployment_checked_block, EXCLUDED.deployment_checked_block)
				`
		}
		for (const observation of block.contractDeploymentObservations) {
			assertContractDeploymentObservation(block.number, observation)
			await transaction`
					UPDATE contracts SET
						deployment_block = ${observation.deployment?.block.toString() ?? null},
						deployment_timestamp = ${observation.deployment?.timestamp ?? null},
						deployment_block_exact = ${observation.deployment?.exact ?? null},
						deployment_checked_block = ${observation.checkedBlock.toString()}
					WHERE chain_id = ${chainId} AND address = ${observation.contractAddress.toLowerCase()} AND canonical
				`
		}
		for (const item of block.transactions) {
			await transaction`
					INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, gas_used, receipt, canonical)
					VALUES (${chainId}, ${item.hash}, ${block.hash}, ${block.number.toString()}, ${item.transactionIndex}, ${item.from.toLowerCase()}, ${item.to?.toLowerCase() ?? null}, ${item.value.toString()}, ${item.input}, ${item.status}, ${item.gasUsed.toString()}, (${databaseJsonText(item.receipt)}::text)::jsonb, true)
					ON CONFLICT (chain_id, block_hash, hash) DO UPDATE SET canonical = true
				`
			await transaction`
					INSERT INTO actions (chain_id, block_hash, tx_hash, contract_address, function_name, function_signature, arguments, display_arguments, argument_schema, decode_status, decode_error, summary)
					VALUES (${chainId}, ${block.hash}, ${item.hash}, ${item.to?.toLowerCase() ?? null}, ${item.decoded.name ?? null}, ${item.decoded.signature ?? null}, (${databaseJsonText(item.decoded.arguments ?? null)}::text)::jsonb, (${databaseJsonText(item.decoded.displayArguments ?? null)}::text)::jsonb, (${databaseJsonText(item.decoded.argumentSchema ?? [])}::text)::jsonb, ${item.decoded.status}, ${item.decoded.error ?? null}, ${item.decoded.summary})
					ON CONFLICT (chain_id, block_hash, tx_hash) DO UPDATE SET function_name = EXCLUDED.function_name, function_signature = EXCLUDED.function_signature, arguments = EXCLUDED.arguments, display_arguments = EXCLUDED.display_arguments, argument_schema = EXCLUDED.argument_schema, decode_status = EXCLUDED.decode_status, decode_error = EXCLUDED.decode_error, summary = EXCLUDED.summary
				`
			if (provenance !== undefined)
				await transaction`
						INSERT INTO action_interpretations
							(chain_id, block_hash, tx_hash, indexer_run_id, abi_source_hash, application_source_hash, interpretation)
						VALUES (${chainId}, ${block.hash}, ${item.hash}, ${provenance.indexerRunId}, ${provenance.abiSourceHash},
							${provenance.applicationSourceHash}, (${serializedInterpretation(item.decoded)}::text)::jsonb)
						ON CONFLICT DO NOTHING
					`
		}
		for (const activity of block.addressActivity) {
			await transaction`
					INSERT INTO address_activity (chain_id, block_hash, block_number, tx_hash, address, pool_address, role, canonical)
					VALUES (${chainId}, ${block.hash}, ${block.number.toString()}, ${activity.transactionHash}, ${activity.address.toLowerCase()}, ${activity.poolAddress?.toLowerCase() ?? '0x0000000000000000000000000000000000000000'}, ${activity.role}, true)
					ON CONFLICT (chain_id, block_hash, tx_hash, address, pool_address) DO UPDATE SET role = CASE WHEN EXCLUDED.role = 'sender' THEN 'sender' ELSE address_activity.role END, canonical = true
				`
		}
		for (const item of block.logs) {
			await transaction`
					INSERT INTO logs (chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address, topics, data, event_name, event_signature, arguments, display_arguments, argument_schema, decode_status, decode_error, summary, canonical, finalized)
					VALUES (${chainId}, ${item.transactionHash}, ${item.blockHash}, ${item.blockNumber.toString()}, ${item.transactionIndex}, ${item.logIndex}, ${item.address.toLowerCase()}, (${databaseJsonText(item.topics)}::text)::jsonb, ${item.data}, ${item.decoded.name ?? null}, ${item.decoded.signature ?? null}, (${databaseJsonText(item.decoded.arguments ?? null)}::text)::jsonb, (${databaseJsonText(item.decoded.displayArguments ?? null)}::text)::jsonb, (${databaseJsonText(item.decoded.argumentSchema ?? [])}::text)::jsonb, ${item.decoded.status}, ${item.decoded.error ?? null}, ${item.decoded.summary}, true, ${item.blockNumber <= block.finalizedThrough})
					ON CONFLICT (chain_id, block_hash, tx_hash, log_index) DO UPDATE SET canonical = true, finalized = EXCLUDED.finalized, event_name = EXCLUDED.event_name, event_signature = EXCLUDED.event_signature, arguments = EXCLUDED.arguments, display_arguments = EXCLUDED.display_arguments, argument_schema = EXCLUDED.argument_schema, decode_status = EXCLUDED.decode_status, decode_error = EXCLUDED.decode_error, summary = EXCLUDED.summary
				`
			if (provenance !== undefined)
				await transaction`
						INSERT INTO log_interpretations
							(chain_id, block_hash, tx_hash, log_index, interpretation_kind, interpretation_key,
								indexer_run_id, abi_source_hash, application_source_hash, projection_source_hash, interpretation)
						VALUES (${chainId}, ${item.blockHash}, ${item.transactionHash}, ${item.logIndex}, 'decode', 'decode',
							${provenance.indexerRunId}, ${provenance.abiSourceHash}, ${provenance.applicationSourceHash},
							${provenance.projectionSourceHash}, (${serializedInterpretation(item.decoded)}::text)::jsonb)
						ON CONFLICT DO NOTHING
					`
			await storeLogProjections(transaction, chainId, item, provenance)
		}
		for (const cursor of block.logScanCursors) {
			assertLogScanCursorUpdate(block.number, cursor)
			await transaction`
					INSERT INTO log_scan_cursors (chain_id, contract_address, start_block, last_retrieved_block, updated_at)
					VALUES (${chainId}, ${cursor.contractAddress.toLowerCase()}, ${cursor.startBlock.toString()}, ${cursor.lastRetrievedBlock.toString()}, now())
					ON CONFLICT (chain_id, contract_address) DO UPDATE SET
						start_block = LEAST(log_scan_cursors.start_block, EXCLUDED.start_block),
						last_retrieved_block = EXCLUDED.last_retrieved_block,
						updated_at = now()
					WHERE log_scan_cursors.last_retrieved_block <= EXCLUDED.last_retrieved_block
				`
		}
		await transaction`UPDATE blocks SET finalized = true WHERE chain_id = ${chainId} AND canonical AND NOT finalized AND number <= ${block.finalizedThrough.toString()}`
		await transaction`UPDATE logs SET finalized = true WHERE chain_id = ${chainId} AND canonical AND NOT finalized AND block_number <= ${block.finalizedThrough.toString()}`
		await transaction`
				UPDATE networks SET indexed_block = ${block.number.toString()}, indexed_hash = ${block.hash}, indexed_timestamp = ${block.timestamp}, observed_block = ${block.observedHead.toString()}, finalized_block = ${block.finalizedThrough.toString()}, phase = ${block.number >= block.observedHead ? 'live' : 'backfilling'}, last_poll_at = now(), last_success_at = now(), last_error = null, failure_started_at = null, consecutive_failures = 0, next_retry_at = null, updated_at = now()
				WHERE chain_id = ${chainId}
			`
		await lockLiveEventWriter(transaction)
		await transaction`
				INSERT INTO live_events (event, payload)
				VALUES ('block', (${databaseJsonText({ chainId, blockNumber: block.number.toString(), logs: block.logs.length })}::text)::jsonb)
			`
	}

	async updateObservedHead(chainId: number, head: bigint, phase: string, lease: IndexerLease): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			await transaction`UPDATE networks SET observed_block = ${head.toString()}, phase = ${phase}, last_poll_at = now(), last_success_at = now(), last_error = null, failure_started_at = null, consecutive_failures = 0, next_retry_at = null, updated_at = now() WHERE chain_id = ${chainId}`
			await lockLiveEventWriter(transaction)
			await transaction`INSERT INTO live_events (event, payload) VALUES ('status', (${databaseJsonText({ chainId, blockNumber: head.toString() })}::text)::jsonb)`
		})
	}

	async advanceNetworkStartBlock(chainId: number, startBlock: bigint, lease: IndexerLease, provenance?: EvidenceProvenance): Promise<boolean> {
		return await withIndexerLease(lease, async (transaction) => {
			const rows = await transaction`SELECT start_block, indexed_block, indexed_hash FROM networks WHERE chain_id = ${chainId} FOR UPDATE`
			const row = rows[0]
			if (row === undefined) throw new DatabaseConsistencyError(`Network ${chainId} is not initialized`)
			const storedStartBlock = BigInt(String(row['start_block']))
			if (startBlock <= storedStartBlock) return false
			const previousBlock = row['indexed_block'] === null || row['indexed_block'] === undefined ? undefined : BigInt(String(row['indexed_block']))
			const invalidatedDepth = previousBlock === undefined ? 0n : previousBlock - storedStartBlock + 1n
			const invalidationId = await recordChainReorganization(
				transaction,
				chainId,
				previousBlock,
				typeof row['indexed_hash'] === 'string' ? row['indexed_hash'] : undefined,
				-1n,
				undefined,
				invalidatedDepth,
				'start-boundary-advanced',
				['start-boundary-advanced'],
				provenance,
			)
			await captureHistoryInvalidation(transaction, invalidationId, chainId)
			await captureDirectObservationInvalidation(transaction, invalidationId, chainId, { beforeBlock: startBlock })
			await invalidateCanonicalHistory(transaction, chainId, startBlock)
			await transaction`
				UPDATE networks SET start_block = ${startBlock.toString()}, indexed_block = NULL, indexed_hash = NULL,
					indexed_timestamp = NULL, finalized_block = NULL, phase = 'backfilling', last_poll_at = now(),
					last_success_at = now(), last_error = NULL, failure_started_at = NULL, consecutive_failures = 0,
					last_reorg_at = now(), last_reorg_depth = ${invalidatedDepth.toString()},
					next_retry_at = NULL, updated_at = now()
				WHERE chain_id = ${chainId}
			`
			await lockLiveEventWriter(transaction)
			await transaction`
				INSERT INTO live_events (event, payload)
				VALUES ('reorg', (${databaseJsonText({ chainId, previousBlock: previousBlock?.toString(), ancestor: '-1', depth: invalidatedDepth.toString(), startBlock: startBlock.toString(), reason: 'start-boundary-advanced' })}::text)::jsonb)
			`
			return true
		})
	}

	async recordFailure(chainId: number, message: string, nextRetryAt: Date, lease: IndexerLease): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			const rows = await transaction`
				UPDATE networks SET phase = 'degraded', last_error = ${message.slice(0, 2000)}, last_poll_at = now(),
					failure_started_at = COALESCE(failure_started_at, now()), consecutive_failures = consecutive_failures + 1,
					next_retry_at = ${nextRetryAt}, updated_at = now()
				WHERE chain_id = ${chainId}
				RETURNING consecutive_failures
			`
			await lockLiveEventWriter(transaction)
			await transaction`
				INSERT INTO live_events (event, payload)
				VALUES ('status', (${databaseJsonText({ chainId, phase: 'degraded', nextRetryAt: nextRetryAt.toISOString(), failures: Number(rows[0]?.['consecutive_failures'] ?? 1) })}::text)::jsonb)
			`
		})
	}
}

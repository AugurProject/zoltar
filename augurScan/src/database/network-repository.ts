import type { SQL } from 'bun'
import { databaseJsonText } from '../database-json.ts'
import { type Address, getAddress } from '../ethereum.ts'
import { normalizeSnapshotTarget, type StateSnapshotTarget } from '../snapshots.ts'
import type { ContractMetadata, NetworkConfig, TokenMetadata } from '../types.ts'
import { ScannerDatabaseConnection } from './connection.ts'
import {
	captureHistoryInvalidation,
	clearInvalidatedDerivedProjections,
	type IndexerLease,
	invalidateCanonicalHistory,
	recordChainReorganization,
	type SeedNetworkOptions,
	type SourceReplayPlan,
	withIndexerLease,
	withOptionalIndexerLease,
} from './history.ts'
import {
	assertStartBlockCompatible,
	contractMetadataFromRow,
	DatabaseConsistencyError,
	type HistoryInvalidationReason,
	type InterpretationSourceHashes,
	type LogScanCursor,
	lockLiveEventWriter,
	manifestContractSetChanged,
	type RichListBalanceTargets,
} from './records.ts'

export class ScannerNetworkRepository extends ScannerDatabaseConnection {
	async seedNetwork(network: NetworkConfig, options: SeedNetworkOptions = {}): Promise<boolean> {
		const { lease, resetCanonicalHistoryOnManifestChange = false, preserveStoredStart = false, sourceReplayPlan, appliedSourceHashes } = options
		if (appliedSourceHashes !== undefined && lease === undefined) throw new DatabaseConsistencyError('Applied source hashes require the network indexer lease')
		const operation = async (transaction: SQL): Promise<boolean> => {
			const existingRows = await transaction`
				SELECT start_block, indexed_block, indexed_hash
				FROM networks
				WHERE chain_id = ${network.chainId}
				FOR UPDATE
			`
			const existing = existingRows[0]
			const hasStoredBlocks =
				existing !== undefined &&
				(await transaction`SELECT EXISTS (SELECT 1 FROM blocks WHERE chain_id = ${network.chainId}) AS present`)[0]?.['present'] === true
			const storedManifestRows =
				existing === undefined
					? []
					: await transaction`
						SELECT address, label, kind, configured_deployment_block
						FROM contracts WHERE chain_id = ${network.chainId} AND provenance = 'manifest' AND canonical
					`
			const manifestChanged =
				existing !== undefined &&
				manifestContractSetChanged(
					network.contracts,
					storedManifestRows.map((row: Record<string, unknown>) => {
						const configuredDeploymentBlock = row['configured_deployment_block']
						return {
							address: String(row['address']),
							label: String(row['label']),
							kind: String(row['kind']),
							...(configuredDeploymentBlock === null || configuredDeploymentBlock === undefined
								? {}
								: { configuredDeploymentBlock: BigInt(String(configuredDeploymentBlock)) }),
						}
					}),
				)
			if (existing !== undefined) {
				assertStartBlockCompatible(
					network.startBlock,
					BigInt(String(existing['start_block'])),
					existing['indexed_block'] === null || existing['indexed_block'] === undefined ? undefined : BigInt(String(existing['indexed_block'])),
					hasStoredBlocks || preserveStoredStart,
				)
			}
			await transaction`
				INSERT INTO networks
					(chain_id, id, name, explorer_base_url, start_block, applied_abi_source_hash, applied_application_source_hash,
						applied_projection_source_hash)
				VALUES (${network.chainId}, ${network.id}, ${network.name}, ${network.explorerBaseUrl}, ${network.startBlock.toString()},
					${appliedSourceHashes?.abiSourceHash ?? null}, ${appliedSourceHashes?.applicationSourceHash ?? null},
					${appliedSourceHashes?.projectionSourceHash ?? null})
				ON CONFLICT (chain_id) DO UPDATE SET
					id = EXCLUDED.id,
					name = EXCLUDED.name,
					explorer_base_url = EXCLUDED.explorer_base_url,
					start_block = EXCLUDED.start_block,
					applied_abi_source_hash = COALESCE(EXCLUDED.applied_abi_source_hash, networks.applied_abi_source_hash),
					applied_application_source_hash = COALESCE(EXCLUDED.applied_application_source_hash, networks.applied_application_source_hash),
					applied_projection_source_hash = COALESCE(EXCLUDED.applied_projection_source_hash, networks.applied_projection_source_hash),
					updated_at = now()
			`
			await transaction`UPDATE contracts SET canonical = false WHERE chain_id = ${network.chainId} AND provenance = 'manifest'`
			for (const [address, label, kind, configuredDeploymentBlock] of network.contracts) {
				await this.upsertContract(
					network.chainId,
					{ address, label, kind, provenance: 'manifest', ...(configuredDeploymentBlock === undefined ? {} : { configuredDeploymentBlock }) },
					transaction,
				)
			}
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
					WHERE chain_id = ${network.chainId} AND canonical
					ORDER BY address, block_number DESC
				) AS discovery
				WHERE contract.chain_id = ${network.chainId}
					AND contract.address = discovery.address
					AND NOT contract.canonical
			`
			await transaction`
				UPDATE contracts AS contract SET
					label = discovery.label,
					kind = discovery.kind,
					provenance = discovery.provenance,
					canonical = true
				FROM (
					SELECT DISTINCT ON (candidate.address)
						candidate.address, candidate.label, candidate.kind, candidate.provenance
					FROM contract_discoveries AS candidate
					JOIN contracts AS retained
						ON retained.chain_id = candidate.chain_id
						AND retained.address = candidate.address
						AND retained.discovery_block = candidate.block_number
						AND retained.discovery_tx_hash = candidate.tx_hash
					JOIN networks AS network ON network.chain_id = candidate.chain_id
					WHERE candidate.chain_id = ${network.chainId} AND candidate.block_number < network.start_block
					ORDER BY candidate.address, candidate.canonical DESC, candidate.block_hash
				) AS discovery
				WHERE contract.chain_id = ${network.chainId}
					AND contract.address = discovery.address
					AND contract.provenance = 'manifest'
					AND NOT contract.canonical
			`
			await transaction`
				UPDATE contracts SET provenance = 'retired-manifest'
				WHERE chain_id = ${network.chainId} AND provenance = 'manifest' AND NOT canonical
			`
			const manifestResetReason = manifestChanged && resetCanonicalHistoryOnManifestChange ? ('manifest-reset' as const) : undefined
			const resetReason = sourceReplayPlan?.reason ?? manifestResetReason
			const resetCauses =
				resetReason === undefined
					? []
					: [...new Set([resetReason, ...(sourceReplayPlan?.causes ?? []), manifestResetReason].filter((reason) => reason !== undefined))]
			if (resetReason !== undefined && existing?.['indexed_block'] !== null && existing?.['indexed_block'] !== undefined) {
				const previousBlock = BigInt(String(existing['indexed_block']))
				const depth = previousBlock - network.startBlock + 1n
				const invalidationId = await recordChainReorganization(
					transaction,
					network.chainId,
					previousBlock,
					typeof existing['indexed_hash'] === 'string' ? existing['indexed_hash'] : undefined,
					-1n,
					undefined,
					depth,
					resetReason,
					resetCauses,
					appliedSourceHashes,
				)
				await captureHistoryInvalidation(transaction, invalidationId, network.chainId)
				await invalidateCanonicalHistory(transaction, network.chainId)
				if (resetReason === 'manifest-reset' || resetReason === 'abi-redecode' || resetReason === 'projection-rebuild')
					await clearInvalidatedDerivedProjections(transaction, invalidationId)
				await transaction`
					UPDATE networks SET indexed_block = NULL, indexed_hash = NULL, indexed_timestamp = NULL, finalized_block = NULL, phase = 'backfilling',
						last_reorg_at = now(), last_reorg_depth = ${depth.toString()}, updated_at = now()
					WHERE chain_id = ${network.chainId}
				`
				await lockLiveEventWriter(transaction)
				await transaction`
					INSERT INTO live_events (event, payload)
					VALUES ('reorg', (${databaseJsonText({ chainId: network.chainId, previousBlock: previousBlock.toString(), ancestor: '-1', depth: depth.toString(), reason: resetReason, reasons: resetCauses })}::text)::jsonb)
				`
			}
			return manifestChanged || resetReason !== undefined
		}
		if (lease === undefined) return await this.sql.begin(operation)
		return await withIndexerLease(lease, operation)
	}

	async sourceReplayPlan(chainId: number, sourceHashes: InterpretationSourceHashes, lease?: IndexerLease): Promise<SourceReplayPlan | undefined> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`
					SELECT applied_abi_source_hash, applied_application_source_hash, applied_projection_source_hash, indexed_block
				FROM networks
				WHERE chain_id = ${chainId}
			`
			const row = rows[0]
			const appliedAbiSourceHash = row?.['applied_abi_source_hash']
			const appliedApplicationSourceHash = row?.['applied_application_source_hash']
			const appliedProjectionSourceHash = row?.['applied_projection_source_hash']
			if (row?.['indexed_block'] === null || row?.['indexed_block'] === undefined) return undefined
			if (typeof appliedAbiSourceHash !== 'string' || typeof appliedApplicationSourceHash !== 'string' || typeof appliedProjectionSourceHash !== 'string')
				return { reason: 'abi-redecode', causes: ['abi-redecode', 'projection-rebuild'] }
			const causes: Array<Extract<HistoryInvalidationReason, 'abi-redecode' | 'projection-rebuild'>> = []
			if (appliedAbiSourceHash !== sourceHashes.abiSourceHash) causes.push('abi-redecode')
			if (appliedApplicationSourceHash !== sourceHashes.applicationSourceHash || appliedProjectionSourceHash !== sourceHashes.projectionSourceHash)
				causes.push('projection-rebuild')
			const reason = causes[0]
			return reason === undefined ? undefined : { reason, causes }
		})
	}

	async upsertContract(chainId: number, contract: ContractMetadata, sql: SQL = this.sql): Promise<void> {
		await sql`
			INSERT INTO contracts
				(chain_id, address, label, kind, provenance, discovery_block, discovery_tx_hash, configured_deployment_block)
			VALUES (${chainId}, ${contract.address.toLowerCase()}, ${contract.label}, ${contract.kind}, ${contract.provenance},
				${contract.discoveryBlock?.toString() ?? null}, ${contract.discoveryTxHash ?? null}, ${contract.configuredDeploymentBlock?.toString() ?? null})
			ON CONFLICT (chain_id, address) DO UPDATE SET
				label = CASE WHEN EXCLUDED.provenance = 'manifest' THEN EXCLUDED.label WHEN contracts.provenance = 'manifest' THEN contracts.label ELSE EXCLUDED.label END,
				kind = CASE WHEN EXCLUDED.provenance = 'manifest' THEN EXCLUDED.kind WHEN contracts.provenance = 'manifest' THEN contracts.kind ELSE EXCLUDED.kind END,
				provenance = CASE WHEN EXCLUDED.provenance = 'manifest' OR contracts.provenance = 'manifest' THEN 'manifest' ELSE EXCLUDED.provenance END,
				discovery_block = CASE WHEN EXCLUDED.provenance = 'manifest' AND (contracts.canonical OR contracts.provenance = 'manifest') THEN contracts.discovery_block WHEN EXCLUDED.provenance = 'manifest' THEN NULL WHEN contracts.provenance = 'manifest' THEN contracts.discovery_block ELSE EXCLUDED.discovery_block END,
				discovery_tx_hash = CASE WHEN EXCLUDED.provenance = 'manifest' AND (contracts.canonical OR contracts.provenance = 'manifest') THEN contracts.discovery_tx_hash WHEN EXCLUDED.provenance = 'manifest' THEN NULL WHEN contracts.provenance = 'manifest' THEN contracts.discovery_tx_hash ELSE EXCLUDED.discovery_tx_hash END,
				configured_deployment_block = CASE WHEN EXCLUDED.provenance = 'manifest' THEN EXCLUDED.configured_deployment_block WHEN contracts.provenance = 'manifest' THEN contracts.configured_deployment_block ELSE EXCLUDED.configured_deployment_block END,
				canonical = true
		`
	}

	async contracts(chainId: number, lease?: IndexerLease): Promise<Map<string, ContractMetadata>> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows =
				await sql`SELECT address, label, kind, provenance, discovery_block, discovery_tx_hash, configured_deployment_block, deployment_block, deployment_timestamp, deployment_block_exact, deployment_checked_block FROM contracts WHERE chain_id = ${chainId} AND canonical ORDER BY address`
			return new Map(rows.map((row: Record<string, unknown>) => [String(row['address']), contractMetadataFromRow(row)]))
		})
	}

	async contractDeploymentCandidates(chainId: number, observedHead: bigint, lease: IndexerLease): Promise<readonly ContractMetadata[]> {
		const staleBefore = observedHead >= 100n ? observedHead - 100n : -1n
		return await withIndexerLease(lease, async (transaction) => {
			const rows = await transaction`
				SELECT address, label, kind, provenance, discovery_block, discovery_tx_hash, configured_deployment_block, deployment_block, deployment_timestamp,
					deployment_block_exact, deployment_checked_block
				FROM contracts
				WHERE chain_id = ${chainId} AND canonical AND deployment_block IS NULL
					AND (deployment_checked_block IS NULL OR deployment_checked_block <= ${staleBefore.toString()})
				ORDER BY deployment_checked_block NULLS FIRST, label, address
			`
			return rows.map((row: Record<string, unknown>) => contractMetadataFromRow(row))
		})
	}

	async recordContractDeployment(
		chainId: number,
		address: Address,
		checkedBlock: bigint,
		deployment: { readonly block: bigint; readonly timestamp: Date; readonly exact: boolean } | undefined,
		lease: IndexerLease,
	): Promise<void> {
		await withIndexerLease(lease, async (transaction) => {
			await transaction`
				UPDATE contracts SET
					deployment_block = ${deployment?.block.toString() ?? null},
					deployment_timestamp = ${deployment?.timestamp ?? null},
					deployment_block_exact = ${deployment?.exact ?? null},
					deployment_checked_block = ${checkedBlock.toString()}
				WHERE chain_id = ${chainId} AND address = ${address.toLowerCase()} AND canonical
			`
		})
	}

	async tokenMetadata(chainId: number, lease?: IndexerLease): Promise<Map<string, TokenMetadata>> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`
				SELECT metadata.address, metadata.name, metadata.symbol, metadata.decimals, metadata.read_error, metadata.read_block
				FROM token_metadata metadata
				JOIN blocks block ON block.chain_id = metadata.chain_id AND block.hash = metadata.block_hash AND block.canonical
				JOIN networks network ON network.chain_id = metadata.chain_id
				WHERE metadata.chain_id = ${chainId} AND metadata.canonical AND metadata.read_block <= network.indexed_block
			`
			return new Map(
				rows.map((row: Record<string, unknown>) => {
					const address = String(row['address']) as Address
					return [
						address,
						{
							address,
							...(row['name'] === null ? {} : { name: String(row['name']) }),
							...(row['symbol'] === null ? {} : { symbol: String(row['symbol']) }),
							...(row['decimals'] === null ? {} : { decimals: Number(row['decimals']) }),
							...(row['read_error'] === null ? {} : { readError: String(row['read_error']) }),
							readBlock: BigInt(String(row['read_block'])),
						},
					]
				}),
			)
		})
	}

	async logScanCursors(chainId: number, lease?: IndexerLease): Promise<Map<string, LogScanCursor>> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`
				SELECT contract_address, start_block, last_retrieved_block
				FROM log_scan_cursors
				WHERE chain_id = ${chainId}
				ORDER BY contract_address
			`
			return new Map(
				rows.map((row: Record<string, unknown>) => {
					const contractAddress = getAddress(String(row['contract_address']))
					return [
						contractAddress.toLowerCase(),
						{
							contractAddress,
							startBlock: BigInt(String(row['start_block'])),
							lastRetrievedBlock: BigInt(String(row['last_retrieved_block'])),
						},
					]
				}),
			)
		})
	}

	async richListBalanceTargets(chainId: number, limit = 10, lease?: IndexerLease): Promise<RichListBalanceTargets> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const addressRows = await sql`
				WITH assets AS (
					SELECT address FROM contracts WHERE chain_id = ${chainId} AND canonical AND kind IN ('reputationToken', 'weth')
				)
				SELECT activity.address
				FROM (SELECT DISTINCT address FROM address_activity WHERE chain_id = ${chainId} AND canonical) activity
				LEFT JOIN LATERAL (
					SELECT max(block_number) AS block_number,
						count(DISTINCT asset_address) FILTER (
							WHERE asset_kind = 'native' OR asset_address IN (SELECT address FROM assets)
						) AS sampled_assets
					FROM address_balance_snapshots snapshot
					JOIN blocks block ON block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash AND block.canonical
					JOIN networks network ON network.chain_id = snapshot.chain_id
					WHERE snapshot.chain_id = ${chainId} AND snapshot.address = activity.address AND snapshot.canonical
						AND snapshot.block_number <= network.indexed_block
				) latest ON true
				ORDER BY ((SELECT count(*) FROM assets) + 1 - COALESCE(latest.sampled_assets, 0)) DESC,
					latest.block_number ASC NULLS FIRST, activity.address
				LIMIT ${limit}
			`
			const assetRows = await sql`
				SELECT address, kind FROM contracts
				WHERE chain_id = ${chainId} AND canonical AND kind IN ('reputationToken', 'weth')
				ORDER BY kind, address
			`
			return {
				addresses: addressRows.map((row: Record<string, unknown>) => String(row['address']) as Address),
				assets: assetRows.map((row: Record<string, unknown>) => ({
					address: String(row['address']) as Address,
					kind: row['kind'] === 'weth' ? 'weth' : 'rep',
				})),
			}
		})
	}

	async stateSnapshotTargets(chainId: number, throughBlock: bigint, limit = 25, lease?: IndexerLease): Promise<readonly StateSnapshotTarget[]> {
		return await withOptionalIndexerLease(this.sql, lease, async (sql) => {
			const rows = await sql`
				WITH latest_pools AS (
					SELECT DISTINCT ON (pool_address) pool_address, coordinator_address
					FROM pools WHERE chain_id = ${chainId} AND canonical
					ORDER BY pool_address, block_number DESC, log_index DESC
				), pool_escalations AS (
					SELECT DISTINCT ON (pool_address) pool_address, NULLIF(state->>'escalationGame', '0x0000000000000000000000000000000000000000') AS escalation_address
					FROM pool_state_events WHERE chain_id = ${chainId} AND canonical AND event_name = 'EscalationGameSet'
					ORDER BY pool_address, block_number DESC, log_index DESC
				), latest_vaults AS (
					SELECT DISTINCT ON (pool_address, vault_address) pool_address, vault_address
					FROM vault_snapshots WHERE chain_id = ${chainId} AND canonical
					ORDER BY pool_address, vault_address, block_number DESC, log_index DESC
				), candidates AS (
					SELECT 'pool'::text AS entity_type, pool.pool_address AS entity_identity,
						pool.pool_address AS address, NULL::text AS pool_address,
						pool.coordinator_address, escalation.escalation_address
					FROM latest_pools pool LEFT JOIN pool_escalations escalation USING (pool_address)
					UNION ALL
					SELECT 'vault', vault.pool_address || ':' || vault.vault_address, vault.vault_address,
						vault.pool_address, pool.coordinator_address, escalation.escalation_address
					FROM latest_vaults vault JOIN latest_pools pool USING (pool_address)
					LEFT JOIN pool_escalations escalation USING (pool_address)
					UNION ALL
					SELECT 'escalation', game_address, game_address, NULL, NULL, game_address
					FROM (SELECT DISTINCT game_address FROM escalation_game_events WHERE chain_id = ${chainId} AND canonical) game
					UNION ALL
					SELECT 'auction', auction_address, auction_address, NULL, NULL, NULL
					FROM (SELECT DISTINCT auction_address FROM truth_auction_events WHERE chain_id = ${chainId} AND canonical) auction
				), ranked AS (
					SELECT candidate.*, latest.block_number AS latest_snapshot_block
					FROM candidates candidate
					LEFT JOIN LATERAL (
						SELECT snapshot.block_number FROM entity_state_snapshots snapshot
						JOIN blocks block ON block.chain_id = snapshot.chain_id AND block.hash = snapshot.block_hash AND block.canonical
						WHERE snapshot.chain_id = ${chainId} AND snapshot.entity_type = candidate.entity_type
							AND snapshot.entity_identity = candidate.entity_identity AND snapshot.canonical
						ORDER BY snapshot.block_number DESC, snapshot.observed_at DESC LIMIT 1
					) latest ON true
				)
				SELECT entity_type, entity_identity, address, pool_address, coordinator_address, escalation_address
				FROM ranked WHERE latest_snapshot_block IS NULL OR latest_snapshot_block < ${throughBlock.toString()}
				ORDER BY latest_snapshot_block NULLS FIRST, entity_type, entity_identity LIMIT ${limit}
			`
			return rows.map((row: Record<string, unknown>) => normalizeSnapshotTarget(row))
		})
	}
}

import { expect } from 'bun:test'
import { handleApi } from '../../src/api.ts'
import { decodeOpaqueCursor } from '../../src/cursor-codec.ts'
import { type IndexedBlock, ScannerDatabase } from '../../src/database.ts'
import { initializeSchema } from '../../src/schema.ts'
import type { EntityStateSnapshot } from '../../src/snapshots.ts'
import type { NetworkConfig, StoredLog } from '../../src/types.ts'
import { address, type BlockHash, blockHash, chainId, decodedLog, discoveredAddress, type IndexerRunSourceHashes, insertIndexerRun, postgresTest, requirePostgresUrl } from '../support/postgres-fixtures.ts'

type ProvenanceContext = {
	readonly database: ScannerDatabase
	readonly provenanceChainId: number
	readonly evidenceBlockHash: BlockHash
	readonly evidenceTxHash: BlockHash
	readonly evidenceRawTopic: BlockHash
	readonly network: NetworkConfig
	readonly evidenceBlock: IndexedBlock
}

const createProvenanceContext = (database: ScannerDatabase): ProvenanceContext => {
	const provenanceChainId = chainId + 100_000 + (process.pid % 100_000)
	const evidenceBlockHash = blockHash(`projection-provenance-block-${provenanceChainId}`)
	const evidenceTxHash = blockHash(`projection-provenance-transaction-${provenanceChainId}`)
	const network: NetworkConfig = {
		id: `projection-provenance-${provenanceChainId}`,
		name: 'Projection provenance fixture',
		chainId: provenanceChainId,
		rpcUrls: ['https://example.invalid'],
		startBlock: 1n,
		explorerBaseUrl: 'https://example.invalid',
		nativeSymbol: 'ETH',
		confirmationDepth: 1n,
		contracts: [[discoveredAddress, 'OpenOracle', 'openOracle']],
	}
	const evidenceRawTopic = blockHash(`projection-provenance-topic-${provenanceChainId}`)
	const evidenceLog: StoredLog = {
		...decodedLog(evidenceBlockHash, 0, discoveredAddress, 'ReportSubmitted', {
			reportId: '7',
			numReports: '1',
			currentReporter: address,
			currentAmount1: '10',
			currentAmount2: '20',
		}),
		topics: [evidenceRawTopic],
		data: '0x1234',
		blockNumber: 1n,
		transactionHash: evidenceTxHash,
	}
	const evidencePaginationLog: StoredLog = {
		...decodedLog(evidenceBlockHash, 1, discoveredAddress, 'FixtureEvidence', { fixture: 'export-page-two' }),
		blockNumber: 1n,
		transactionHash: evidenceTxHash,
	}
	const evidenceBlock: IndexedBlock = {
		number: 1n,
		hash: evidenceBlockHash,
		parentHash: blockHash(`projection-provenance-parent-${provenanceChainId}`),
		timestamp: new Date('2026-04-01T00:00:00Z'),
		observedHead: 1n,
		finalizedThrough: 0n,
		contracts: [],
		tokenMetadata: [],
		addressActivity: [],
		contractDeploymentObservations: [],
		logScanCursors: [],
		transactions: [
			{
				hash: evidenceTxHash,
				transactionIndex: 0,
				from: address,
				to: discoveredAddress,
				value: 0n,
				input: '0x',
				status: 'success',
				gasUsed: 21_000n,
				receipt: { transactionHash: evidenceTxHash, blockHash: evidenceBlockHash, status: 'success', logs: [] },
				decoded: { status: 'decoded', name: 'submitReport', summary: 'Submit report', arguments: { reportId: '7' } },
			},
		],
		logs: [evidenceLog, evidencePaginationLog],
	}
	return { database, provenanceChainId, evidenceBlockHash, evidenceTxHash, evidenceRawTopic, network, evidenceBlock }
}

const restorePoolIdentity = async ({ database, provenanceChainId, evidenceBlockHash, evidenceTxHash }: ProvenanceContext): Promise<void> => {
	await database.sql`
		INSERT INTO pools (
			chain_id, block_hash, tx_hash, log_index, block_number, pool_address, parent_address,
			universe_id, question_id, truth_auction_address, coordinator_address, share_token_address,
			security_multiplier_bps, initial_priority_fee_atto_eth_per_gas,
			initial_retention_rate, initial_settlement_collateral_atto_eth, canonical
		) VALUES (
			${provenanceChainId}, ${evidenceBlockHash}, ${evidenceTxHash}, 0, 1, ${discoveredAddress.toLowerCase()},
			${address.toLowerCase()}, 1, 7, ${address.toLowerCase()}, ${discoveredAddress.toLowerCase()}, ${address.toLowerCase()},
			15000, 0, 0, 0, true
		)
		ON CONFLICT (chain_id, block_hash, tx_hash, log_index, pool_address) DO UPDATE SET canonical = true
	`
}

const expectHistoricalRisk = async ({ database, provenanceChainId }: ProvenanceContext, applicationSourceHash: string): Promise<void> => {
	const response = await handleApi(new Request(`http://localhost/api/v1/state/risk/pools/${provenanceChainId}/${discoveredAddress.toLowerCase()}?atBlock=1`), database.sql)
	if (response === undefined) throw new Error('historical risk response was not returned')
	expect(response.status).toBe(200)
	expect(await response.json()).toMatchObject({
		asOf: { blockNumber: '1', historical: true },
		data: {
			block_number: '1',
			abi_source_hash: 'abi-one',
			application_source_hash: applicationSourceHash,
			projection_source_hash: 'projection-one',
			history: {
				stateSnapshots: expect.arrayContaining([expect.objectContaining({ abi_source_hash: 'abi-one', application_source_hash: applicationSourceHash })]),
			},
		},
	})
}

const poolRiskSnapshot = (settlementCollateralAttoEth: bigint, currentMintingCapacityAttoEth: bigint): EntityStateSnapshot => ({
	entityType: 'pool',
	entityIdentity: discoveredAddress.toLowerCase(),
	sourceMethod: 'augurscan.pool-risk.v1',
	readStatus: 'success',
	readResult: {
		settlementCollateralAttoEth: settlementCollateralAttoEth.toString(),
		currentMintingCapacityAttoEth: currentMintingCapacityAttoEth.toString(),
		totalBadDebtAttoEth: 0n.toString(),
		systemState: '1',
		price: { repPerEth1e18: '100', protocolValid: true },
	},
})

const countRows = async (database: ScannerDatabase, table: 'action_interpretations' | 'log_interpretations' | 'protocol_timeline_entries', provenanceChainId: number, canonicalOnly = false): Promise<number> => {
	const rows = canonicalOnly ? await database.sql.unsafe(`SELECT count(*) AS count FROM ${table} WHERE chain_id = $1 AND canonical`, [provenanceChainId]) : await database.sql.unsafe(`SELECT count(*) AS count FROM ${table} WHERE chain_id = $1`, [provenanceChainId])
	return Number(rows[0]?.['count'])
}

// Applied source hashes require the lease; the first run stores evidence and a pool risk snapshot.
const storeFirstRunEvidence = async (context: ProvenanceContext): Promise<IndexerRunSourceHashes> => {
	const { database, provenanceChainId, evidenceBlockHash, network, evidenceBlock } = context
	const firstRun = await insertIndexerRun(database, 'one')
	await expect(database.seedNetwork(network, { appliedSourceHashes: firstRun })).rejects.toThrow('Applied source hashes require the network indexer lease')
	const firstLease = await database.tryAcquireIndexerLock(provenanceChainId)
	if (firstLease === undefined) throw new Error('first provenance writer did not acquire its lock')
	try {
		await database.seedNetwork(network, { lease: firstLease, appliedSourceHashes: firstRun })
		await database.storeBlock(provenanceChainId, evidenceBlock, firstLease, firstRun)
		await database.storeEntityStateSnapshots(provenanceChainId, 1n, evidenceBlockHash, evidenceBlock.timestamp, [poolRiskSnapshot(1n, 2n)], firstLease, firstRun)
	} finally {
		await firstLease.release()
	}
	await restorePoolIdentity(context)
	await expectHistoricalRisk(context, 'application-one')
	const firstInterpretations = await database.sql`SELECT interpretation_kind, interpretation_key FROM log_interpretations WHERE chain_id = ${provenanceChainId} ORDER BY interpretation_kind, interpretation_key`
	expect([...firstInterpretations]).toEqual([
		expect.objectContaining({ interpretation_kind: 'decode', interpretation_key: 'decode' }),
		expect.objectContaining({ interpretation_kind: 'decode', interpretation_key: 'decode' }),
		expect.objectContaining({
			interpretation_kind: 'projection',
			interpretation_key: `domainEvent:open-oracle-report:${discoveredAddress.toLowerCase()}:7`,
		}),
	])
	expect(await countRows(database, 'action_interpretations', provenanceChainId)).toBe(1)
	expect(await countRows(database, 'protocol_timeline_entries', provenanceChainId)).toBe(1)
	return firstRun
}

// Exports carry the applied source hashes, and continuation keys beyond integer bounds are rejected.
const expectProvenanceExportAndCursorBounds = async ({ database, provenanceChainId, evidenceBlockHash, evidenceTxHash, evidenceRawTopic }: ProvenanceContext, firstRun: IndexerRunSourceHashes): Promise<string> => {
	await insertIndexerRun(database, 'standby')
	const firstExportResponse = await handleApi(new Request(`http://localhost/api/v1/export?chainId=${provenanceChainId}&dataset=logs&limit=1`), database.sql)
	if (firstExportResponse === undefined) throw new Error('source-provenance export was not returned')
	expect(firstExportResponse.headers.get('x-augurscan-abi-source-hash')).toBe('abi-one')
	expect(firstExportResponse.headers.get('x-augurscan-application-source-hash')).toBe('application-one')
	expect(firstExportResponse.headers.get('x-augurscan-projection-source-hash')).toBe('projection-one')
	const exportedOccurrence = JSON.parse((await firstExportResponse.text()).trim()) as Record<string, unknown>
	expect(exportedOccurrence).toMatchObject({
		topics: [evidenceRawTopic],
		data: '0x1234',
		interpretations: expect.arrayContaining([
			expect.objectContaining({
				interpretation_kind: 'decode',
				indexer_run_id: firstRun.indexerRunId,
				abi_source_hash: 'abi-one',
				application_source_hash: 'application-one',
				projection_source_hash: 'projection-one',
			}),
		]),
	})
	const firstExportCursor = firstExportResponse.headers.get('x-augurscan-next-cursor')
	if (firstExportCursor === null || firstExportCursor === undefined) throw new Error('source-provenance export did not return a continuation')
	const cursorParts = decodeOpaqueCursor(firstExportCursor)
	if (!Array.isArray(cursorParts)) throw new Error('source-provenance export cursor is malformed')
	for (const [dataset, lastKey] of [
		['logs', ['1', '2147483648', '0', evidenceBlockHash, evidenceTxHash]],
		['logs', ['1', '0', '2147483648', evidenceBlockHash, evidenceTxHash]],
		['timeline', ['1', evidenceBlockHash, evidenceTxHash, '2147483648', 'open-oracle-report', `${discoveredAddress.toLowerCase()}:7`]],
	] as const) {
		const overflowingCursorParts = [...cursorParts]
		overflowingCursorParts[1] = dataset
		overflowingCursorParts[13] = lastKey
		const overflowingCursor = btoa(JSON.stringify(overflowingCursorParts))
		const overflowingResponse = await handleApi(new Request(`http://localhost/api/v1/export?chainId=${provenanceChainId}&dataset=${dataset}&limit=1&cursor=${encodeURIComponent(overflowingCursor)}`), database.sql)
		expect(overflowingResponse?.status).toBe(400)
	}
	return firstExportCursor
}

// An application-only source change rebuilds projections, retains state observations, and stales old cursors.
const rebuildProjectionForApplicationChange = async ({ database, provenanceChainId, evidenceBlockHash, evidenceTxHash, network }: ProvenanceContext, firstExportCursor: string): Promise<IndexerRunSourceHashes> => {
	const applicationOnlyRun = await insertIndexerRun(database, 'application-only', 'abi-one', 'projection-one')
	const applicationOnlyLease = await database.tryAcquireIndexerLock(provenanceChainId)
	if (applicationOnlyLease === undefined) throw new Error('application-only writer did not acquire its lock')
	try {
		const applicationReplayPlan = await database.sourceReplayPlan(provenanceChainId, applicationOnlyRun, applicationOnlyLease)
		expect(applicationReplayPlan).toEqual({ reason: 'projection-rebuild', causes: ['projection-rebuild'] })
		expect(
			await database.seedNetwork(network, {
				lease: applicationOnlyLease,
				sourceReplayPlan: applicationReplayPlan,
				appliedSourceHashes: applicationOnlyRun,
			}),
		).toBeTrue()
	} finally {
		await applicationOnlyLease.release()
	}
	const projectionResetEvents = await database.sql`
		SELECT payload FROM live_events
		WHERE (payload->>'chainId')::integer = ${provenanceChainId} AND event = 'reorg'
		ORDER BY id DESC LIMIT 1
	`
	expect(projectionResetEvents[0]?.['payload']).toMatchObject({ reason: 'projection-rebuild' })
	const materializedStateAfterProjectionReset = await database.sql`
		SELECT read_status, canonical, application_source_hash FROM entity_state_snapshots
		WHERE chain_id = ${provenanceChainId}
	`
	expect(materializedStateAfterProjectionReset).toEqual([{ read_status: 'success', canonical: true, application_source_hash: 'application-one' }])
	const observationsAfterProjectionReset = await database.sql`
		SELECT read_status, canonical, application_source_hash FROM entity_state_observations
		WHERE chain_id = ${provenanceChainId}
	`
	expect(observationsAfterProjectionReset).toEqual([{ read_status: 'success', canonical: true, application_source_hash: 'application-one' }])
	expect(await database.sourceReplayPlan(provenanceChainId, applicationOnlyRun)).toBeUndefined()
	const staleExportResponse = await handleApi(new Request(`http://localhost/api/v1/export?chainId=${provenanceChainId}&dataset=logs&limit=1&cursor=${encodeURIComponent(firstExportCursor)}`), database.sql)
	expect(staleExportResponse?.status).toBe(409)

	const invalidations = await database.sql`
		SELECT replacement.id::text, replacement.reason, occurrence.occurrence_kind
		FROM chain_reorganizations replacement
		JOIN history_invalidation_occurrences occurrence ON occurrence.invalidation_id = replacement.id
		WHERE replacement.chain_id = ${provenanceChainId}
		ORDER BY occurrence.occurrence_kind
	`
	expect(new Set(invalidations.map((row: Record<string, unknown>) => row['occurrence_kind']))).toEqual(new Set(['block', 'entity-state', 'log', 'transaction']))
	expect(invalidations.every((row: Record<string, unknown>) => row['reason'] === 'projection-rebuild')).toBeTrue()
	expect(await countRows(database, 'protocol_timeline_entries', provenanceChainId)).toBe(0)
	expect(await countRows(database, 'log_interpretations', provenanceChainId)).toBe(3)
	const supersededResponse = await handleApi(new Request(`http://localhost/api/v1/logs/${provenanceChainId}/${evidenceBlockHash}/${evidenceTxHash}/0?canonical=all`), database.sql)
	if (supersededResponse === undefined) throw new Error('superseded log detail was not returned')
	expect(await supersededResponse.json()).toMatchObject({
		evidence_status: 'projection-superseded',
		invalidation_reason: 'projection-rebuild',
		interpretations: { log: expect.arrayContaining([expect.objectContaining({ projection_source_hash: 'projection-one' })]) },
	})
	return applicationOnlyRun
}

const replayEvidenceForApplicationRun = async (context: ProvenanceContext, applicationOnlyRun: IndexerRunSourceHashes): Promise<void> => {
	const { database, provenanceChainId, evidenceBlockHash, evidenceBlock } = context
	const secondLease = await database.tryAcquireIndexerLock(provenanceChainId)
	if (secondLease === undefined) throw new Error('second provenance writer did not acquire its lock')
	await database.storeBlock(provenanceChainId, evidenceBlock, secondLease, applicationOnlyRun)
	await database.storeEntityStateSnapshots(provenanceChainId, 1n, evidenceBlockHash, evidenceBlock.timestamp, [poolRiskSnapshot(2n, 3n)], secondLease, applicationOnlyRun)
	await secondLease.release()
	await restorePoolIdentity(context)
	await expectHistoricalRisk(context, 'application-application-only')
	const retainedObservations = await database.sql`
		SELECT application_source_hash, canonical FROM entity_state_observations
		WHERE chain_id = ${provenanceChainId} ORDER BY id
	`
	expect(retainedObservations).toEqual([
		{ application_source_hash: 'application-one', canonical: true },
		{ application_source_hash: 'application-application-only', canonical: true },
	])
	expect(await countRows(database, 'action_interpretations', provenanceChainId)).toBe(2)
	expect(await countRows(database, 'log_interpretations', provenanceChainId)).toBe(6)
	expect(await countRows(database, 'protocol_timeline_entries', provenanceChainId, true)).toBe(1)
}

// ABI, projection, and manifest changes applied together are recorded as one multi-cause invalidation.
const resetForCombinedSourceChange = async ({ database, provenanceChainId, network }: ProvenanceContext): Promise<IndexerRunSourceHashes> => {
	const combinedRun = await insertIndexerRun(database, 'combined', 'abi-two', 'projection-two')
	const combinedReplayPlan = await database.sourceReplayPlan(provenanceChainId, combinedRun)
	expect(combinedReplayPlan).toEqual({ reason: 'abi-redecode', causes: ['abi-redecode', 'projection-rebuild'] })
	const abiResetLease = await database.tryAcquireIndexerLock(provenanceChainId)
	if (abiResetLease === undefined) throw new Error('ABI reset writer did not acquire its lock')
	const combinedResetNetwork = {
		...network,
		contracts: [...network.contracts, [address, 'Combined reset fixture', 'priceCoordinator']],
	} satisfies NetworkConfig
	try {
		expect(
			await database.seedNetwork(combinedResetNetwork, {
				lease: abiResetLease,
				resetCanonicalHistoryOnManifestChange: true,
				sourceReplayPlan: combinedReplayPlan,
				appliedSourceHashes: combinedRun,
			}),
		).toBeTrue()
	} finally {
		await abiResetLease.release()
	}
	const abiResetEvents = await database.sql`
		SELECT payload FROM live_events
		WHERE (payload->>'chainId')::integer = ${provenanceChainId} AND event = 'reorg'
		ORDER BY id DESC LIMIT 1
	`
	expect(abiResetEvents[0]?.['payload']).toMatchObject({
		reason: 'abi-redecode',
		reasons: expect.arrayContaining(['abi-redecode', 'manifest-reset', 'projection-rebuild']),
	})
	const combinedCauses = await database.sql`
		SELECT cause.reason FROM history_invalidation_causes cause
		JOIN chain_reorganizations invalidation ON invalidation.id = cause.invalidation_id
		WHERE invalidation.chain_id = ${provenanceChainId}
			AND invalidation.id = (SELECT max(id) FROM chain_reorganizations WHERE chain_id = ${provenanceChainId})
		ORDER BY cause.reason
	`
	expect(combinedCauses.map((row: Record<string, unknown>) => row['reason'])).toEqual(['abi-redecode', 'manifest-reset', 'projection-rebuild'])
	const combinedInvalidationRows = await database.sql`
		SELECT invalidation.id::text, invalidation.indexer_run_id::text,
			invalidation.abi_source_hash, invalidation.application_source_hash, invalidation.projection_source_hash,
			invalidation.occurrence_counts AS stored_occurrence_counts,
			COALESCE((SELECT jsonb_object_agg(counts.occurrence_kind, counts.occurrence_count ORDER BY counts.occurrence_kind)
				FROM (SELECT occurrence.occurrence_kind, count(*)::text AS occurrence_count
					FROM history_invalidation_occurrences occurrence WHERE occurrence.invalidation_id = invalidation.id
					GROUP BY occurrence.occurrence_kind) counts), '{}'::jsonb) AS occurrence_counts
		FROM chain_reorganizations invalidation
		WHERE invalidation.chain_id = ${provenanceChainId}
		ORDER BY invalidation.id DESC LIMIT 1
	`
	expect(combinedInvalidationRows[0]).toEqual({
		id: expect.any(String),
		indexer_run_id: combinedRun.indexerRunId,
		abi_source_hash: combinedRun.abiSourceHash,
		application_source_hash: combinedRun.applicationSourceHash,
		projection_source_hash: combinedRun.projectionSourceHash,
		occurrence_counts: { block: '1', 'entity-state': '2', log: '2', transaction: '1' },
		stored_occurrence_counts: { block: '1', 'entity-state': '2', log: '2', transaction: '1' },
	})
	return combinedRun
}

// The reorganization catalog, integrity catalog, and invalidation export all report the combined causes.
const expectCombinedInvalidationReported = async ({ database, provenanceChainId }: ProvenanceContext, combinedRun: IndexerRunSourceHashes): Promise<void> => {
	const combinedInvalidation = {
		indexer_run_id: combinedRun.indexerRunId,
		abi_source_hash: combinedRun.abiSourceHash,
		application_source_hash: combinedRun.applicationSourceHash,
		projection_source_hash: combinedRun.projectionSourceHash,
		causes: ['abi-redecode', 'manifest-reset', 'projection-rebuild'],
		occurrence_counts: { block: '1', 'entity-state': '2', log: '2', transaction: '1' },
	}
	await insertIndexerRun(database, 'after-combined-reset')
	const reorganizationResponse = await handleApi(new Request(`http://localhost/api/v1/reorgs?chainId=${provenanceChainId}`), database.sql)
	if (reorganizationResponse === undefined) throw new Error('multi-cause reorganization response was not returned')
	expect(await reorganizationResponse.json()).toMatchObject({
		items: expect.arrayContaining([expect.objectContaining(combinedInvalidation)]),
	})
	const integrityResponse = await handleApi(new Request(`http://localhost/api/v1/state/integrity?chainId=${provenanceChainId}`), database.sql)
	if (integrityResponse === undefined) throw new Error('multi-cause integrity response was not returned')
	expect(await integrityResponse.json()).toMatchObject({
		data: {
			items: expect.arrayContaining([expect.objectContaining(combinedInvalidation)]),
		},
	})
	const invalidationExport = await handleApi(new Request(`http://localhost/api/v1/export?chainId=${provenanceChainId}&dataset=reorgs`), database.sql)
	if (invalidationExport === undefined) throw new Error('invalidation export was not returned')
	const exportedInvalidations = (await invalidationExport.text())
		.trim()
		.split('\n')
		.map(line => JSON.parse(line) as Record<string, unknown>)
	expect(exportedInvalidations).toContainEqual(expect.objectContaining({ reason: 'abi-redecode', ...combinedInvalidation }))
}

const expectReplayedMultiCauseTimeline = async (context: ProvenanceContext, applicationOnlyRun: IndexerRunSourceHashes): Promise<void> => {
	const { database, provenanceChainId, evidenceBlock } = context
	const finalReplayLease = await database.tryAcquireIndexerLock(provenanceChainId)
	if (finalReplayLease === undefined) throw new Error('final provenance replay writer did not acquire its lock')
	try {
		await database.storeBlock(provenanceChainId, evidenceBlock, finalReplayLease, applicationOnlyRun)
	} finally {
		await finalReplayLease.release()
	}
	await restorePoolIdentity(context)
	await database.sql`UPDATE protocol_timeline_entries SET canonical = false WHERE chain_id = ${provenanceChainId}`
	const multiCauseTimelineResponse = await handleApi(new Request(`http://localhost/api/v1/state/timeline?chainId=${provenanceChainId}&canonical=orphaned`), database.sql)
	if (multiCauseTimelineResponse === undefined) throw new Error('multi-cause timeline response was not returned')
	expect(await multiCauseTimelineResponse.json()).toMatchObject({
		data: {
			items: [expect.objectContaining({ invalidation_causes: ['abi-redecode', 'manifest-reset', 'projection-rebuild'] })],
		},
	})
	await database.sql`UPDATE protocol_timeline_entries SET canonical = true WHERE chain_id = ${provenanceChainId}`
	await expectHistoricalRisk(context, 'application-application-only')
	const finalObservations = await database.sql`
		SELECT application_source_hash, canonical FROM entity_state_observations
		WHERE chain_id = ${provenanceChainId} ORDER BY id
	`
	expect(finalObservations).toEqual([
		{ application_source_hash: 'application-one', canonical: true },
		{ application_source_hash: 'application-application-only', canonical: true },
	])
}

const deleteProvenanceFixtures = async ({ database, provenanceChainId }: ProvenanceContext): Promise<void> => {
	await database.sql`DELETE FROM entity_state_observations WHERE chain_id = ${provenanceChainId}`
	await database.sql`DELETE FROM log_interpretations WHERE chain_id = ${provenanceChainId}`
	await database.sql`DELETE FROM action_interpretations WHERE chain_id = ${provenanceChainId}`
	await database.sql`
		DELETE FROM history_invalidation_occurrences occurrence USING chain_reorganizations invalidation
		WHERE occurrence.invalidation_id = invalidation.id AND invalidation.chain_id = ${provenanceChainId}
	`
	await database.sql`
		DELETE FROM history_invalidation_causes cause USING chain_reorganizations invalidation
		WHERE cause.invalidation_id = invalidation.id AND invalidation.chain_id = ${provenanceChainId}
	`
	await database.sql`DELETE FROM chain_reorganizations WHERE chain_id = ${provenanceChainId}`
	await database.sql`DELETE FROM indexer_runs WHERE app_version = 'test' AND network_configuration = '{}'::jsonb`
}

postgresTest(
	'retains versioned interpretations and exact invalidation provenance across a projection rebuild',
	async () => {
		const database = new ScannerDatabase(requirePostgresUrl())
		const context = createProvenanceContext(database)
		try {
			await initializeSchema(database.sql)
			const firstRun = await storeFirstRunEvidence(context)
			const firstExportCursor = await expectProvenanceExportAndCursorBounds(context, firstRun)
			const applicationOnlyRun = await rebuildProjectionForApplicationChange(context, firstExportCursor)
			await replayEvidenceForApplicationRun(context, applicationOnlyRun)
			const combinedRun = await resetForCombinedSourceChange(context)
			await expectCombinedInvalidationReported(context, combinedRun)
			await expectReplayedMultiCauseTimeline(context, applicationOnlyRun)
		} finally {
			await deleteProvenanceFixtures(context)
			await database.close()
		}
	},
	30_000,
)

import { expect } from 'bun:test'
import { ScannerDatabase } from '../../src/database.ts'
import { captureHistoryInvalidation, recordChainReorganization } from '../../src/database/history.ts'
import { integrityCatalogData } from '../../src/repositories/integrity.ts'
import { reorganizationHistoryData } from '../../src/repositories/logs.ts'
import { historicalExportRows } from '../../src/repositories/exports.ts'
import { initializeSchema } from '../../src/schema.ts'
import { postgresTest, requirePostgresUrl } from '../support/postgres-fixtures.ts'

postgresTest('integrity pages read stored counts without access to occurrence evidence', async () => {
	const database = new ScannerDatabase(requirePostgresUrl())
	const chainId = 91_701
	let readerCreated = false
	try {
		await initializeSchema(database.sql)
		await database.sql`INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block)
			VALUES (${chainId}, 'integrity-counts', 'Counts fixture', 'https://example.invalid', 0)`
		await database.sql`INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical)
			SELECT ${chainId}, number, 'counts-' || number::text, 'parent', now(), true FROM generate_series(1, 2000) number`
		const id = await database.sql.begin(async sql => {
			const id = await recordChainReorganization(sql, chainId, 2000n, undefined, -1n, undefined, 2001n, 'manifest-reset')
			await captureHistoryInvalidation(sql, id, chainId)
			await captureHistoryInvalidation(sql, id, chainId)
			return id
		})
		expect((await database.sql`SELECT occurrence_counts FROM chain_reorganizations WHERE id = ${id}`)[0]?.occurrence_counts).toEqual({ block: '2000' })
		await database.sql`INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical)
			VALUES (${chainId}, 2001, 'counts-2001', 'parent', now(), true)`
		await database.sql.begin(async sql => await captureHistoryInvalidation(sql, id, chainId))
		await expect(
			database.sql.begin(async sql => {
				await sql`INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical)
				VALUES (${chainId}, 2002, 'counts-2002', 'parent', now(), true)`
				await captureHistoryInvalidation(sql, id, chainId)
				throw new Error('rollback capture')
			}),
		).rejects.toThrow('rollback capture')
		expect((await database.sql`SELECT occurrence_counts FROM chain_reorganizations WHERE id = ${id}`)[0]?.occurrence_counts).toEqual({ block: '2001' })
		// Simulate an existing v4 database: upgrade must backfill without reindexing.
		await database.sql.unsafe('ALTER TABLE chain_reorganizations DROP COLUMN occurrence_counts')
		await database.sql`UPDATE augurscan_schema SET schema_version = '4' WHERE singleton`
		await initializeSchema(database.sql)
		await initializeSchema(database.sql)
		await database.sql.unsafe('CREATE ROLE augurscan_integrity_counts_reader')
		readerCreated = true
		await database.sql.unsafe('GRANT USAGE ON SCHEMA public TO augurscan_integrity_counts_reader')
		await database.sql.unsafe('GRANT SELECT ON chain_reorganizations, history_invalidation_causes, augurscan_schema_migrations, indexer_runs TO augurscan_integrity_counts_reader')
		const { page, history, exported } = await database.sql.begin(async sql => {
			await sql.unsafe('SET LOCAL ROLE augurscan_integrity_counts_reader')
			return {
				page: await integrityCatalogData(sql, { chainId, snapshotId: id, limit: 1 }),
				history: await reorganizationHistoryData(sql, chainId, id, 1),
				exported: await historicalExportRows(sql, { dataset: 'reorgs', chainId, snapshotInvalidationId: id, snapshotBlock: '2001', fromBlock: '0', toBlock: '2001', canonical: 'all', limit: 1 }),
			}
		})
		expect(page.reorganizations).toHaveLength(1)
		expect(page.reorganizations[0]?.occurrence_counts).toEqual({ block: '2001' })
		expect(history.rows[0]?.occurrence_counts).toEqual({ block: '2001' })
		expect(exported[0]?.occurrence_counts).toEqual({ block: '2001' })
	} finally {
		if (readerCreated) {
			await database.sql.unsafe('DROP OWNED BY augurscan_integrity_counts_reader')
			await database.sql.unsafe('DROP ROLE augurscan_integrity_counts_reader')
		}
		await database.sql`DELETE FROM history_invalidation_causes WHERE invalidation_id IN (SELECT id FROM chain_reorganizations WHERE chain_id = ${chainId})`
		await database.sql`DELETE FROM history_invalidation_occurrences WHERE chain_id = ${chainId}`
		await database.sql`DELETE FROM chain_reorganizations WHERE chain_id = ${chainId}`
		await database.sql`DELETE FROM blocks WHERE chain_id = ${chainId}`
		await database.sql`DELETE FROM networks WHERE chain_id = ${chainId}`
		await database.close()
	}
})

// API-reading stages of the canonical lifecycle integration test: log, reorganization, integrity, trading,
// provenance, and export pagination over the stored chain, including stale-generation cursor rejection.
import { expect } from 'bun:test'
import { isLogDetailValue, isRecord } from '../../browser/api-validation.ts'
import { handleApi } from '../../src/api.ts'
import { decodeOpaqueCursor } from '../../src/cursor-codec.ts'
import { CURRENT_SCHEMA_VERSION } from '../../src/schema-policy.ts'
import type { LifecycleChain, LifecycleContext } from './canonical-lifecycle-chain.ts'
import { address, blockHash, chainId, discoveredAddress, rediscoveredAddress, transactionHash } from './postgres-fixtures.ts'

// Serves canonical and orphaned logs and pins a log page to its snapshot while the indexed head advances.
// Returns the first page's continuation so a later stage can prove a new invalidation stales it.
export const expectCanonicalLogPagination = async ({ database }: LifecycleContext, { orphan, replacement, third }: LifecycleChain): Promise<string | undefined> => {
	const response = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}`), database.sql)
	if (response === undefined) throw new Error('logs API did not return a response')
	const payload = (await response.json()) as { items: Array<{ summary: string; block_hash: string; origin_address: string }> }
	expect(payload.items.length).toBeGreaterThanOrEqual(2)
	expect(payload.items).toContainEqual(expect.objectContaining({ summary: 'replacement event', block_hash: replacement.hash }))
	expect(payload.items[0]?.origin_address).toBe(address.toLowerCase())
	const orphanDetailResponse = await handleApi(new Request(`http://localhost/api/v1/logs/${chainId}/${orphan.hash}/${transactionHash}/0`), database.sql)
	expect(orphanDetailResponse?.status).toBe(404)
	expect(await orphanDetailResponse?.json()).toEqual({ error: 'Log not found' })
	const orphanHistoryResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}&canonical=orphaned`), database.sql)
	const orphanHistory = (await orphanHistoryResponse?.json()) as { items: unknown[]; canonical: string }
	expect(orphanHistory.canonical).toBe('orphaned')
	expect(orphanHistory.items).toContainEqual(expect.objectContaining({ block_hash: orphan.hash, canonical: false, summary: 'orphan event' }))
	const orphanHistoryDetailResponse = await handleApi(new Request(`http://localhost/api/v1/logs/${chainId}/${orphan.hash}/${transactionHash}/0?canonical=all`), database.sql)
	expect(orphanHistoryDetailResponse?.status).toBe(200)
	expect(await orphanHistoryDetailResponse?.json()).toMatchObject({ block_hash: orphan.hash, canonical: false, summary: 'orphan event' })
	const firstLogPageResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}&limit=1`), database.sql)
	const firstLogPage = (await firstLogPageResponse?.json()) as { items: Array<Record<string, unknown>>; nextCursor?: string }
	expect(firstLogPage.items).toHaveLength(1)
	expect(firstLogPage.nextCursor).toBeString()
	const mismatchedLogFilterResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}&event=replacement&limit=1&cursor=${encodeURIComponent(firstLogPage.nextCursor ?? '')}`), database.sql)
	expect(mismatchedLogFilterResponse?.status).toBe(400)
	const advancedHeadHash = blockHash('cursor-head-advance')
	await database.sql`
				INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical)
				VALUES (${chainId}, 4, ${advancedHeadHash}, ${third.hash}, '2026-01-04T00:00:00Z', true)
			`
	await database.sql`
				UPDATE networks SET indexed_block = 4, indexed_hash = ${advancedHeadHash},
					indexed_timestamp = '2026-01-04T00:00:00Z', observed_block = 4
				WHERE chain_id = ${chainId}
			`
	const secondLogPageResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstLogPage.nextCursor ?? '')}`), database.sql)
	const secondLogPage = (await secondLogPageResponse?.json()) as {
		items: Array<Record<string, unknown>>
		asOf: { blockNumber: string; blockHash: string; indexedHead: string; historical: boolean }
	}
	expect(secondLogPage.items).toHaveLength(1)
	expect(secondLogPage.asOf).toMatchObject({ blockNumber: '3', blockHash: third.hash, indexedHead: '4', historical: true })
	expect(secondLogPage.items[0]).not.toMatchObject({
		block_hash: firstLogPage.items[0]?.['block_hash'],
		log_index: firstLogPage.items[0]?.['log_index'],
	})
	await database.sql`UPDATE blocks SET canonical = false WHERE chain_id = ${chainId} AND hash = ${third.hash}`
	const displacedSnapshotResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstLogPage.nextCursor ?? '')}`), database.sql)
	expect(displacedSnapshotResponse?.status).toBe(409)
	await database.sql`UPDATE blocks SET canonical = true WHERE chain_id = ${chainId} AND hash = ${third.hash}`
	await database.sql`
				UPDATE networks SET indexed_block = 3, indexed_hash = ${third.hash},
					indexed_timestamp = '2026-01-03T00:00:00Z', observed_block = 3
				WHERE chain_id = ${chainId}
			`
	await database.sql`DELETE FROM blocks WHERE chain_id = ${chainId} AND hash = ${advancedHeadHash}`
	return firstLogPage.nextCursor
}

// Reorganization, integrity, and trading cursors are bound to the invalidation generation they started from.
export const expectGenerationBoundCatalogCursors = async ({ database }: LifecycleContext, { first, orphan, replacement, third }: LifecycleChain, firstLogPageCursor: string | undefined): Promise<void> => {
	const reorganizationResponse = await handleApi(new Request(`http://localhost/api/v1/reorgs?chainId=${chainId}`), database.sql)
	expect(await reorganizationResponse?.json()).toMatchObject({
		items: [expect.objectContaining({ previous_hash: orphan.hash, ancestor_hash: first.hash, depth: '1', reason: 'chain-reorg' })],
		total: 1,
	})
	await database.sql`
			INSERT INTO chain_reorganizations
				(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
			VALUES (${chainId}, 2, ${replacement.hash}, 1, ${first.hash}, 1, 'manifest-reset')
		`
	const staleLogPageResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstLogPageCursor ?? '')}`), database.sql)
	expect(staleLogPageResponse?.status).toBe(409)
	const firstReorganizationPageResponse = await handleApi(new Request(`http://localhost/api/v1/reorgs?chainId=${chainId}&limit=1`), database.sql)
	const firstReorganizationPage = (await firstReorganizationPageResponse?.json()) as { items: Array<{ id: string }>; nextCursor?: string }
	expect(firstReorganizationPage.items).toHaveLength(1)
	expect(firstReorganizationPage.nextCursor).toBeString()
	const mismatchedReorganizationChainResponse = await handleApi(new Request(`http://localhost/api/v1/reorgs?chainId=${chainId + 1}&limit=1&cursor=${encodeURIComponent(firstReorganizationPage.nextCursor ?? '')}`), database.sql)
	expect(mismatchedReorganizationChainResponse?.status).toBe(400)
	const transientReorganization = await database.sql`
				INSERT INTO chain_reorganizations
					(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
				VALUES (${chainId}, 2, ${replacement.hash}, 1, ${first.hash}, 1, 'projection-rebuild')
				RETURNING id::text
			`
	const staleReorganizationPageResponse = await handleApi(new Request(`http://localhost/api/v1/reorgs?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstReorganizationPage.nextCursor ?? '')}`), database.sql)
	expect(staleReorganizationPageResponse?.status).toBe(409)
	await database.sql`DELETE FROM chain_reorganizations WHERE id = ${transientReorganization[0]?.['id']}`
	const firstIntegrityPageResponse = await handleApi(new Request(`http://localhost/api/v1/state/integrity?chainId=${chainId}&limit=1`), database.sql)
	const firstIntegrityPage = (await firstIntegrityPageResponse?.json()) as {
		data: { items: Array<{ id: string }>; total: number; offset: number; hasMore: boolean; nextCursor?: string }
	}
	expect(firstIntegrityPage.data).toMatchObject({ total: 2, offset: 0, hasMore: true })
	expect(firstIntegrityPage.data.items).toHaveLength(1)
	expect(firstIntegrityPage.data.nextCursor).toBeString()
	const firstTradingPageResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading?chainId=${chainId}`), database.sql)
	const firstTradingPage = (await firstTradingPageResponse?.json()) as {
		asOf: {
			blockNumber: string
			blockHash: string
			invalidationId: string
			abiSourceHash: string
			applicationSourceHash: string
			projectionSourceHash: string
		}
	}
	const firstTradingCursor = btoa(JSON.stringify([chainId, 'trading-catalog', '', firstTradingPage.asOf.blockNumber, firstTradingPage.asOf.blockHash, firstTradingPage.asOf.invalidationId, firstTradingPage.asOf.abiSourceHash, firstTradingPage.asOf.applicationSourceHash, firstTradingPage.asOf.projectionSourceHash, 1]))
	const insertedReorganization = await database.sql`
				INSERT INTO chain_reorganizations
					(chain_id, previous_block, previous_hash, ancestor_block, ancestor_hash, depth, reason)
				VALUES (${chainId}, 3, ${third.hash}, -1, NULL, 3, 'projection-rebuild')
				RETURNING id::text
			`
	const secondIntegrityPageResponse = await handleApi(new Request(`http://localhost/api/v1/state/integrity?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(firstIntegrityPage.data.nextCursor ?? '')}`), database.sql)
	expect(secondIntegrityPageResponse?.status).toBe(409)
	const staleTradingPageResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading?chainId=${chainId}&cursor=${encodeURIComponent(firstTradingCursor)}`), database.sql)
	expect(staleTradingPageResponse?.status).toBe(409)
	const refreshedIntegrityPageResponse = await handleApi(new Request(`http://localhost/api/v1/state/integrity?chainId=${chainId}&limit=1`), database.sql)
	const refreshedIntegrityPage = (await refreshedIntegrityPageResponse?.json()) as {
		data: { nextCursor?: string }
	}
	expect(refreshedIntegrityPage).toMatchObject({
		chainId,
		data: { total: 3, offset: 0, hasMore: true, items: [{ id: insertedReorganization[0]?.['id'] }] },
	})
	const integrityCursor = refreshedIntegrityPage.data.nextCursor
	if (integrityCursor === undefined) throw new Error('integrity catalog did not return a continuation')
	const integrityCursorParts = decodeOpaqueCursor(integrityCursor)
	if (!Array.isArray(integrityCursorParts) || integrityCursorParts.length !== 14) throw new Error('integrity cursor is malformed')
	const continuedIntegrityResponse = await handleApi(new Request(`http://localhost/api/v1/state/integrity?chainId=${chainId}&limit=1&cursor=${encodeURIComponent(integrityCursor)}`), database.sql)
	expect(continuedIntegrityResponse?.status).toBe(200)
	const continuedIntegrity = (await continuedIntegrityResponse?.json()) as { data: { items: Array<{ id: string }>; offset: number } }
	expect(continuedIntegrity.data.offset).toBe(1)
	expect(continuedIntegrity.data.items).toHaveLength(1)
	expect(continuedIntegrity.data.items[0]?.id).not.toBe(insertedReorganization[0]?.['id'])
	const overflowingIntegrityCursor = [...integrityCursorParts]
	overflowingIntegrityCursor[11] = Number(integrityCursorParts[4]) + 1
	const overflowingIntegrityResponse = await handleApi(new Request(`http://localhost/api/v1/state/integrity?chainId=${chainId}&limit=250&cursor=${encodeURIComponent(btoa(JSON.stringify(overflowingIntegrityCursor)))}`), database.sql)
	expect(overflowingIntegrityResponse?.status).toBe(400)
	const tradingCatalogResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading?chainId=${chainId}`), database.sql)
	const tradingCatalog = (await tradingCatalogResponse?.json()) as {
		asOf: {
			blockNumber: string
			blockHash: string
			invalidationId: string
			abiSourceHash: string
			applicationSourceHash: string
			projectionSourceHash: string
		}
	}
	for (const offset of [100_000, 100_250]) {
		const cursor = btoa(JSON.stringify([chainId, 'trading-catalog', '', tradingCatalog.asOf.blockNumber, tradingCatalog.asOf.blockHash, tradingCatalog.asOf.invalidationId, tradingCatalog.asOf.abiSourceHash, tradingCatalog.asOf.applicationSourceHash, tradingCatalog.asOf.projectionSourceHash, offset]))
		const boundaryResponse = await handleApi(new Request(`http://localhost/api/v1/state/trading?chainId=${chainId}&cursor=${encodeURIComponent(cursor)}`), database.sql)
		expect(boundaryResponse?.status).toBe(200)
		expect(await boundaryResponse?.json()).toMatchObject({ data: { items: [], offset, hasMore: false } })
	}
	await database.sql`
			INSERT INTO log_scan_cursors (chain_id, contract_address, start_block, last_retrieved_block)
			VALUES (${chainId}, ${rediscoveredAddress.toLowerCase()}, 1, 4)
		`
	expect(await database.auditIntegrity()).toContainEqual({
		chainId,
		code: 'log_cursor_ahead',
		detail: `Log cursor for ${rediscoveredAddress.toLowerCase()} is ahead of the network checkpoint`,
	})
	await database.sql`DELETE FROM log_scan_cursors WHERE chain_id = ${chainId} AND contract_address = ${rediscoveredAddress.toLowerCase()}`
}

// Paginates indexer-run provenance at the 100-run page boundary and reports the current migration.
export const expectRunProvenancePagination = async ({ database }: LifecycleContext): Promise<void> => {
	for (const runCount of [99, 100, 101]) {
		await database.sql`DELETE FROM indexer_runs`
		await database.sql`
				INSERT INTO indexer_runs
					(schema_version, app_version, abi_source_hash, application_source_hash, projection_source_hash,
						indexer_enabled, network_configuration, started_at)
				SELECT ${CURRENT_SCHEMA_VERSION}, 'fixture-' || run_number::text, 'fixture-hash', 'fixture-application-hash',
					'fixture-projection-hash', true, '[]'::jsonb,
					'2026-01-01T00:00:00Z'::timestamptz + run_number * interval '1 second'
				FROM generate_series(1, ${runCount}) AS generated(run_number)
			`
		const runProvenanceResponse = await handleApi(new Request('http://localhost/api/v1/provenance'), database.sql)
		const runProvenance = (await runProvenanceResponse?.json()) as {
			runs: unknown[]
			runLimit: number
			runsTruncated: boolean
			remainingTotal: number
			nextCursor?: string
		}
		expect(runProvenance.runs).toHaveLength(Math.min(runCount, 100))
		expect(runProvenance).toMatchObject({
			runLimit: 100,
			runsTruncated: runCount > 100,
			remainingTotal: runCount,
		})
		if (runCount === 101) {
			const continuationResponse = await handleApi(new Request(`http://localhost/api/v1/provenance?cursor=${encodeURIComponent(runProvenance.nextCursor ?? '')}`), database.sql)
			expect(await continuationResponse?.json()).toMatchObject({
				runs: [expect.any(Object)],
				runsTruncated: false,
				remainingTotal: 1,
			})
		}
	}
	await database.sql`DELETE FROM indexer_runs`
	const provenanceResponse = await handleApi(new Request('http://localhost/api/v1/provenance'), database.sql)
	const provenance = await provenanceResponse?.json()
	if (!isRecord(provenance) || !Array.isArray(provenance['migrations'])) throw new Error('Provenance migrations are malformed')
	expect(provenance['migrations'].some(migration => isRecord(migration) && migration['schema_version'] === CURRENT_SCHEMA_VERSION)).toBe(true)
}

// Exports orphaned logs, reads stable single-row export pages, and serves log detail with and without contract identity.
export const expectLogExportsAndDetails = async ({ database }: LifecycleContext, { orphan, replacement }: LifecycleChain): Promise<void> => {
	const orphanExportResponse = await handleApi(new Request(`http://localhost/api/v1/export?chainId=${chainId}&dataset=logs&canonical=orphaned&fromBlock=2&toBlock=2`), database.sql)
	expect(orphanExportResponse?.headers.get('content-type')).toContain('application/x-ndjson')
	expect((await orphanExportResponse?.text())?.trim()).toContain(orphan.hash)
	const readSingleRowExport = async (dataset: 'logs' | 'timeline'): Promise<readonly Record<string, unknown>[]> => {
		const rows: Record<string, unknown>[] = []
		let cursor: string | undefined
		for (;;) {
			const exportUrl = new URL(`http://localhost/api/v1/export?chainId=${chainId}&dataset=${dataset}&canonical=all&fromBlock=2&toBlock=2&limit=1`)
			if (cursor !== undefined) exportUrl.searchParams.set('cursor', cursor)
			const exportResponse = await handleApi(new Request(exportUrl), database.sql)
			if (exportResponse === undefined) throw new Error(`${dataset} export did not return a response`)
			expect(exportResponse.status).toBe(200)
			const body = (await exportResponse.text()).trim()
			if (body !== '') rows.push(JSON.parse(body) as Record<string, unknown>)
			const nextCursor = exportResponse.headers.get('x-augurscan-next-cursor')
			if (nextCursor === null) return rows
			cursor = nextCursor
		}
	}
	for (const dataset of ['logs', 'timeline'] as const) {
		const firstRead = await readSingleRowExport(dataset)
		const secondRead = await readSingleRowExport(dataset)
		expect(firstRead.length).toBeGreaterThan(1)
		expect(secondRead).toEqual(firstRead)
		const identities = firstRead.map(row => [row['block_hash'], row['tx_hash'], row['log_index'], row['entity_type'], row['entity_identity']].join(':'))
		expect(new Set(identities).size).toBe(firstRead.length)
	}
	const senderLogsResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}&address=${address.toLowerCase()}`), database.sql)
	if (senderLogsResponse === undefined) throw new Error('sender-filtered logs API did not return a response')
	const senderLogs = (await senderLogsResponse.json()) as { items: Array<{ origin_address: string; arguments: Record<string, unknown> }> }
	expect(senderLogs.items.length).toBeGreaterThanOrEqual(2)
	expect(senderLogs.items.every(item => item.origin_address === address.toLowerCase())).toBe(true)
	expect(senderLogs.items.some(item => !JSON.stringify(item.arguments).toLowerCase().includes(address.toLowerCase()))).toBe(true)
	const detailResponse = await handleApi(new Request(`http://localhost/api/v1/logs/${chainId}/${replacement.hash}/${transactionHash}/0`), database.sql)
	if (detailResponse === undefined) throw new Error('log detail API did not return a response')
	const detail = (await detailResponse.json()) as { receipt: { logs: unknown[] }; argument_schema: unknown[]; origin_address: string }
	expect(isLogDetailValue(detail)).toBeTrue()
	expect(detail.receipt.logs).toHaveLength(1)
	expect(detail.argument_schema).toEqual([])
	expect(detail.origin_address).toBe(address.toLowerCase())
	await database.sql`UPDATE contracts SET canonical = false WHERE chain_id = ${chainId} AND address = ${discoveredAddress.toLowerCase()}`
	try {
		const identitylessListResponse = await handleApi(new Request(`http://localhost/api/v1/logs?chainId=${chainId}`), database.sql)
		if (identitylessListResponse === undefined) throw new Error('identityless logs API did not return a response')
		const identitylessList = (await identitylessListResponse.json()) as { items: Array<Record<string, unknown>> }
		expect(identitylessList.items.find(item => item['block_hash'] === replacement.hash && item['emitter_address'] === discoveredAddress.toLowerCase())).toMatchObject({
			contract_label: null,
			contract_kind: null,
		})
		const identitylessDetailResponse = await handleApi(new Request(`http://localhost/api/v1/logs/${chainId}/${replacement.hash}/${transactionHash}/0`), database.sql)
		if (identitylessDetailResponse === undefined) throw new Error('identityless log detail API did not return a response')
		expect(await identitylessDetailResponse.json()).toMatchObject({
			contract_label: null,
			contract_kind: null,
			contract_provenance: null,
		})
	} finally {
		await database.sql`UPDATE contracts SET canonical = true WHERE chain_id = ${chainId} AND address = ${discoveredAddress.toLowerCase()}`
	}
}

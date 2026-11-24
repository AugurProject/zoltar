import { expect } from 'bun:test'
import { SQL } from 'bun'
import { handleApi } from '../../src/api.ts'
import type { Hex } from '../../src/ethereum.ts'
import { stateCatalogRows } from '../../src/repositories/timeline.ts'
import { initializeSchema } from '../../src/schema.ts'
import { postgresTest, requirePostgresUrl } from '../support/postgres-fixtures.ts'

const chainId = 1
const zeroHash = `0x${'0'.repeat(64)}`
const blockHash = (number: number): Hex => `0x${number.toString(16).padStart(64, '0')}`
const txHash = (number: number): Hex => `0x${(number + 1_000).toString(16).padStart(64, '0')}`
const oracle = `0x${'1'.repeat(40)}`
const auction = `0x${'2'.repeat(40)}`
const game = `0x${'3'.repeat(40)}`

const withExplorerTables = async (tables: readonly string[], run: (connection: SQL) => Promise<void>) => {
	const sql = new SQL(requirePostgresUrl())
	await initializeSchema(sql)
	const connection = await sql.reserve()
	try {
		for (const table of ['blocks', 'networks', 'chain_reorganizations', ...tables]) await connection.unsafe(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING INDEXES)`)
		for (let number = 1; number <= 6; number++) await connection`INSERT INTO blocks (chain_id, number, hash, parent_hash, canonical, timestamp) VALUES (${chainId}, ${number}, ${blockHash(number)}, ${zeroHash}, true, ${new Date(Date.UTC(2026, 0, 1, 0, 0, number * 60))})`
		await connection`INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block, indexed_block, indexed_hash, indexed_timestamp) VALUES (${chainId}, 'test', 'Test', '', 0, 6, ${blockHash(6)}, ${new Date(Date.UTC(2026, 0, 1, 0, 6))})`
		await run(connection)
	} finally {
		connection.release()
		await sql.close()
	}
}

const request = async (connection: SQL, path: string) => {
	const response = await handleApi(new Request(`http://localhost${path}`), connection)
	if (response === undefined) throw new Error(`${path} did not return a response`)
	return response
}

postgresTest('a settled timestamp report keeps its timestamp clock in the detail view', async () => {
	await withExplorerTables(['open_oracle_report_events', 'logs'], async connection => {
		const report = async (number: number, eventName: string, data: Record<string, unknown>) =>
			await connection`INSERT INTO open_oracle_report_events (chain_id, block_hash, tx_hash, log_index, block_number, open_oracle_address, report_id, event_name, report_data, canonical)
				VALUES (${chainId}, ${blockHash(number)}, ${txHash(number)}, 0, ${number}, ${oracle}, 7, ${eventName}, ${JSON.stringify(data)}::text::jsonb, true)`
		// flags=15 sets the timestamp bit; the settlement event does not repeat the flags.
		await report(1, 'ReportSubmitted', { flags: '15', reportTimestamp: '1767225660', disputeDelay: '0', settlementTime: '60' })
		await report(3, 'ReportSettled', { price: '5' })
		const detail = await request(connection, `/api/v1/state/reports/${chainId}/${oracle}/7`)
		expect(await detail.json()).toMatchObject({ data: { current: { event_name: 'ReportSettled', lifecycle: { state: 'Settled', clock: 'timestamp' } }, rounds: { items: [{ event_name: 'ReportSubmitted' }] } } })
		const operations = await request(connection, `/api/v1/state/reports?chainId=${chainId}`)
		expect(operations.status).toBe(200)
		// Before settlement the historical detail shows the open report on the same clock.
		expect(await (await request(connection, `/api/v1/state/reports/${chainId}/${oracle}/7?atBlock=2`)).json()).toMatchObject({ asOf: { blockNumber: '2' }, data: { current: { event_name: 'ReportSubmitted', lifecycle: { clock: 'timestamp' } } } })
	})
})

postgresTest('entity detail continuations reject a conflicting historical block', async () => {
	await withExplorerTables(['collateral_repair_auction_events', 'escalation_game_events', 'entity_state_snapshots', 'fork_migration_events', 'universe_events'], async connection => {
		for (const number of [1, 2, 3]) {
			await connection`INSERT INTO collateral_repair_auction_events (chain_id, block_hash, tx_hash, log_index, block_number, auction_address, event_name, event_data, canonical)
				VALUES (${chainId}, ${blockHash(number)}, ${txHash(number)}, 0, ${number}, ${auction}, 'BidSubmitted', ${JSON.stringify({ bidId: String(number), minimumAttoRepPerLot: '1', lots: '1' })}::text::jsonb, true)`
			await connection`INSERT INTO escalation_game_events (chain_id, block_hash, tx_hash, log_index, block_number, game_address, event_name, event_data, canonical)
				VALUES (${chainId}, ${blockHash(number)}, ${txHash(number)}, 0, ${number}, ${game}, 'DepositOnOutcome', ${JSON.stringify({ outcome: '1', amountAttoRep: '1' })}::text::jsonb, true)`
			await connection`INSERT INTO fork_migration_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical)
				VALUES (${chainId}, ${blockHash(number)}, ${txHash(number)}, 0, ${number}, '0', 'MigrationRepSplit', ${JSON.stringify({ universeId: '0', childUniverseId: '11', amountAttoRep: '1' })}::text::jsonb, true)`
		}
		for (const path of [`/api/v1/state/auctions/${chainId}/${auction}`, `/api/v1/state/escalations/${chainId}/${game}`, `/api/v1/state/forks/${chainId}/0`]) {
			const first = await request(connection, `${path}?limit=1&atBlock=3`)
			expect(first.status).toBe(200)
			const body: unknown = await first.json()
			expect(body).toMatchObject({ asOf: { blockNumber: '3' } })
			const cursor = /"nextCursor":"([^"]+)"/u.exec(JSON.stringify(body) ?? '')?.[1]
			if (cursor === undefined) throw new Error(`${path} did not return a continuation`)
			expect((await request(connection, `${path}?limit=1&cursor=${encodeURIComponent(cursor)}&atBlock=3`)).status).toBe(200)
			expect((await request(connection, `${path}?limit=1&cursor=${encodeURIComponent(cursor)}&atBlock=1`)).status).toBe(400)
			// A first page at an explicit historical block reads that block.
			expect(await (await request(connection, `${path}?atBlock=2`)).json()).toMatchObject({ asOf: { blockNumber: '2', historical: true } })
		}
	})
})

postgresTest('state history refuses a range that starts beyond the indexed head', async () => {
	await withExplorerTables(['universe_events'], async connection => {
		const path = `/api/v1/state/universes/${chainId}/0`
		const beyond = await request(connection, `${path}?fromBlock=7`)
		expect(beyond.status).toBe(400)
		expect(await beyond.json()).toMatchObject({ error: 'fromBlock must not exceed the indexed head' })
		expect((await request(connection, `${path}?fromBlock=7&toBlock=6`)).status).toBe(400)
		expect(await (await request(connection, `${path}?fromBlock=6`)).json()).toMatchObject({ coverage: { requestedFromBlock: '6', requestedToBlock: '6', rangeCovered: true, complete: true } })
		// An explicit range past the head is accepted but not certified as covered.
		expect(await (await request(connection, `${path}?fromBlock=6&toBlock=9`)).json()).toMatchObject({ coverage: { rangeCovered: false, complete: false } })
	})
})

postgresTest('the universe catalog counts only universes it can list and names the fork question a child inherits', async () => {
	await withExplorerTables(['universe_events', 'questions', 'pools', 'pool_snapshots', 'pool_state_events', 'entity_state_snapshots'], async connection => {
		const universe = async (number: number, logIndex: number, universeId: string, eventName: string, fields: { readonly parent?: string; readonly question?: string }) =>
			await connection`INSERT INTO universe_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_id, event_name, parent_universe_id, fork_question_id, canonical)
				VALUES (${chainId}, ${blockHash(number)}, ${txHash(number)}, ${logIndex}, ${number}, ${universeId}, ${eventName}, ${fields.parent ?? null}, ${fields.question ?? null}, true)`
		// Coverage starts after genesis: the parent universe is known only from its fork.
		await universe(2, 0, '0', 'UniverseForked', { question: '42' })
		await universe(3, 0, '11', 'DeployChild', { parent: '0' })
		await universe(3, 1, '12', 'DeployChild', { parent: '0' })
		const catalog = await stateCatalogRows(connection, chainId, 10)
		expect(catalog.totals[0]).toMatchObject({ universes: 2 })
		expect(catalog.universes.map((row: Record<string, unknown>) => [row['universe_id'], row['inherited_fork_question_id']])).toEqual([
			['11', '42'],
			['12', '42'],
		])
	})
})

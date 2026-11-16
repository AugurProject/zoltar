import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { storeLogProjections } from '../../src/database-projections.ts'
import { getAddress, type Hex } from '../../src/ethereum.ts'
import { eventEntityRows, forkDetailData, reportDetailData } from '../../src/repositories/entity-details.ts'
import { escalationCatalogData, forkCatalogData } from '../../src/repositories/operations.ts'
import { initializeSchema } from '../../src/schema.ts'
import type { StoredLog } from '../../src/types.ts'

const url = process.env['POSTGRES_TEST_URL']
const chainId = 1
const hash: Hex = `0x${'3'.repeat(64)}`
const openOracle = getAddress(`0x${'1'.repeat(40)}`)
const feed = getAddress(`0x${'2'.repeat(40)}`)
const escrow = getAddress(`0x${'4'.repeat(40)}`)
const otherFeed = getAddress(`0x${'5'.repeat(40)}`)
const reporters = getAddress(`0x${'6'.repeat(40)}`)
const game = getAddress(`0x${'7'.repeat(40)}`)
const book = getAddress(`0x${'8'.repeat(40)}`)
const coordinator = getAddress(`0x${'c'.repeat(40)}`)

const projected = (logIndex: number, address: StoredLog['address'], name: string, argumentsValue: Record<string, unknown>, blockNumber = 1n): StoredLog => ({
	transactionHash: hash,
	blockHash: hash,
	blockNumber,
	transactionIndex: 0,
	logIndex,
	address,
	topics: [],
	data: '0x',
	decoded: { status: 'decoded', name, summary: name, arguments: argumentsValue },
})

// Stores the raw log row a repository joins against and the projections the indexer derives from it.
const store = async (connection: SQL, item: StoredLog): Promise<void> => {
	await connection`INSERT INTO logs (chain_id, block_number, block_hash, tx_hash, transaction_index, log_index, emitter_address, topics, data, decode_status, summary, event_name, arguments, canonical)
		VALUES (${chainId}, ${item.blockNumber.toString()}, ${item.blockHash}, ${item.transactionHash}, 0, ${item.logIndex}, ${item.address.toLowerCase()}, '[]'::jsonb, '0x', 'decoded', ${item.decoded.summary}, ${item.decoded.name ?? null}, ${JSON.stringify(item.decoded.arguments)}::text::jsonb, true)`
	await storeLogProjections(connection, chainId, item)
}

const page = { block: '9', log: 2_147_483_647, tx: `0x${'f'.repeat(64)}`, limit: 100 }

test.skipIf(url === undefined)('events of portfolio components reach the escalation, fork and report views', async () => {
	if (url === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const sql = new SQL(url)
	await initializeSchema(sql)
	const connection = await sql.reserve()
	try {
		// Shadow the tables with constraint-complete temporary copies so the projection upserts run unchanged.
		for (const table of ['blocks', 'logs', 'protocol_timeline_entries', 'escalation_game_events', 'fork_migration_events', 'open_oracle_report_events', 'universe_events', 'entity_state_snapshots']) await connection.unsafe(`CREATE TEMP TABLE ${table} (LIKE public.${table} INCLUDING DEFAULTS INCLUDING INDEXES)`)
		await connection`INSERT INTO blocks (chain_id, number, hash, parent_hash, canonical, timestamp) VALUES (${chainId}, 1, ${hash}, ${`0x${'0'.repeat(64)}`}, true, now())`
		for (const [index, [universe, parent]] of [
			['1', '0'],
			['2', '1'],
		].entries())
			await connection`INSERT INTO universe_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_id, event_name, parent_universe_id, canonical) VALUES (${chainId}, ${hash}, ${hash}, ${index + 100}, 1, ${universe}, 'UniverseInitialized', ${parent}, true)`

		const report = { reportId: '7', numReports: '1' }
		const events: readonly StoredLog[] = [
			projected(0, openOracle, 'ReportSubmitted', report),
			projected(1, feed, 'PriceRequested', { reportId: '7', pendingReportMaxSettlementBaseFeeAttoEthPerGas: 1n.toString() }),
			projected(2, feed, 'ReportFundingAssigned', { reportId: '7', coordinator, sponsor: coordinator }),
			projected(3, escrow, 'ReportCompleted', { reportId: '7', priceFeed: feed, accepted: true }),
			// Another feed's escrow completes its own report 7; it must not join this report's decisions.
			projected(4, escrow, 'ReportCompleted', { reportId: '7', priceFeed: otherFeed, accepted: false }),
			projected(5, game, 'GameStarted', { activationTime: '1' }),
			projected(6, reporters, 'GameRegistered', { universeId: '1', questionId: '42', game }),
			projected(7, reporters, 'ReporterFinalityScheduled', { game, finalAfter: '500' }),
			projected(8, reporters, 'ReporterBalanceChanged', { universeId: '1', questionId: '42', balanceAttoRep: 70n.toString() }),
			projected(9, coordinator, 'UniverseForked', { universeId: '1', questionId: '42', forkTime: '10', forker: coordinator, forkThresholdAttoRep: 1n.toString(), migrationRepBalanceAttoRep: 1n.toString(), universeTheoreticalSupplyAttoRep: 1n.toString() }),
			projected(10, reporters, 'ReporterForkFrozen', { universeId: '1', migrationAttoRep: 60n.toString(), protectedParentAttoRep: 10n.toString() }),
			projected(11, reporters, 'ReporterChildCreated', { sourceUniverseId: '1', childUniverseId: '2', escrowAttoRep: 60n.toString() }),
			projected(12, book, 'AggregateFeesAccrued', { bookId: '1', portfolioTimestamp: '150', cashAttoEth: 9n.toString() }),
		]
		for (const event of events) await store(connection, event)
		// Reaching non-decision schedules reporter finality in the same transaction, at a higher log index.
		const concluded = getAddress(`0x${'9'.repeat(40)}`)
		await store(connection, projected(20, concluded, 'NonDecisionReached', { nonDecisionTimestamp: '5' }))
		await store(connection, projected(21, reporters, 'ReporterFinalityScheduled', { game: concluded, finalAfter: '0' }))

		// Reporter-ledger events that name a game are stored under the game, not under the ledger.
		expect(await connection`SELECT game_address, event_name FROM escalation_game_events WHERE chain_id = ${chainId} AND game_address = ${game.toLowerCase()} ORDER BY log_index`).toEqual([
			{ game_address: game.toLowerCase(), event_name: 'GameStarted' },
			{ game_address: game.toLowerCase(), event_name: 'GameRegistered' },
			{ game_address: game.toLowerCase(), event_name: 'ReporterFinalityScheduled' },
		])
		const gameEvents = await eventEntityRows(connection, { chainId, snapshotBlock: '1', address: game.toLowerCase(), domain: 'escalation', page })
		expect(gameEvents.map((row: Record<string, unknown>) => row['event_name'])).toEqual(['ReporterFinalityScheduled', 'GameRegistered', 'GameStarted'])
		// The ledger is not listed as a game of its own, and its events never stand in for a game's own latest state.
		expect((await escalationCatalogData(connection, chainId, '1')).map((row: Record<string, unknown>) => [row['game_address'], row['event_name'], row['log_index']])).toEqual([
			[concluded.toLowerCase(), 'NonDecisionReached', 20],
			[game.toLowerCase(), 'GameStarted', 5],
		])
		// A game that only the reporter ledger has named so far is still listed, under that ledger event.
		const registeredOnly = getAddress(`0x${'a'.repeat(40)}`)
		await store(connection, projected(22, reporters, 'GameRegistered', { universeId: '1', questionId: '43', game: registeredOnly }))
		expect((await escalationCatalogData(connection, chainId, '1')).map((row: Record<string, unknown>) => [row['game_address'], row['event_name']])[0]).toEqual([registeredOnly.toLowerCase(), 'GameRegistered'])

		expect(await connection`SELECT semantic_event_kind, entity_type, entity_identity FROM protocol_timeline_entries WHERE chain_id = ${chainId} AND log_index IN (3, 8, 12) ORDER BY log_index`).toEqual([
			{ semantic_event_kind: 'ReportCompleted', entity_type: 'price-feed', entity_identity: feed.toLowerCase() },
			{ semantic_event_kind: 'ReporterBalanceChanged', entity_type: 'reporter-ledger', entity_identity: `${reporters.toLowerCase()}:1` },
			{ semantic_event_kind: 'AggregateFeesAccrued', entity_type: 'settlement-book', entity_identity: `${book.toLowerCase()}:1` },
		])

		const catalog = await forkCatalogData(connection, chainId, '1')
		expect(catalog).toEqual([expect.objectContaining({ universe_identity: '1', portfolio_fork_events: 2, child_count: 1 })])
		const fork = await forkDetailData(connection, { chainId, snapshotBlock: '1', identity: '1', page })
		expect(fork.summary).toMatchObject({ portfolio_fork_events: 2, reporter_fork_frozen_count: 1, reporter_migration_atto_rep: '60', reporter_protected_parent_atto_rep: '10', child_count: 1 })
		expect(fork.rows.map((row: Record<string, unknown>) => row['event_name'])).toEqual(['ReporterChildCreated', 'ReporterForkFrozen', 'UniverseForked'])
		expect(fork.branches).toEqual([expect.objectContaining({ child_universe_id: '2' })])
		// The child lists the creation of its reporter escrow but does not count it as its own fork.
		const child = await forkDetailData(connection, { chainId, snapshotBlock: '1', identity: '2', page })
		expect(child.rows.map((row: Record<string, unknown>) => row['event_name'])).toEqual(['ReporterChildCreated'])
		expect(child.summary).toMatchObject({ portfolio_fork_events: 0, reporter_fork_frozen_count: 0, reporter_migration_atto_rep: '0' })

		const detail = await reportDetailData(connection, { chainId, snapshotBlock: '1', openOracleAddress: openOracle.toLowerCase(), reportId: '7', rounds: page, decisions: page })
		expect(detail.coordinatorDecisions.map((row: Record<string, unknown>) => [row['event_name'], row['emitter_address'], row['log_index']])).toEqual([
			['ReportCompleted', escrow.toLowerCase(), 3],
			['ReportFundingAssigned', feed.toLowerCase(), 2],
			['PriceRequested', feed.toLowerCase(), 1],
		])
	} finally {
		connection.release()
		await sql.close()
	}
})

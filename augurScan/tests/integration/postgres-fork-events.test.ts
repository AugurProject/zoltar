import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { forkDetailData } from '../../src/repositories/entity-details.ts'
import { forkCatalogData } from '../../src/repositories/operations.ts'
import { addressPortfolioRows } from '../../src/repositories/portfolio.ts'
import { initializeSchema } from '../../src/schema.ts'

const url = process.env['POSTGRES_TEST_URL']
test.skipIf(url === undefined)('fork summaries attribute portfolio fork events to the universe that forked', async () => {
	if (url === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const sql = new SQL(url)
	await initializeSchema(sql)
	const connection = await sql.reserve()
	try {
		for (const table of ['blocks', 'fork_migration_events', 'universe_events']) await connection.unsafe(`CREATE TEMP TABLE ${table} AS SELECT * FROM public.${table} WITH NO DATA`)
		const chainId = 1
		const hash = `0x${'3'.repeat(64)}`
		const coordinator = `0x${'c'.repeat(40)}`
		const ownerA = `0x${'a'.repeat(40)}`
		const ownerB = `0x${'b'.repeat(40)}`
		await connection`INSERT INTO blocks (chain_id, number, hash, canonical, timestamp) VALUES (${chainId}, 1, ${hash}, true, now())`
		// Universe 1 forks into 2 and 3; universe 2 later forks into 4.
		for (const [index, [universe, parent]] of [
			['1', '0'],
			['2', '1'],
			['3', '1'],
			['4', '2'],
		].entries())
			await connection`INSERT INTO universe_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_id, event_name, parent_universe_id, canonical) VALUES (${chainId}, ${hash}, ${hash}, ${index}, 1, ${universe}, 'UniverseInitialized', ${parent}, true)`
		const branch = (universe: string) => `${coordinator}:${universe}`
		// ForkFrozen, BranchChosen and NeutralCashRecovered name the forked universe; BranchStarted and BranchActivated name a child.
		const events: ReadonlyArray<readonly [string, string, Record<string, unknown>]> = [
			['1', 'UniverseForked', { universeId: '1', forker: ownerA }],
			[branch('1'), 'ForkFrozen', { universeId: '1' }],
			[branch('1'), 'BranchChosen', { universeId: '1', owner: ownerA, outcome: '1' }],
			[branch('1'), 'BranchChosen', { universeId: '1', owner: ownerB, outcome: '2' }],
			[branch('2'), 'BranchStarted', { universeId: '2' }],
			[branch('2'), 'BranchActivated', { universeId: '2' }],
			['2', 'UniverseForked', { universeId: '2', forker: ownerB }],
			[branch('2'), 'ForkFrozen', { universeId: '2' }],
			[branch('2'), 'BranchChosen', { universeId: '2', owner: ownerA, outcome: '1' }],
			[branch('4'), 'BranchStarted', { universeId: '4' }],
		]
		for (const [index, [identity, name, data]] of events.entries())
			await connection`INSERT INTO fork_migration_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical) VALUES (${chainId}, ${hash}, ${hash}, ${index + 10}, 1, ${identity}, ${name}, ${JSON.stringify(data)}::text::jsonb, true)`

		const catalog = await forkCatalogData(connection, chainId, '1')
		const catalogCounts = Object.fromEntries(catalog.map((row: Record<string, unknown>) => [String(row['universe_identity']), row['portfolio_fork_events']]))
		// Universe 1: its freeze and two choices plus the start and activation of its child 2.
		// Universe 2: its freeze and one choice plus the start of its child 4, but not its own start and activation.
		expect(catalogCounts).toEqual({ '1': 5, '2': 3 })

		const page = { block: '1', log: 2_147_483_647, tx: `0x${'f'.repeat(64)}`, limit: 100 }
		const parentFork = await forkDetailData(connection, { chainId, snapshotBlock: '1', identity: '1', page })
		expect(parentFork.summary).toMatchObject({ portfolio_fork_events: 5, branch_chooser_count: 2 })
		const childFork = await forkDetailData(connection, { chainId, snapshotBlock: '1', identity: '2', page })
		expect(childFork.summary).toMatchObject({ portfolio_fork_events: 3, branch_chooser_count: 1 })
		// The detail event list still shows every event that names the universe, including its own branch start.
		expect(childFork.rows.map((row: Record<string, unknown>) => row['event_name']).sort()).toEqual(['BranchActivated', 'BranchChosen', 'BranchStarted', 'BranchStarted', 'ForkFrozen', 'UniverseForked'])

		const participation = await addressPortfolioRows(connection, { chainId, snapshotBlock: '1', address: ownerA, limit: 100, lpOffset: 0, forkOffset: 0, reportOffset: 0 })
		expect(participation.forkRows.map((row: Record<string, unknown>) => [row['universe_identity'], row['event_name']]).sort()).toEqual([
			[branch('1'), 'BranchChosen'],
			[branch('2'), 'BranchChosen'],
		])
	} finally {
		connection.release()
		await sql.close()
	}
})

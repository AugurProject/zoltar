import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { domainCatalogResponse } from '../../src/api/operations.ts'
import { forkDetailData } from '../../src/repositories/entity-details.ts'
import { forkCatalogData } from '../../src/repositories/operations.ts'
import { addressSecurityPoolRows } from '../../src/repositories/security-pool.ts'
import { initializeSchema } from '../../src/schema.ts'

const url = process.env['POSTGRES_TEST_URL']
test.skipIf(url === undefined)('fork summaries attribute security pool fork events to the universe that forked', async () => {
	if (url === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const sql = new SQL(url)
	await initializeSchema(sql)
	const connection = await sql.reserve()
	try {
		for (const table of ['blocks', 'fork_migration_events', 'universe_events', 'networks']) await connection.unsafe(`CREATE TEMP TABLE ${table} AS SELECT * FROM public.${table} WITH NO DATA`)
		const chainId = 1
		const hash = `0x${'3'.repeat(64)}`
		const childForkTx = `0x${'7'.repeat(64)}`
		const coordinator = `0x${'c'.repeat(40)}`
		const ownerA = `0x${'a'.repeat(40)}`
		const ownerB = `0x${'b'.repeat(40)}`
		const ownerC = `0x${'d'.repeat(40)}`
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
			['2', 'UniverseForked', { universeId: '2', forker: ownerB, forkThresholdAttoRep: String(100n), migrationRepBalanceAttoRep: String(80n) }],
			[branch('2'), 'ForkFrozen', { universeId: '2' }],
			[branch('2'), 'BranchChosen', { universeId: '2', owner: ownerA, outcome: '1' }],
			[branch('4'), 'BranchStarted', { universeId: '4' }],
		]
		for (const [index, [identity, name, data]] of events.entries())
			await connection`INSERT INTO fork_migration_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical) VALUES (${chainId}, ${hash}, ${identity === '2' && name === 'UniverseForked' ? childForkTx : hash}, ${index + 10}, 1, ${identity}, ${name}, ${JSON.stringify(data)}::text::jsonb, true)`

		const earlierHash = `0x${'4'.repeat(64)}`
		const otherTx = `0x${'5'.repeat(64)}`
		await connection`INSERT INTO blocks (chain_id, number, hash, canonical, timestamp) VALUES (${chainId}, 0, ${earlierHash}, true, now())`
		const insertBurn = (identity: string, amount: string, burner: string, block: number, blockHash: string, tx: string, index: number) =>
			connection`INSERT INTO fork_migration_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical)
				VALUES (${chainId}, ${blockHash}, ${tx}, ${index}, ${block}, ${identity}, 'RepBurned', ${JSON.stringify({ universeId: identity, amountAttoRep: amount, burner })}::text::jsonb, true)`
		await insertBurn('1', '500', ownerA, 0, earlierHash, earlierHash, 1)
		await insertBurn('1', '8', ownerA, 1, hash, hash, 1)
		await insertBurn('2', '25', coordinator, 1, hash, hash, 2)
		await insertBurn('2', '700', coordinator, 1, hash, otherTx, 3)
		await insertBurn('2', '900', ownerB, 1, hash, hash, 4)

		const catalog = await forkCatalogData(connection, { chainId, snapshotBlock: '1' })
		const catalogCounts = Object.fromEntries(catalog.map((row: Record<string, unknown>) => [String(row['universe_identity']), row['portfolio_fork_events']]))
		// Universe 1: its freeze and two choices plus the start and activation of its child 2.
		// Universe 2: its freeze and one choice plus the start of its child 4, but not its own start and activation.
		expect(catalogCounts).toEqual({ '1': 5, '2': 3 })
		expect(catalog.find((row: Record<string, unknown>) => row['universe_identity'] === '2')?.['burned_atto_rep']).toBe('20')
		expect(catalog.find((row: Record<string, unknown>) => row['universe_identity'] === '1')?.['burned_atto_rep']).toBe('33')

		const page = { block: '1', log: 2_147_483_647, tx: `0x${'f'.repeat(64)}`, limit: 100 }
		const parentFork = await forkDetailData(connection, { chainId, snapshotBlock: '1', identity: '1', page })
		expect(parentFork.summary).toMatchObject({ portfolio_fork_events: 5, branch_chooser_count: 2, burned_atto_rep: '33' })
		const childFork = await forkDetailData(connection, { chainId, snapshotBlock: '1', identity: '2', page })
		expect(childFork.summary).toMatchObject({ portfolio_fork_events: 3, branch_chooser_count: 1, burned_atto_rep: '20' })
		// The detail event list still shows every event that names the universe, including its own branch start.
		expect(childFork.rows.map((row: Record<string, unknown>) => row['event_name']).sort()).toEqual(['BranchActivated', 'BranchChosen', 'BranchStarted', 'BranchStarted', 'ForkFrozen', 'RepBurned', 'RepBurned', 'RepBurned', 'UniverseForked'])

		const participation = await addressSecurityPoolRows(connection, { chainId, snapshotBlock: '1', address: ownerA, limit: 100, lpOffset: 0, forkOffset: 0, reportOffset: 0 })
		expect(participation.forkRows.map((row: Record<string, unknown>) => [row['universe_identity'], row['event_name']]).sort()).toEqual([
			[branch('1'), 'BranchChosen'],
			[branch('2'), 'BranchChosen'],
			['1', 'UniverseForked'],
		])
		// Both fork roots are at block 1. Page two must still count the child burn at the block-2 snapshot.
		const laterHash = `0x${'6'.repeat(64)}`
		await connection`INSERT INTO networks (chain_id, indexed_block, indexed_hash) VALUES (${chainId}, 3, ${otherTx})`
		await connection`INSERT INTO blocks (chain_id, number, hash, canonical, timestamp) VALUES (${chainId}, 2, ${laterHash}, true, now())`
		await insertBurn('2', '11', coordinator, 2, laterHash, laterHash, 1)
		await connection`INSERT INTO fork_migration_events (chain_id, block_hash, tx_hash, log_index, block_number, universe_identity, event_name, event_data, canonical) VALUES
			(${chainId}, ${laterHash}, ${laterHash}, 2, 2, ${branch('2')}, 'BranchStarted', '{"universeId":"2"}', true),
			(${chainId}, ${otherTx}, ${otherTx}, 1, 3, '3', 'UniverseForked', ${JSON.stringify({ universeId: '3', forker: ownerC, migrationRepBalanceAttoRep: String(80n) })}::text::jsonb, true)`
		const initiator = { chainId, address: ownerC, limit: 1, lpOffset: 0, forkOffset: 0, reportOffset: 0 }
		expect((await addressSecurityPoolRows(connection, { ...initiator, snapshotBlock: '3' })).forkRows).toEqual([expect.objectContaining({ universe_identity: '3', event_name: 'UniverseForked', event_data: expect.objectContaining({ migrationRepBalanceAttoRep: String(80n) }) })])
		expect((await addressSecurityPoolRows(connection, { ...initiator, snapshotBlock: '2' })).forkRows[0]).toMatchObject({ total: 0, event_name: null })
		const request = new URL(`http://localhost/api/v1/state/forks?chainId=${chainId}&atBlock=2&limit=1`)
		const first = await (await domainCatalogResponse(connection, request, 'forks')).json()
		expect(first).toMatchObject({ asOf: { blockNumber: '2' }, data: { total: 2, hasMore: true, items: [{ universe_identity: '2' }] } })
		expect(typeof first.data.nextCursor).toBe('string')
		request.searchParams.delete('atBlock')
		request.searchParams.set('cursor', first.data.nextCursor)
		const second = await (await domainCatalogResponse(connection, request, 'forks')).json()
		expect(second).toMatchObject({ asOf: { blockNumber: '2' }, data: { total: 2, hasMore: false, items: [{ universe_identity: '1', burned_atto_rep: '44' }] } })
	} finally {
		connection.release()
		await sql.close()
	}
})

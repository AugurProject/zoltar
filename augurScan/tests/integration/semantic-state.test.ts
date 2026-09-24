import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { initializeSchema } from '../../src/schema.ts'
import { sharePositions, pendingAuctionRefunds, escalationPositions } from '../../src/repositories/share-positions.ts'
import { escalationCatalogData } from '../../src/repositories/operations.ts'
import { protocolFeeEconomics } from '../../src/repositories/fee-economics.ts'
import { chainDecodeCoverage } from '../../src/abi-coverage-report.ts'

const url = process.env['POSTGRES_TEST_URL']
test.skipIf(url === undefined)('canonical semantic state respects snapshots, migrations, claims and fee accounting boundaries', async () => {
	if (url === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const sql = new SQL(url)
	await initializeSchema(sql)
	const connection = await sql.reserve()
	try {
		for (const table of ['logs', 'blocks', 'contracts', 'amm_markets', 'escalation_game_events', 'truth_auction_events', 'entity_state_snapshots', 'pool_snapshots', 'transactions', 'actions']) {
			await connection.unsafe(`CREATE TEMP TABLE ${table} AS SELECT * FROM public.${table} WITH NO DATA`)
		}
		const token = `0x${'1'.repeat(40)}`
		const owner = `0x${'2'.repeat(40)}`
		const zero = `0x${'0'.repeat(40)}`
		const hash = `0x${'3'.repeat(64)}`
		await connection`INSERT INTO blocks (chain_id, number, hash, canonical) VALUES (1, 1, ${hash}, true)`
		await connection`INSERT INTO contracts (chain_id, address, kind, canonical) VALUES (1, ${token}, 'shareToken', true)`
		const transfers = [
			['TransferBatch', { from: zero, to: owner, ids: ['0', '1', '2'], values: ['10', '20', '30'] }, true],
			['TransferSingle', { from: owner, to: zero, id: '1', value: '5' }, true],
			['TransferSingle', { from: zero, to: owner, id: '257', value: '15' }, true],
			['Migrate', { migrator: owner, fromId: '1', toId: '257', amountAttoShares: '15' }, true],
			['TransferSingle', { from: zero, to: owner, id: '1', value: '999' }, false],
		] as const
		for (const [index, [name, data, canonical]] of transfers.entries())
			await connection`INSERT INTO logs (chain_id, block_number, block_hash, tx_hash, log_index, emitter_address, event_name, arguments, canonical) VALUES (1, 1, ${hash}, ${hash}, ${index}, ${token}, ${name}, ${JSON.stringify(data)}::text::jsonb, ${canonical})`
		const positions = await sharePositions(connection, 1, '1', { address: owner })
		expect(positions.items).toHaveLength(2)
		expect(positions.items[0]).toMatchObject({ universe_id: '0', invalid_atto_shares: '10', yes_atto_shares: '15', no_atto_shares: '30', complete_sets_atto_shares: '10', migration_locked: true })
		expect(positions.items[1]).toMatchObject({ universe_id: '1', yes_atto_shares: '15', complete_sets_atto_shares: '0', migration_locked: false })
		expect((await sharePositions(connection, 1, '0', { address: owner })).items).toEqual([])
		for (const [index, [name, amount]] of [
			['EthRefundCredited', '12'],
			['PendingEthRefundWithdrawn', '5'],
		].entries())
			await connection`INSERT INTO truth_auction_events (chain_id, block_number, block_hash, tx_hash, log_index, auction_address, event_name, event_data, canonical) VALUES (1, 1, ${hash}, ${hash}, ${index}, ${token}, ${name}, ${JSON.stringify({ bidder: owner, amountAttoEth: amount })}::text::jsonb, true)`
		expect(await pendingAuctionRefunds(connection, 1, '1', owner)).toEqual([expect.objectContaining({ pending_atto_eth: '7' })])
		await connection`INSERT INTO escalation_game_events (chain_id, game_address, block_number, block_hash, tx_hash, log_index, event_name, event_data, canonical) VALUES (1, ${token}, 1, ${hash}, ${hash}, 1, 'LocalDepositAppended', ${JSON.stringify({ depositor: owner, outcome: '1', parentDepositIndex: '4', attoRepAmount: '200' })}::text::jsonb, true)`
		await connection`INSERT INTO entity_state_snapshots (chain_id, entity_type, entity_identity, block_number, block_hash, read_status, read_result, canonical) VALUES (1, 'escalation', ${token}, 1, ${hash}, 'success', ${JSON.stringify({ outcomeBalancesAttoRep: ['2', '3', '4'], finalQuestionResolution: '1' })}::text::jsonb, true)`
		expect(await escalationCatalogData(connection, 1, '1')).toEqual([expect.objectContaining({ invalid_stake_atto_rep: '2', yes_stake_atto_rep: '3', no_stake_atto_rep: '4' })])
		expect(await escalationPositions(connection, 1, '1', owner)).toEqual([expect.objectContaining({ principal_atto_rep: '200', consumed_block: null, final_resolution: '1' })])
		await connection`INSERT INTO escalation_game_events (chain_id, game_address, block_number, block_hash, tx_hash, log_index, event_name, event_data, canonical) VALUES (1, ${token}, 2, ${hash}, ${hash}, 2, 'CarryDepositConsumed', ${JSON.stringify({ depositor: owner, outcome: '1', parentDepositIndex: '4', reason: '0' })}::text::jsonb, true)`
		expect((await escalationPositions(connection, 1, '2', owner))[0]).toMatchObject({ consumed_block: '2', consumption_reason: '0' })
		for (const [index, [reason, fees]] of [
			[5, 0],
			[0, 10],
			[1, 4],
			[2, 4],
			[0, 7],
		].entries())
			await connection`INSERT INTO pool_snapshots (chain_id, pool_address, block_number, log_index, reason, unallocated_accrued_fees_atto_eth, canonical) VALUES (1, ${token}, 1, ${index}, ${reason}, ${fees}, true)`
		expect(await protocolFeeEconomics(connection, 1, '1')).toMatchObject({ accrued_atto_eth: '13', missing_baselines: '0' })
		await connection`INSERT INTO transactions (chain_id, hash, block_hash, block_number, to_address, input, status, receipt, canonical) VALUES (1, ${hash}, ${hash}, 1, ${token}, '0x12345678', 'reverted', '{"callTraceStatus":"unavailable"}'::jsonb, true)`
		await connection`INSERT INTO actions (chain_id, tx_hash, block_hash, decode_status) VALUES (1, ${hash}, ${hash}, 'unknown')`
		expect(await chainDecodeCoverage(connection, 1, '1')).toMatchObject({ observed_calls: '1', undecoded_calls: '1', traced_transactions: '0' })
		expect(await chainDecodeCoverage(connection, 2, '1')).toMatchObject({ observed_calls: '0', undecoded_calls: '0' })
	} finally {
		connection.release()
		await sql.close()
	}
})

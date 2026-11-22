import { expect } from 'bun:test'
import { SQL } from 'bun'
import { initializeSchema } from '../../src/schema.ts'
import { poolStateHistory } from '../../src/repositories/state-history.ts'
import { postgresTest, requirePostgresUrl } from '../support/postgres-fixtures.ts'

postgresTest('pool market identity respects the inclusive history end, independent of the start', async () => {
	const sql = new SQL(requirePostgresUrl())
	const chainId = 900000 + process.pid
	try {
		await initializeSchema(sql)
		await sql`INSERT INTO networks (chain_id, id, name, explorer_base_url, start_block) VALUES (${chainId}, ${String(chainId)}, 'History', '', 0)`
		for (const number of [20]) {
			await sql`INSERT INTO blocks (chain_id, number, hash, parent_hash, timestamp, canonical) VALUES (${chainId}, ${number}, ${String(number)}, 'parent', now(), true)`
			await sql`INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, value, input, status, receipt) VALUES (${chainId}, ${String(number)}, ${String(number)}, ${number}, 0, 'sender', 0, '0x', 'success', '{}'::jsonb)`
			await sql`INSERT INTO logs (chain_id, tx_hash, block_hash, block_number, transaction_index, log_index, emitter_address, topics, data, decode_status, summary) VALUES (${chainId}, ${String(number)}, ${String(number)}, ${number}, 0, 0, 'factory', '[]'::jsonb, '0x', 'unknown', 'pair created')`
			await sql`INSERT INTO amm_markets (chain_id, block_hash, tx_hash, log_index, block_number, pair_address, pool_address, share_token_address, universe_id, fee_bps) VALUES (${chainId}, ${String(number)}, ${String(number)}, 0, ${number}, ${'pair' + number}, 'pool', 'share', 1, ${number})`
		}
		for (const boundary of [
			{ fromBlock: '0', toBlock: '9', pair: undefined },
			{ fromBlock: '0', toBlock: '19', pair: undefined },
			{ fromBlock: '21', toBlock: '30', pair: 'pair20' },
			{ fromBlock: '0', toBlock: '20', pair: 'pair20' },
		]) {
			const result = await poolStateHistory(sql, 'pool', { chainId, ...boundary, queryLimit: 10, offset: 0 })
			expect(result.markets[0]?.pair_address).toBe(boundary.pair)
		}
	} finally {
		await sql`DELETE FROM amm_markets WHERE chain_id = ${chainId}`
		await sql`DELETE FROM logs WHERE chain_id = ${chainId}`
		await sql`DELETE FROM transactions WHERE chain_id = ${chainId}`
		await sql`DELETE FROM blocks WHERE chain_id = ${chainId}`
		await sql`DELETE FROM networks WHERE chain_id = ${chainId}`
		await sql.close()
	}
})

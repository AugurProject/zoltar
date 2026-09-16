import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { unknownCallReport } from '../../src/abi-coverage-report.ts'
import { initializeSchema } from '../../src/schema.ts'

const postgresUrl = process.env['POSTGRES_TEST_URL']

test.skipIf(postgresUrl === undefined)('reports undecoded canonical calls by chain, destination and selector, without counting orphaned actions', async () => {
	if (postgresUrl === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const sql = new SQL(postgresUrl)
	try {
		await initializeSchema(sql)
		const connection = await sql.reserve()
		try {
			await connection`CREATE TEMP TABLE actions (LIKE public.actions INCLUDING DEFAULTS)`
			await connection`CREATE TEMP TABLE transactions (LIKE public.transactions INCLUDING DEFAULTS)`
			const destination = `0x${'1'.repeat(40)}`
			const blockHash = `0x${'2'.repeat(64)}`
			for (const [index, status, canonical, input, to, chain] of [
				[1, 'unknown', true, '0x1234567800', destination, 1],
				[2, 'unknown', true, '0x1234567801', destination, 1],
				[3, 'failed', true, '0x1234567802', destination, 1],
				[4, 'decoded', true, '0x1234567803', destination, 1],
				[5, 'unknown', false, '0x1234567804', destination, 1],
				[6, 'unknown', true, '0x', destination, 1],
				[7, 'unknown', true, '0x6000000000', null, 1],
				[8, 'unknown', true, '0x1234567805', destination, 11155111],
				[9, 'unknown', true, '0x1234', destination, 1],
			] as const) {
				const hash = `0x${index.toString().padStart(64, '0')}`
				await connection`INSERT INTO transactions (chain_id, hash, block_hash, block_number, transaction_index, from_address, to_address, value, input, status, receipt, canonical)
					VALUES (${chain}, ${hash}, ${blockHash}, ${index}, 0, ${destination}, ${to}, 0, ${input}, 'success', '{}', ${canonical})`
				await connection`INSERT INTO actions (chain_id, block_hash, tx_hash, contract_address, decode_status, summary)
					VALUES (${chain}, ${blockHash}, ${hash}, ${to}, ${status}, 'test')`
			}
			// A stale decode with the same transaction hash but a different block
			// must not join the canonical transaction occurrence.
			await connection`INSERT INTO actions (chain_id, block_hash, tx_hash, contract_address, decode_status, summary)
				SELECT chain_id, 'orphaned-block', tx_hash, contract_address, 'unknown', summary FROM actions WHERE decode_status = 'decoded'`
			const report = await unknownCallReport(connection)
			expect(report).toHaveLength(4)
			expect(report[0]).toMatchObject({ chain_id: '1', destination, selector: '0x12345678', decode_status: 'unknown', transaction_count: '2', first_block: '1', last_block: '2' })
			expect(report.some(row => row.chain_id === '1' && row.decode_status === 'failed' && row.transaction_count === '1')).toBe(true)
			expect(report.some(row => row.chain_id === '11155111' && row.transaction_count === '1')).toBe(true)
			expect(report.some(row => row.selector === null && row.transaction_count === '1')).toBe(true)
			expect(await unknownCallReport(connection, 1)).toHaveLength(1)
			await expect(unknownCallReport(connection, 0)).rejects.toThrow('Report limit')
			await expect(unknownCallReport(connection, 1001)).rejects.toThrow('Report limit')
		} finally {
			await connection`DROP TABLE IF EXISTS pg_temp.actions, pg_temp.transactions`
			connection.release()
		}
	} finally {
		await sql.close()
	}
})

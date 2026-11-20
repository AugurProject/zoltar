import { richListRows } from '../../src/repositories/portfolio.ts'
import { expect, test } from 'bun:test'
import { SQL } from 'bun'

const url = process.env['POSTGRES_TEST_URL']
test.skipIf(url === undefined)('#1457 and #1474: address and report lookups use selective indexes', async () => {
	if (url === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const sql = new SQL(url)
	const connection = await sql.reserve()
	try {
		await connection`BEGIN`
		const schemaName = `query_budget_${process.pid}`
		await connection.unsafe(`CREATE SCHEMA ${schemaName}`)
		await connection.unsafe(`SET LOCAL search_path = ${schemaName}`)
		const schema = await Bun.file(new URL('../../schema.sql', import.meta.url)).text()
		await connection.unsafe(schema.replaceAll('public.', `${schemaName}.`).replace('COMMENT ON SCHEMA public', `COMMENT ON SCHEMA ${schemaName}`))
		await connection`SET LOCAL enable_seqscan = off`
		const plans = [
			['logs_sender_lookup', `SELECT * FROM logs WHERE chain_id = 1 AND canonical AND lower(arguments->>'from') = '0x01' AND event_name IN ('TransferSingle', 'TransferBatch')`],
			['logs_receiver_lookup', `SELECT * FROM logs WHERE chain_id = 1 AND canonical AND lower(arguments->>'to') = '0x01' AND event_name IN ('TransferSingle', 'TransferBatch')`],
			['transactions_sender_history', `SELECT * FROM transactions WHERE chain_id = 1 AND canonical AND from_address = '0x01' ORDER BY block_number DESC, transaction_index DESC LIMIT 26`],
			['logs_report_lookup', `SELECT * FROM logs WHERE chain_id = 1 AND canonical AND arguments->>'reportId' = '1' ORDER BY block_number DESC LIMIT 26`],
		] as const
		for (const [index, query] of plans) {
			const plan = await connection.unsafe(`EXPLAIN (FORMAT JSON) ${query}`)
			expect(JSON.stringify(plan)).toContain(index)
		}
		const explained = new Proxy(connection, {
			get(target, property) {
				if (property !== 'unsafe') return Reflect.get(target, property)
				return (...args: Parameters<typeof target.unsafe>) => target.unsafe(`EXPLAIN (FORMAT JSON) ${args[0]}`, args[1])
			},
		})
		const ranking = await richListRows(explained, { chainId: 1, snapshotBlock: '100', limit: 25, offset: 0, sort: 'transactions' })
		expect(JSON.stringify(ranking)).toContain('address_activity_summaries_latest')
	} finally {
		await connection`ROLLBACK`
		connection.release()
		await sql.close()
	}
})

import { addressTransactionHistory } from '../../src/repositories/address-history.ts'
import { reportDetailData } from '../../src/repositories/entity-details.ts'
import { richListRows } from '../../src/repositories/security-pool.ts'
import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'

const url = process.env['POSTGRES_TEST_URL']
const explainPrefix = 'EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '
const explainSql = (connection: SQL) =>
	new Proxy(connection, {
		get(target, property) {
			if (property !== 'unsafe') return Reflect.get(target, property)
			return (query: string, parameters?: unknown[]) => target.unsafe(explainPrefix + query, parameters)
		},
		apply(target, receiver, [template, ...parameters]) {
			const parts = [explainPrefix + template[0], ...template.slice(1)]
			const raw = [explainPrefix + template.raw[0], ...template.raw.slice(1)]
			return Reflect.apply(target, receiver, [Object.defineProperty(parts, 'raw', { value: raw }), ...parameters])
		},
	})

function planRoot(rows: unknown) {
	const report = Array.isArray(rows) && isPlainRecord(rows[0]) ? rows[0]['QUERY PLAN'] : undefined
	const root = Array.isArray(report) && isPlainRecord(report[0]) ? report[0]['Plan'] : undefined
	if (!isPlainRecord(root)) throw new Error('PostgreSQL did not return a JSON query plan')
	return root
}

function assertReportWork(rows: unknown, expectedRows: number) {
	const node = planRoot(rows)
	expect(node['Actual Rows']).toBe(expectedRows)
	expect(node['Actual Loops']).toBe(1)
	const hits = Number(node['Shared Hit Blocks'])
	const reads = Number(node['Shared Read Blocks'])
	expect(hits + reads).toBeLessThan(250)
}

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
		const sender = `0x${'1'.repeat(40)}`
		const unrelated = `0x${'2'.repeat(40)}`
		await connection`INSERT INTO networks(chain_id,id,name,explorer_base_url,start_block) VALUES (1,'budget','Budget','',0)`
		await connection`INSERT INTO blocks(chain_id,number,hash,parent_hash,timestamp) VALUES (1,1,'0x01','0x00',now())`
		await connection`INSERT INTO transactions(chain_id,hash,block_hash,block_number,transaction_index,from_address,value,input,status,receipt)
			SELECT 1,'0x'||lpad(to_hex(i),64,'0'),'0x01',1,i,CASE WHEN i <= 1000 THEN ${sender} ELSE ${unrelated} END,0,'0x','success','{}'
			FROM generate_series(1, 41000) AS i`
		await connection`ANALYZE transactions`
		const explained = explainSql(connection)
		const options = { chainId: 1, address: sender, snapshotBlock: '1', limit: 25, cursorBlock: '1', cursorIndex: 1000 }
		const history = await addressTransactionHistory(connection, options)
		expect(history).toHaveLength(26)
		expect(Number(history[0]?.snapshot_total)).toBe(1000)
		const historyPlan = JSON.stringify(await addressTransactionHistory(explained, options))
		expect(historyPlan).toContain('transactions_sender_history')
		expect(historyPlan).not.toMatch(/"Rows Removed by Filter":\s*40000/)
		await connection`INSERT INTO transactions(chain_id,hash,block_hash,block_number,transaction_index,from_address,value,input,status,receipt)
			SELECT 1,'0x'||lpad(to_hex(i),64,'0'),'0x01',1,i,${sender},0,'0x','success','{}' FROM generate_series(41001, 50000) AS i`
		await connection`ANALYZE transactions`
		const largerHistory = await addressTransactionHistory(connection, options)
		expect(largerHistory.map((row: { tx_hash: string }) => row.tx_hash)).toEqual(history.map((row: { tx_hash: string }) => row.tx_hash))
		expect(Number(largerHistory[0]?.snapshot_total)).toBe(10000)
		const largerPlan = JSON.stringify(await addressTransactionHistory(explained, options))
		// At higher selectivity PostgreSQL may prefer a scan. The window still sees only matching history.
		expect(largerPlan).toMatch(/"Node Type":"WindowAgg"[^}]*"Actual Rows":10000[,}]/)

		// Availability checks for the remaining indexes are independent of the production history plan.
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
		const ranking = await richListRows(explained, { chainId: 1, snapshotBlock: '100', limit: 25, offset: 0, sort: 'transactions' })
		expect(JSON.stringify(ranking)).toContain('address_activity_summaries_latest')
		await connection`RESET enable_seqscan`

		const seedReportRounds = async (first: number, last: number, matchingThrough: number) => {
			await connection`INSERT INTO logs(chain_id,tx_hash,block_hash,block_number,transaction_index,log_index,emitter_address,topics,data,event_name,arguments,decode_status,summary)
				SELECT 1,'0x'||lpad(to_hex(i),64,'0'),'0x01',1,i,i,${sender},'[]','0x',
					CASE WHEN i = 1 THEN 'PriceRequested' ELSE 'PriceReportDeferred' END,
					jsonb_build_object('reportId', CASE WHEN i <= 12 THEN 1 ELSE i END),'decoded',''
				FROM generate_series(${first}::integer, ${last}::integer) AS i`
			await connection`INSERT INTO open_oracle_report_events(chain_id,block_hash,tx_hash,log_index,block_number,open_oracle_address,report_id,event_name,round_number,report_data)
				SELECT 1,'0x01','0x'||lpad(to_hex(i),64,'0'),i,1,${sender},
					CASE WHEN i <= ${matchingThrough} THEN 1 ELSE i + 1 END,
					CASE WHEN i = 1 THEN 'ReportSubmitted' ELSE 'ReportDisputed' END,i,'{}'
				FROM generate_series(${first}::integer, ${last}::integer) AS i`
		}
		await seedReportRounds(1, 41000, 1000)
		await connection`UPDATE logs SET canonical = false WHERE log_index = 10`
		await connection`UPDATE open_oracle_report_events SET canonical = false WHERE log_index = 990`
		const roundIndices = Array.from({ length: 27 }, (_, index) => 999 - index).filter(index => index !== 990)
		const boundary = { block: '1', log: 1000, tx: '', limit: 26 }
		const reportQuery = { chainId: 1, openOracleAddress: sender, reportId: '1', snapshotBlock: '1', rounds: boundary, decisions: boundary }
		for (const scale of [1000, 10000]) {
			if (scale === 10000) await seedReportRounds(41001, 50000, 50000)
			await connection`ANALYZE open_oracle_report_events, logs`
			const report = await reportDetailData(connection, reportQuery)
			expect(report.rows.map((row: { log_index: number }) => row.log_index)).toEqual(roundIndices)
			expect(report.coordinatorDecisions.map((row: { log_index: number }) => row.log_index)).toEqual([12, 11, 9, 8, 7, 6, 5, 4, 3, 2, 1])
			const reportPlan = await reportDetailData(explained, reportQuery)
			assertReportWork(reportPlan.rows, 26)
			assertReportWork(reportPlan.coordinatorDecisions, 11)
			expect(JSON.stringify(reportPlan.coordinatorDecisions)).toContain('logs_report_lookup')
		}
	} finally {
		await connection`ROLLBACK`
		connection.release()
		await sql.close()
	}
})

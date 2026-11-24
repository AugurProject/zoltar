import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { refreshHistoryAggregates } from '../../src/database/history-aggregates.ts'
import { operationsOverviewSupplement, reportCatalogData } from '../../src/repositories/operations.ts'
import { richListRows } from '../../src/repositories/security-pool.ts'

const url = process.env['POSTGRES_TEST_URL']
test.skipIf(url === undefined)('#1474: maintained totals and address ranking preserve snapshots and reorgs', async () => {
	if (url === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const pool = new SQL(url)
	const sql = await pool.reserve()
	try {
		await sql`BEGIN`
		const schemaName = `aggregate_prefixes_${process.pid}`
		await sql.unsafe(`CREATE SCHEMA ${schemaName}`)
		await sql.unsafe(`SET LOCAL search_path=${schemaName}`)
		await sql.unsafe((await Bun.file(new URL('../../schema.sql', import.meta.url)).text()).replaceAll('public.', `${schemaName}.`).replace('COMMENT ON SCHEMA public', `COMMENT ON SCHEMA ${schemaName}`))
		const owner = `0x${'1'.repeat(40)}`
		const oracle = `0x${'2'.repeat(40)}`
		const hash = (id: number) => `0x${id.toString(16).padStart(64, '0')}`
		await sql`INSERT INTO networks(chain_id,id,name,explorer_base_url,start_block,indexed_block,indexed_hash) VALUES(1,'test','test','',0,2,${hash(2)})`
		const append = async (number: number, blockHash: string, newReport: number) => {
			await sql`INSERT INTO blocks(chain_id,number,hash,parent_hash,timestamp) VALUES(1,${number},${blockHash},${hash(0)},now())`
			await sql`INSERT INTO transactions(chain_id,hash,block_hash,block_number,transaction_index,from_address,value,input,status,receipt) VALUES(1,${hash(100 + newReport)},${blockHash},${number},0,${owner},0,'0x','success','{}')`
			for (const logIndex of [0, 1]) {
				await sql`INSERT INTO logs(chain_id,tx_hash,block_hash,block_number,transaction_index,log_index,emitter_address,topics,data,decode_status,summary) VALUES(1,${hash(100 + newReport)},${blockHash},${number},0,${logIndex},${oracle},'[]','0x','decoded','report')`
				await sql`INSERT INTO open_oracle_report_events(chain_id,block_hash,tx_hash,log_index,block_number,open_oracle_address,report_id,event_name,report_data) VALUES(1,${blockHash},${hash(100 + newReport)},${logIndex},${number},${oracle},${logIndex === 0 ? 1 : newReport},'ReportSubmitted','{}')`
			}
			for (const poolAddress of [oracle, `0x${String(newReport).repeat(40)}`]) await sql`INSERT INTO address_activity(chain_id,block_hash,block_number,tx_hash,address,pool_address,role) VALUES(1,${blockHash},${number},${hash(100 + newReport)},${owner},${poolAddress},'sender') ON CONFLICT DO NOTHING`
			await refreshHistoryAggregates(sql, 1, blockHash, String(number))
		}
		await append(1, hash(1), 2)
		await append(2, hash(2), 3)
		expect((await operationsOverviewSupplement(sql, 1, '1')).totals).toMatchObject({ reports: 2 })
		expect((await operationsOverviewSupplement(sql, 1, '2')).totals).toMatchObject({ reports: 3 })
		// A large round history belongs to one identity; catalog discovery must not walk every round.
		await sql`INSERT INTO logs(chain_id,tx_hash,block_hash,block_number,transaction_index,log_index,emitter_address,topics,data,decode_status,summary)
		 SELECT 1,${hash(103)},${hash(2)},2,0,i,${oracle},'[]','0x','decoded','round' FROM generate_series(2,10001)i`
		await sql`INSERT INTO open_oracle_report_events(chain_id,block_hash,tx_hash,log_index,block_number,open_oracle_address,report_id,event_name,report_data)
		 SELECT 1,${hash(2)},${hash(103)},i,2,${oracle},1,'ReportDisputed','{}' FROM generate_series(2,10001)i`
		const identities: string[] = []
		let cursorBlock = '2',
			cursorLog = 2147483647,
			cursorTx = `0x${'f'.repeat(64)}`
		for (let page = 0; page < 4; page++) {
			const rows = await reportCatalogData(sql, 1, { blockNumber: '2', blockTimestamp: '100' }, cursorBlock, cursorTx, cursorLog, 1)
			const row = rows[0]
			if (row === undefined) break
			identities.push(String(row.report_id))
			cursorBlock = String(row.block_number)
			cursorLog = Number(row.log_index)
			cursorTx = String(row.tx_hash)
		}
		expect(identities).toEqual(['1', '3', '2'])
		expect((await reportCatalogData(sql, 1, { blockNumber: '1', blockTimestamp: '100' })).map((row: Record<string, unknown>) => row['report_id'])).toEqual(['2', '1'])
		await sql`SET LOCAL enable_seqscan=off`
		const explained = new Proxy(sql, {
			apply(target, thisArg, args) {
				const strings = args[0]
				if (!Array.isArray(strings)) throw new Error('Expected tagged SQL')
				const query = [`EXPLAIN (ANALYZE,FORMAT JSON) ${strings[0]}`, ...strings.slice(1)]
				Object.defineProperty(query, 'raw', { value: query })
				return Reflect.apply(target, thisArg, [query, ...args.slice(1)])
			},
		})
		const plan = await reportCatalogData(explained, 1, { blockNumber: '2', blockTimestamp: '100' }, '2', `0x${'f'.repeat(64)}`, 2147483647, 1)
		expect(JSON.stringify(plan)).toContain('protocol_entity_identities_current')
		expect(JSON.stringify(plan)).toContain('open_oracle_report_round_page')
		await sql`SET LOCAL enable_seqscan=on`

		const earlier = await richListRows(sql, { chainId: 1, snapshotBlock: '1', limit: 10, offset: 0, sort: 'transactions' })
		const later = await richListRows(sql, { chainId: 1, snapshotBlock: '2', limit: 10, offset: 0, sort: 'transactions' })
		expect(earlier[0]).toMatchObject({ address: owner, transaction_count: '1', interaction_count: '1', pool_count: '1' })
		expect(later[0]).toMatchObject({ address: owner, transaction_count: '2', interaction_count: '2', pool_count: '2' })
		for (const table of ['blocks', 'transactions', 'logs', 'open_oracle_report_events', 'address_activity', 'address_activity_summaries', 'protocol_entity_identities', 'protocol_entity_totals']) await sql.unsafe(`UPDATE ${table} SET canonical=false WHERE ${table === 'blocks' ? 'number' : 'block_number'}=2`)
		await append(2, hash(3), 4)
		expect((await operationsOverviewSupplement(sql, 1, '2')).totals).toMatchObject({ reports: 3 })
		expect((await richListRows(sql, { chainId: 1, snapshotBlock: '2', limit: 10, offset: 0, sort: 'transactions' }))[0]).toMatchObject({ transaction_count: '2', pool_count: '2' })
	} finally {
		await sql`ROLLBACK`
		sql.release()
		await pool.close()
	}
})

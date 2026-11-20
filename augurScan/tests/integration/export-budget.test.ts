import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { historicalExport } from '../../src/api/exports.ts'

const url = process.env['POSTGRES_TEST_URL']
test.skipIf(url === undefined)('#1475: byte-bounded export pages resume without missing or duplicate rows', async () => {
	if (url === undefined) throw new Error('POSTGRES_TEST_URL is required')
	const sql = new SQL(url)
	const connection = await sql.reserve()
	try {
		await connection`BEGIN`
		const schemaName = `export_budget_${process.pid}`
		await connection.unsafe(`CREATE SCHEMA ${schemaName}`)
		await connection.unsafe(`SET LOCAL search_path = ${schemaName}`)
		const schema = await Bun.file(new URL('../../schema.sql', import.meta.url)).text()
		await connection.unsafe(schema.replaceAll('public.', `${schemaName}.`).replace('COMMENT ON SCHEMA public', `COMMENT ON SCHEMA ${schemaName}`))
		const hash = `0x${'1'.repeat(64)}`
		const address = `0x${'2'.repeat(40)}`
		await connection`INSERT INTO networks (chain_id,id,name,explorer_base_url,start_block,indexed_block,indexed_hash) VALUES (1,'test','test','',0,1,${hash})`
		await connection`INSERT INTO blocks (chain_id,number,hash,parent_hash,timestamp) VALUES (1,1,${hash},${hash},now())`
		await connection`INSERT INTO transactions (chain_id,hash,block_hash,block_number,transaction_index,from_address,value,input,status,receipt) VALUES (1,${hash},${hash},1,0,${address},0,'0x','success','{}')`
		await connection`INSERT INTO logs (chain_id,tx_hash,block_hash,block_number,transaction_index,log_index,emitter_address,topics,data,decode_status,summary)
   SELECT 1,${hash},${hash},1,0,i,${address},'[]'::jsonb,'0x','unknown',repeat('x',131072) FROM generate_series(0,127) i`
		const seen: number[] = []
		const request = new URL('http://localhost/api/v1/export?chainId=1&dataset=logs&limit=50000')
		for (let page = 0; page < 10; page++) {
			const response = await historicalExport(connection, request)
			const body = await response.text()
			expect(new TextEncoder().encode(body).length).toBeLessThanOrEqual(8 * 1024 * 1024)
			seen.push(
				...body
					.trim()
					.split('\n')
					.filter(Boolean)
					.map(line => JSON.parse(line).log_index),
			)
			const cursor = response.headers.get('x-augurscan-next-cursor')
			if (cursor === null) break
			request.searchParams.set('cursor', cursor)
		}
		expect(seen).toEqual(Array.from({ length: 128 }, (_, i) => i))
	} finally {
		await connection`ROLLBACK`
		connection.release()
		await sql.close()
	}
})

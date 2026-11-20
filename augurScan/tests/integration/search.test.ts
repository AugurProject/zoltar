import { expect } from 'bun:test'
import { SQL } from 'bun'
import { searchResponse } from '../../src/api/search.ts'

import { postgresTest, requirePostgresUrl } from '../support/postgres-fixtures.ts'
const pool = `0x${'1'.repeat(40)}`

postgresTest('search prioritizes a known pool ahead of generic address results across networks', async () => {
	const sql = new SQL(requirePostgresUrl())
	const connection = await sql.reserve()
	try {
		await connection`CREATE TEMP TABLE networks (chain_id integer)`
		await connection`CREATE TEMP TABLE pools (chain_id integer, pool_address text, question_id numeric, canonical boolean)`
		await connection`CREATE TEMP TABLE questions (chain_id integer, question_id numeric, title text, created_timestamp integer, canonical boolean)`
		await connection`INSERT INTO networks VALUES (1), (2)`
		await connection`INSERT INTO pools VALUES (2, ${pool}, 42, true)`
		await connection`INSERT INTO questions VALUES (2, 42, 'Market question', 100, true)`
		const response = await searchResponse(connection, new URL(`http://localhost/api/v1/search?q=${pool}&limit=1`))
		expect(await response.json()).toMatchObject({ items: [{ type: 'pool', href: `/pool/${pool}?chainId=2` }] })
	} finally {
		connection.release()
		await sql.close()
	}
})

postgresTest('search finds a question by the hex ID its detail page displays', async () => {
	const sql = new SQL(requirePostgresUrl())
	const connection = await sql.reserve()
	try {
		await connection`CREATE TEMP TABLE blocks (chain_id integer, number bigint, hash text, canonical boolean)`
		await connection`CREATE TEMP TABLE questions (chain_id integer, question_id numeric, title text, created_timestamp integer, canonical boolean)`
		await connection`CREATE TEMP TABLE open_oracle_report_events (chain_id integer, open_oracle_address text, report_id numeric, canonical boolean)`
		await connection`INSERT INTO questions VALUES (1, 501, 'Unrelated title', 100, true)`
		const response = await searchResponse(connection, new URL('http://localhost/api/v1/search?chainId=1&q=0x1F5&limit=5'))
		expect(await response.json()).toMatchObject({ items: [{ type: 'question', href: '/question/501?chainId=1', detail: 'Question #0x1F5' }] })
	} finally {
		connection.release()
		await sql.close()
	}
})

postgresTest('search returns each question once when the ID also matches its title', async () => {
	const sql = new SQL(requirePostgresUrl())
	const connection = await sql.reserve()
	try {
		await connection`CREATE TEMP TABLE blocks (chain_id integer, number bigint, hash text, canonical boolean)`
		await connection`CREATE TEMP TABLE questions (chain_id integer, question_id numeric, title text, created_timestamp integer, canonical boolean)`
		await connection`CREATE TEMP TABLE open_oracle_report_events (chain_id integer, open_oracle_address text, report_id numeric, canonical boolean)`
		await connection`INSERT INTO questions VALUES (1, 42, 'Will 42 pass?', 100, true), (1, 43, 'Will 42 be counted?', 99, true)`
		const response = await searchResponse(connection, new URL('http://localhost/api/v1/search?chainId=1&q=42&limit=2'))
		expect(await response.json()).toMatchObject({
			items: [
				{ type: 'question', href: '/question/42?chainId=1', detail: 'Question #42' },
				{ type: 'question', href: '/question/43?chainId=1' },
			],
		})
	} finally {
		connection.release()
		await sql.close()
	}
})

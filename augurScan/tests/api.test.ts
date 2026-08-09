import { afterEach, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { cursorFor, handleApi, parseCursor } from '../src/api.ts'

const databases: SQL[] = []

afterEach(async () => {
	await Promise.all(databases.splice(0).map(async (database) => await database.close()))
})

test('returns request validation failures as 400 responses', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	const response = await handleApi(new Request('http://localhost/api/v1/logs?limit=invalid'), database)
	expect(response?.status).toBe(400)
	expect(await response?.json()).toEqual({ error: 'limit must be a non-negative integer' })
})

test('rejects malformed cursor timestamps and numeric positions before querying', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	for (const cursor of [
		['not-a-timestamp', 1, 2, 3, 4],
		['0000-01-01T00:00:00.000Z', 1, 2, 3, 4],
		['2026-02-30T00:00:00.000Z', 1, 2, 3, 4],
		['2026-01-01T00:00:00.000Z', 1.5, 2, 3, 4],
		['2026-01-01T00:00:00.000Z', 1, -2, 3, 4],
		['2026-01-01T00:00:00.000Z', 1, Number.MAX_SAFE_INTEGER + 1, 3, 4],
		['2026-01-01T00:00:00.000Z', 1, 2, 2_147_483_648, 4],
		['2026-01-01T00:00:00.000Z', 1, 2, 3, 2_147_483_648],
	]) {
		const encoded = encodeURIComponent(btoa(JSON.stringify(cursor)))
		const response = await handleApi(new Request(`http://localhost/api/v1/logs?cursor=${encoded}`), database)
		expect(response?.status).toBe(400)
		expect(await response?.json()).toEqual({ error: 'cursor is invalid' })
	}
})

test('round-trips a server cursor with a bigint-range chain ID', () => {
	const timestamp = new Date('2026-01-01T00:00:00.000Z')
	const cursor = cursorFor({ block_timestamp: timestamp, chain_id: 2_147_483_648, block_number: 2, transaction_index: 3, log_index: 4 })
	expect(parseCursor(cursor)).toEqual([timestamp.toISOString(), 2_147_483_648, 2, 3, 4])
})

test('returns opaque 500 responses for database failures', async () => {
	const sensitivePassword = 'never-return-this-database-password'
	const database = new SQL(`postgres://user:${sensitivePassword}@127.0.0.1:1/unused`, { connectionTimeout: 1 })
	databases.push(database)
	const response = await handleApi(new Request('http://localhost/api/v1/networks'), database)
	const body = JSON.stringify(await response?.json())
	expect(response?.status).toBe(500)
	expect(body).toBe('{"error":"Internal server error"}')
	expect(body).not.toContain(sensitivePassword)
})

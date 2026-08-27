import { afterEach, expect, test } from 'bun:test'
import { SQL } from 'bun'
import { cursorFor, handleApi, nextHistoricalExportOffset, parseCursor } from '../src/api.ts'

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

test('rejects malformed address filters before querying', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	for (const address of ['0x1234', `0x${'g'.repeat(40)}`, `0x${'1'.repeat(41)}`]) {
		for (const path of [
			`logs?address=${address}`,
			`richlist?chainId=1&address=${address}`,
			`address-identity?chainId=1&address=${address}`,
			`address-interactions?chainId=1&address=${address}`,
		]) {
			const response = await handleApi(new Request(`http://localhost/api/v1/${path}`), database)
			expect(response?.status).toBe(400)
			expect(await response?.json()).toEqual({ error: 'address must be a complete 20-byte EVM address' })
		}
	}
	const response = await handleApi(new Request('http://localhost/api/v1/richlist?address=0x1111111111111111111111111111111111111111'), database)
	expect(response?.status).toBe(400)
	expect(await response?.json()).toEqual({ error: 'chainId is required when filtering by address' })
})

test('requires a network for the contract registry', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	const response = await handleApi(new Request('http://localhost/api/v1/contracts'), database)
	expect(response?.status).toBe(400)
	expect(await response?.json()).toEqual({ error: 'chainId is required' })
	await database.close()
})

test('rejects unsupported decoded filters before querying', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	const response = await handleApi(new Request('http://localhost/api/v1/logs?decoded=maybe'), database)
	expect(response?.status).toBe(400)
	expect(await response?.json()).toEqual({ error: 'decoded must be true or false' })
})

test('rejects unsupported canonical-history filters before querying', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	for (const path of ['logs?canonical=maybe', 'reorgs?chainId=1&limit=-1']) {
		const response = await handleApi(new Request(`http://localhost/api/v1/${path}`), database)
		expect(response?.status).toBe(400)
	}
})

test('rejects negative and overlong log identifiers before querying', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	const hash = `0x${'1'.repeat(64)}`
	for (const identifier of [`-1/${hash}/${hash}/0`, `/${hash}/${hash}/0`, `1/${hash}/${hash}/-1`, `1/${hash}/${hash}/`, `1/${hash}/${hash}/0/extra`]) {
		const response = await handleApi(new Request(`http://localhost/api/v1/logs/${identifier}`), database)
		expect(response?.status).toBe(400)
		expect(await response?.json()).toEqual({ error: 'Invalid log identifier' })
	}
})

test('rejects overlong state and contract identifiers before querying', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	const address = `0x${'1'.repeat(40)}`
	for (const path of [
		`state/pools/1/${address}/extra`,
		`state/vaults/1/${address}/${address}/extra`,
		'state/universes/1/0/extra',
		'state/questions/1/0/extra',
		`contracts/1/${address}/extra`,
	]) {
		const response = await handleApi(new Request(`http://localhost/api/v1/${path}`), database)
		expect(response?.status).toBe(400)
	}
})

test('rejects non-decimal contract chain identifiers before querying', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	const address = `0x${'1'.repeat(40)}`
	for (const chain of ['1e2', '0x10']) {
		const response = await handleApi(new Request(`http://localhost/api/v1/contracts/${chain}/${address}`), database)
		expect(response?.status).toBe(400)
		expect(await response?.json()).toEqual({ error: 'Invalid contract identifier' })
	}
})

test('rejects non-decimal integer query parameters before querying', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	for (const path of [
		'logs?chainId=1e2',
		'operations?chainId=1e2',
		'state/reports?chainId=0x10',
		'logs?limit=0x10',
		'state/catalog?chainId=0x10',
		'state/catalog?limit=-1',
		'state/universes/1/0?limit=unbounded',
		'state/universes/1/0?fromBlock=-1',
		'state/universes/1/0?toBlock=9223372036854775808',
		'state/universes/1/0?fromBlock=2&toBlock=1',
		'export?chainId=1&dataset=unknown',
		'export?chainId=1&fromBlock=2&toBlock=1',
		'export?chainId=1&offset=9223372036854775808',
		'reorgs?chainId=1&offset=100001',
		'actions?chainId=1e2',
		'address-transactions?chainId=1e2&address=0x1111111111111111111111111111111111111111',
		'address-interactions?chainId=1e2&address=0x1111111111111111111111111111111111111111',
		'richlist?offset=-1',
		'richlist?offset=100001',
		'richlist?chainId=0x10',
		'state/universes/1/0?offset=1000001',
	]) {
		const response = await handleApi(new Request(`http://localhost/api/v1/${path}`), database)
		expect(response?.status).toBe(400)
	}
})

test('keeps every advertised PostgreSQL-bigint export offset retrievable beyond the former ceiling', async () => {
	expect(nextHistoricalExportOffset('10000000', 50_000, true)).toBe('10050000')
	expect(nextHistoricalExportOffset('10050000', 50_000, true)).toBe('10100000')
	expect(nextHistoricalExportOffset('10100000', 50_000, false)).toBeUndefined()
	expect(nextHistoricalExportOffset('9223372036854775806', 1, true)).toBe('9223372036854775807')
	expect(() => nextHistoricalExportOffset('9223372036854775807', 1, true)).toThrow('export offset exceeds the PostgreSQL bigint range')

	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	const response = await handleApi(new Request('http://localhost/api/v1/export?chainId=1&offset=10050000'), database)
	expect(response?.status).toBe(500)
})

test('validates operations catalogs and timeline identities before querying', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	for (const path of [
		'operations',
		'state/reports',
		'state/escalations',
		'state/auctions',
		'state/risk',
		'state/forks',
		'state/trading',
		'state/address-portfolio',
	]) {
		const response = await handleApi(new Request(`http://localhost/api/v1/${path}`), database)
		expect(response?.status).toBe(400)
		expect(await response?.json()).toEqual({ error: 'chainId is required' })
	}
	for (const path of ['state/timeline/not-a-chain/report/id', 'state/timeline/1/INVALID/id', 'state/timeline/1/report']) {
		const response = await handleApi(new Request(`http://localhost/api/v1/${path}`), database)
		expect(response?.status).toBe(400)
		expect(await response?.json()).toEqual({ error: 'Invalid timeline identifier' })
	}
	for (const path of [
		'state/reports/1/0x1234/7',
		'state/reports/1/0x1111111111111111111111111111111111111111/not-decimal',
		'state/escalations/1/0x1234',
		'state/auctions/1/0x1234',
		'state/trading/1/0x1234',
		'state/risk/pools/1/0x1234',
		'state/risk/vaults/1/0x1111111111111111111111111111111111111111/0x1234',
		'state/forks/1/',
	]) {
		const response = await handleApi(new Request(`http://localhost/api/v1/${path}`), database)
		expect(response?.status).toBe(400)
	}
})

test('requires a complete network and address for account transactions', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	for (const path of [
		'address-transactions?address=0x1111111111111111111111111111111111111111',
		'address-transactions?chainId=1',
		'address-transactions?chainId=1&address=0x1234',
		'address-identity?address=0x1111111111111111111111111111111111111111',
		'address-identity?chainId=1',
		'address-interactions?address=0x1111111111111111111111111111111111111111',
		'address-interactions?chainId=1',
	]) {
		const response = await handleApi(new Request(`http://localhost/api/v1/${path}`), database)
		expect(response?.status).toBe(400)
	}
	for (const cursor of ['not-base64', btoa(JSON.stringify([1, 2, 3])), btoa(JSON.stringify(['3', 2, '4', 1]))]) {
		const response = await handleApi(
			new Request(
				`http://localhost/api/v1/address-transactions?chainId=1&address=0x1111111111111111111111111111111111111111&cursor=${encodeURIComponent(cursor)}`,
			),
			database,
		)
		expect(response?.status).toBe(400)
		expect(await response?.json()).toEqual({ error: 'cursor is invalid' })
	}
	const cursor = btoa(JSON.stringify([1, '0x1111111111111111111111111111111111111111', '3', `0x${'a'.repeat(64)}`, 2, '2', 1]))
	for (const request of [
		`chainId=2&address=0x1111111111111111111111111111111111111111&cursor=${encodeURIComponent(cursor)}`,
		`chainId=1&address=0x2222222222222222222222222222222222222222&cursor=${encodeURIComponent(cursor)}`,
	]) {
		const response = await handleApi(new Request(`http://localhost/api/v1/address-transactions?${request}`), database)
		expect(response?.status).toBe(400)
		expect(await response?.json()).toEqual({ error: 'cursor does not match the requested account' })
	}
})

test('rejects unsupported rich-list ordering before querying', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	const response = await handleApi(new Request('http://localhost/api/v1/richlist?sort=private-key'), database)
	expect(response?.status).toBe(400)
	expect(await response?.json()).toEqual({ error: 'sort must be eth, weth, or transactions' })
})

test('rejects empty state chain identifiers before querying', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	const address = `0x${'1'.repeat(40)}`
	const response = await handleApi(new Request(`http://localhost/api/v1/state/pools//${address}`), database)
	expect(response?.status).toBe(400)
	expect(await response?.json()).toEqual({ error: 'Invalid state identifier' })
})

test('rejects malformed cursor timestamps and numeric positions before querying', async () => {
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused', { connectionTimeout: 1 })
	databases.push(database)
	const blockHash = `0x${'1'.repeat(64)}`
	for (const cursor of [
		['not-a-timestamp', 1, 2, 3, 4, blockHash],
		['0000-01-01T00:00:00.000Z', 1, 2, 3, 4, blockHash],
		['2026-02-30T00:00:00.000Z', 1, 2, 3, 4, blockHash],
		['2026-01-01T00:00:00.000Z', 1.5, 2, 3, 4, blockHash],
		['2026-01-01T00:00:00.000Z', 1, -2, 3, 4, blockHash],
		['2026-01-01T00:00:00.000Z', 1, Number.MAX_SAFE_INTEGER + 1, 3, 4, blockHash],
		['2026-01-01T00:00:00.000Z', 1, 2, 2_147_483_648, 4, blockHash],
		['2026-01-01T00:00:00.000Z', 1, 2, 3, 2_147_483_648, blockHash],
		['2026-01-01T00:00:00.000Z', 1, 2, 3, 4, 'not-a-hash'],
	]) {
		const encoded = encodeURIComponent(btoa(JSON.stringify(cursor)))
		const response = await handleApi(new Request(`http://localhost/api/v1/logs?cursor=${encoded}`), database)
		expect(response?.status).toBe(400)
		expect(await response?.json()).toEqual({ error: 'cursor is invalid' })
	}
})

test('round-trips a server cursor with a bigint-range chain ID', () => {
	const timestamp = new Date('2026-01-01T00:00:00.000Z')
	const blockHash = `0x${'1'.repeat(64)}`
	const cursor = cursorFor({ block_timestamp: timestamp, chain_id: 2_147_483_648, block_number: 2, transaction_index: 3, log_index: 4, block_hash: blockHash })
	expect(parseCursor(cursor)).toEqual([timestamp.toISOString(), 2_147_483_648, 2, 3, 4, blockHash])
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

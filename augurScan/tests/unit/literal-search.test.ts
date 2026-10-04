import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { logListRows } from '../../src/repositories/logs.ts'
import { timelineCatalogRows } from '../../src/repositories/timeline.ts'
import { tradingCatalogRows } from '../../src/repositories/trading-catalog.ts'

// Capture only the database call boundary so the real repositories build each query.
function captureQueries() {
	const bindings: unknown[][] = []
	const database = new SQL('postgres://user:unused@127.0.0.1:1/unused')
	const sql = new Proxy(database, {
		apply(_target, _receiver, argumentsList) {
			bindings.push(argumentsList.slice(1))
			return Promise.resolve([])
		},
		get(target, property, receiver) {
			if (property === 'unsafe')
				return (_query: string, values: unknown[]) => {
					bindings.push(values)
					return Promise.resolve([])
				}
			return Reflect.get(target, property, receiver)
		},
	})
	return { bindings, database, sql }
}

const search = String.raw`50%_\off`
const escaped = String.raw`%50\%\_\\off%`

test('trading catalog treats wildcard characters as literal search text', async () => {
	const { bindings, database, sql } = captureQueries()
	try {
		await tradingCatalogRows(sql, { chainId: 1, asOfBlock: '100', limit: 10, offset: 0, search })
		expect(bindings.flat().filter(value => value === escaped)).toHaveLength(3)
	} finally {
		await database.close()
	}
})

test('timeline rows and total counts use the same literal search pattern', async () => {
	const { bindings, database, sql } = captureQueries()
	try {
		await timelineCatalogRows(sql, { chainId: 1, query: search, canonical: 'canonical', fromBlock: '0', toBlock: '100', asOfBlock: '100', limit: 10, cursor: { block: '101', log: 0, tx: '', blockHash: '', entityType: '', identity: '' } })
		expect(bindings).toHaveLength(2)
		for (const values of bindings) expect(values.filter(value => value === escaped)).toHaveLength(4)
	} finally {
		await database.close()
	}
})

test('log event search escapes wildcard characters before binding', async () => {
	const { bindings, database, sql } = captureQueries()
	try {
		await logListRows(sql, { chainId: 1, event: search, address: null, decoded: null, canonical: 'canonical', limit: 10 })
		expect(bindings.flat()).toContain(escaped)
	} finally {
		await database.close()
	}
})

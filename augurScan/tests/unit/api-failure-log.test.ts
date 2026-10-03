import { expect, test } from 'bun:test'
import { SQL } from 'bun'
import { apiFailureLog } from '../../src/api-failure-log.ts'

test('API failures identify the route, chain, elapsed time and PostgreSQL SQLSTATE without sensitive details', () => {
	const error = new SQL.PostgresError('sensitive database error', { code: 'ERR_POSTGRES_TRANSACTION_TIMEOUT', errno: '25P04' })
	const record = JSON.parse(apiFailureLog(new Request('https://example.invalid/api/v1/state/integrity?chainId=1&cursor=secret'), error, performance.now() - 8000, 'transaction'))
	expect(record).toMatchObject({ event: 'augurScan API transaction failed', route: '/api/v1/state/integrity', chainId: '1', error: 'PostgresError', postgresCode: '25P04' })
	expect(record.elapsedMs).toBeGreaterThanOrEqual(8000)
	expect(JSON.stringify(record)).not.toContain('secret')
	expect(JSON.stringify(record)).not.toContain('sensitive')
})

test('API failure logs normalize unknown routes and reject arbitrary SQLSTATE and chain values', () => {
	const record = JSON.parse(apiFailureLog(new Request('https://example.invalid/api/private-secret?chainId=secret'), { errno: 'secret' }, performance.now(), 'request'))
	expect(record.route).toBe('/api/*')
	expect(record.postgresCode).toBeUndefined()
	expect(record.chainId).toBeUndefined()
	expect(JSON.stringify(record)).not.toContain('secret')
})

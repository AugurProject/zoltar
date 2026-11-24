import { expect, test } from 'bun:test'
import { createOperationsData } from '../../browser/operations-data.ts'
import { operationRecords } from '../../browser/api-validation.ts'
import { isPlainRecord } from '@zoltar/core-shared/validation/guards'

const blockHash = `0x${'11'.repeat(32)}`
const asOf = { blockNumber: '100', blockHash, blockTimestamp: '1000', indexedHead: '100', invalidationId: '0', abiSourceHash: 'abi', applicationSourceHash: 'app', projectionSourceHash: 'projection', phase: 'live', historical: false }

test('collects older market activity independently from lifecycle evidence', async () => {
	const requests: URL[] = []
	const data = createOperationsData(
		async path => {
			const url = new URL(path, 'http://localhost')
			requests.push(url)
			const offset = Number(url.searchParams.get('activityCursor') ?? 0)
			const limit = Number(url.searchParams.get('activityLimit') ?? 50)
			const end = Math.min(150, offset + limit)
			return {
				chainId: 1,
				asOf,
				data: {
					events: { items: [{ block_hash: blockHash, tx_hash: 'evidence', log_index: 0 }], hasMore: false },
					activity: { items: Array.from({ length: end - offset }, (_, index) => ({ block_hash: blockHash, tx_hash: `trade-${offset + index}`, log_index: offset + index })), hasMore: end < 150, ...(end < 150 ? { nextCursor: String(end) } : {}) },
				},
			}
		},
		() => '1',
		() => new URL('http://localhost/operations/trading/market'),
	)
	const response = await data.loadOperationsDetail({ kind: 'trading', identity: ['0x1111111111111111111111111111111111111111'] }, 0, 0, 0, 150)
	const activity = response.data['activity']
	if (!isPlainRecord(activity)) throw new Error('Activity page missing')
	expect(operationRecords(activity['items']).map(row => row['tx_hash'])).toEqual(Array.from({ length: 150 }, (_, index) => `trade-${index}`))
	const events = response.data['events']
	if (!isPlainRecord(events)) throw new Error('Lifecycle evidence missing')
	expect(operationRecords(events['items']).map(row => row['tx_hash'])).toEqual(['evidence'])
	expect(activity['hasMore']).toBe(false)
	expect(requests.some(url => url.searchParams.has('activityCursor'))).toBe(true)
})

test.each(['report', 'trading'] as const)('loads both %s collections from one initial snapshot', async kind => {
	const primary = kind === 'report' ? 'rounds' : 'events'
	const secondary = kind === 'report' ? 'coordinatorDecisions' : 'activity'
	let requests = 0
	const data = createOperationsData(
		async () => {
			requests++
			return {
				chainId: 1,
				asOf: { ...asOf, blockNumber: String(99 + requests) },
				data: {
					[primary]: { items: [{ tx_hash: 'primary' }], hasMore: false },
					[secondary]: { items: [{ tx_hash: 'secondary' }], hasMore: false },
				},
			}
		},
		() => '1',
		() => new URL('http://localhost/operations'),
	)
	const response = await data.loadOperationsDetail({ kind, identity: [] }, 0)
	expect(response.data).toMatchObject({
		[primary]: { items: [{ tx_hash: 'primary' }] },
		[secondary]: { items: [{ tx_hash: 'secondary' }] },
	})
	expect(requests).toBe(1)
})

test('rejects a cyclic continuation before requesting the same cursor again', async () => {
	const { collectCanonicalPages } = await import('../../browser/canonical-pagination.ts')
	const requested: Array<string | undefined> = []
	await expect(
		collectCanonicalPages(
			async cursor => {
				requested.push(cursor)
				if (requested.length > 3) throw new Error('Fixture request ceiling')
				return { items: ['same'], nextCursor: cursor === 'A' ? 'B' : 'A' }
			},
			2,
			value => value,
		),
	).rejects.toThrow('Canonical page cursor did not advance')
	expect(requested).toEqual([undefined, 'A', 'B'])
})

test('deduplicates overlapping pages with one key lookup per fetched row', async () => {
	const { collectCanonicalPages } = await import('../../browser/canonical-pagination.ts')
	let keyCalls = 0
	const result = await collectCanonicalPages<number, number>(
		async (cursor = 0, limit = 100) => {
			if (limit === 1) return { items: [cursor + 1] }
			const items = Array.from({ length: limit }, (_, index) => index + cursor)
			const nextCursor = cursor + limit - 1
			return { items, ...(nextCursor >= 1049 ? {} : { nextCursor }) }
		},
		1050,
		value => {
			keyCalls++
			return String(value)
		},
	)
	expect(result.items).toEqual(Array.from({ length: 1050 }, (_, index) => index))
	expect(keyCalls).toBeLessThan(1070)
})

import { expect, test } from 'bun:test'
import { createOperationsData } from '../../browser/operations-data.ts'
import { operationRecords, isRecord } from '../../browser/api-validation.ts'

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
	if (!isRecord(activity)) throw new Error('Activity page missing')
	expect(operationRecords(activity['items'])).toHaveLength(150)
	expect(activity['hasMore']).toBe(false)
	expect(requests.some(url => url.searchParams.has('activityCursor'))).toBe(true)
})

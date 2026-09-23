import { expect, test } from 'bun:test'
import { sparklineBuckets } from '../../browser/operations-sparkline.ts'

test('buckets uneven transitions by their timestamps', () => {
	const { points, range } = sparklineBuckets([{ block_timestamp: '2026-01-01T12:00:00Z' }, { block_timestamp: '2026-01-01T12:01:00Z' }, { block_timestamp: '2026-01-01T13:00:00Z' }])
	expect(points.map(point => point.y)).toEqual([2, 0, 0, 0, 0, 0, 0, 0, 0, 1])
	expect(range).toEqual(['2026-01-01T12:00:00.000Z', '2026-01-01T13:00:00.000Z'])
})

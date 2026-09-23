import type { JsonRecord } from './api-validation.ts'

export const sparklineBuckets = (records: readonly JsonRecord[]): { points: { x: number; y: number }[]; range?: readonly [string, string] } => {
	const times = records.flatMap(record => {
		const value = record['block_timestamp']
		if (typeof value !== 'string') return []
		const time = Date.parse(value)
		return Number.isFinite(time) ? [time] : []
	})
	const points = Array.from({ length: 10 }, (_, x) => ({ x, y: 0 }))
	if (times.length === 0) return { points }
	const first = Math.min(...times)
	const last = Math.max(...times)
	for (const time of times) {
		const index = first === last ? points.length - 1 : Math.min(points.length - 1, Math.floor(((time - first) / (last - first)) * points.length))
		const point = points[index]
		if (point !== undefined) point.y++
	}
	return { points, range: [new Date(first).toISOString(), new Date(last).toISOString()] }
}

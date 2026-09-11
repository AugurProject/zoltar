import { describe, expect, test } from 'bun:test'
import { resetReportScanState } from '../../src/runtime/operator-execution-state.ts'

describe('queued operator execution settings', () => {
	test('clears every derived report view for a complete report-window rebuild', () => {
		const reports = new Map([[1n, { reportId: 1n }]])
		const state: {
			activeReportCount: number
			marketConsensus?: unknown
			marketObservations?: unknown[]
			opportunities: unknown[]
			reportPaths: unknown[]
			status: 'running' | 'syncing'
			tokenMarkets: unknown[]
		} = {
			activeReportCount: 1,
			marketConsensus: { reliable: true },
			marketObservations: [{ sourceId: 'source-a' }],
			opportunities: [{ reportId: '1' }],
			reportPaths: [{ reportId: '1' }],
			status: 'running',
			tokenMarkets: [{ token: 'REP' }],
		}
		const reset = resetReportScanState<{ blockNumber: bigint }>(state, reports)
		expect(reset).toEqual({ cachedLogs: [], cursor: undefined })
		expect(reports.size).toBe(0)
		expect(state).toEqual({
			activeReportCount: 0,
			marketConsensus: undefined,
			marketObservations: [],
			opportunities: [],
			reportPaths: [],
			status: 'syncing',
			tokenMarkets: [],
		})
	})
})

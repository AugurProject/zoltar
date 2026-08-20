import { describe, expect, test } from 'bun:test'
import { applyCentralizedMarketSettings, applyLookbackBlockSetting, resetReportScanState } from '../../src/runtime/operator-execution-state.ts'

describe('queued operator execution settings', () => {
	test('removes old-source evidence before a replacement source can authorize execution', () => {
		const config = { centralizedMarkets: { sources: ['source-a'] } }
		const state: { marketConsensus: unknown; marketObservations: unknown[] } = {
			marketConsensus: { reliable: true, sourceIds: ['source-a'] },
			marketObservations: [{ sourceId: 'source-a' }],
		}
		applyCentralizedMarketSettings(config, state, { sources: ['source-b'] })
		expect(config.centralizedMarkets).toEqual({ sources: ['source-b'] })
		expect(state).toEqual({ marketConsensus: undefined, marketObservations: [] })
	})

	test('requests a complete report-window rebuild when the bounded lookback expands', () => {
		const config = { lookbackBlocks: 16n }
		expect(applyLookbackBlockSetting(config, 256n)).toBe(true)
		expect(config.lookbackBlocks).toBe(256n)
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
		expect(applyLookbackBlockSetting(config, 256n)).toBe(false)
	})
})

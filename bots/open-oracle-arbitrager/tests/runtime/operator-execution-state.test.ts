import { describe, expect, test } from 'bun:test'
import { applyCentralizedMarketSettings, applyLookbackBlockSetting } from '../../src/runtime/operator-execution-state.ts'

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
		expect(applyLookbackBlockSetting(config, 256n)).toBe(false)
	})
})

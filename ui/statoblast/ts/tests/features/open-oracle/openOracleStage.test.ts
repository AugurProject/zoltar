/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getOpenOracleStagePresentation } from '@zoltar/ui-statoblast-shared/features/open-oracle/lib/openOracleStage.js'

describe('open oracle stage presentation', () => {
	test('marks the price expired at equality and preserves delayed-settlement context', () => {
		const report = { currentBlockNumber: 1n, currentTime: 460n, disputeDelay: 10n, reportTimestamp: 100n, timeType: true, coordinatorPriceValidUntilTimestamp: 460n, settlementTimestamp: 0n }
		expect(getOpenOracleStagePresentation('settle', { ...report, currentTime: 459n }).label).toBe('Ready to settle')
		expect(getOpenOracleStagePresentation('settle', report)).toMatchObject({ label: 'Price expired', tone: 'warning' })
		expect(getOpenOracleStagePresentation('read-only', { ...report, settlementTimestamp: 460n })).toMatchObject({ label: 'Settled after price expired', tone: 'warning' })
		expect(getOpenOracleStagePresentation('read-only', { ...report, settlementTimestamp: 459n })).toMatchObject({ label: 'Price expired', tone: 'warning' })
		expect(getOpenOracleStagePresentation('settle', { ...report, coordinatorPriceValidUntilTimestamp: undefined }).label).toBe('Ready to settle')
	})

	test('maps every action mode to its lifecycle presentation', () => {
		expect(getOpenOracleStagePresentation('dispute')).toEqual({
			availableActions: [],
			blockedActions: [],
			key: 'dispute-window',
			label: 'Dispute window open',
			tone: 'default',
		})

		expect(getOpenOracleStagePresentation('settle')).toEqual({
			availableActions: [],
			blockedActions: [],
			key: 'ready-to-settle',
			label: 'Ready to settle',
			tone: 'success',
		})

		expect(getOpenOracleStagePresentation('read-only')).toEqual({
			availableActions: [],
			blockedActions: [],
			key: 'settled',
			label: 'Settled',
			tone: 'success',
		})
	})

	test('keeps the dispute stage pending until its actual opening time', () => {
		expect(
			getOpenOracleStagePresentation('dispute', {
				currentBlockNumber: 1n,
				currentTime: 120n,
				disputeDelay: 60n,
				reportTimestamp: 100n,
				timeType: true,
			}),
		).toEqual({
			availableActions: [],
			blockedActions: [],
			detail: 'Disputes open in less than a minute.',
			key: 'dispute-pending',
			label: 'Waiting for dispute window',
			tone: 'warning',
		})
	})

	test('uses the block clock before and at the dispute boundary', () => {
		const blockClockReport = {
			currentBlockNumber: 12n,
			currentTime: 999n,
			disputeDelay: 3n,
			reportTimestamp: 10n,
			timeType: false,
		}
		expect(getOpenOracleStagePresentation('dispute', blockClockReport)).toEqual({
			availableActions: [],
			blockedActions: [],
			detail: 'Disputes open in 1 block.',
			key: 'dispute-pending',
			label: 'Waiting for dispute window',
			tone: 'warning',
		})
		expect(getOpenOracleStagePresentation('dispute', { ...blockClockReport, currentBlockNumber: 13n })).toEqual({
			availableActions: [],
			blockedActions: [],
			key: 'dispute-window',
			label: 'Dispute window open',
			tone: 'default',
		})
	})
})

/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getOpenOracleStagePresentation } from '../../../features/open-oracle/lib/openOracleStage.js'

describe('open oracle stage presentation', () => {
	test('maps every action mode to its lifecycle presentation', () => {
		expect(getOpenOracleStagePresentation('dispute')).toEqual({
			availableActions: [],
			blockedActions: [],
			key: 'dispute-window',
			label: 'Dispute Window Open',
			tone: 'default',
		})

		expect(getOpenOracleStagePresentation('settle')).toEqual({
			availableActions: [],
			blockedActions: [],
			key: 'ready-to-settle',
			label: 'Ready To Settle',
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
			label: 'Waiting For Dispute Window',
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
			label: 'Waiting For Dispute Window',
			tone: 'warning',
		})
		expect(getOpenOracleStagePresentation('dispute', { ...blockClockReport, currentBlockNumber: 13n })).toEqual({
			availableActions: [],
			blockedActions: [],
			key: 'dispute-window',
			label: 'Dispute Window Open',
			tone: 'default',
		})
	})
})

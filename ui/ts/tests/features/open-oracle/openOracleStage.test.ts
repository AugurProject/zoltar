/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getOpenOracleStagePresentation } from '../../../features/open-oracle/lib/openOracleStage.js'

describe('open oracle stage presentation', () => {
	test('maps every action mode to its lifecycle presentation', () => {
		expect(getOpenOracleStagePresentation('initial-report')).toEqual({
			availableActions: [],
			blockedActions: [],
			key: 'awaiting-initial-report',
			label: 'Awaiting Initial Report',
			tone: 'warning',
		})

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
})

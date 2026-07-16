/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getOpenOracleStagePresentation } from '../../../features/open-oracle/lib/openOracleStage.js'

describe('open oracle stage presentation', () => {
	test('maps every action mode to its lifecycle presentation', () => {
		expect(getOpenOracleStagePresentation('initial-report')).toEqual({
			availableActions: [],
			blockedActions: [],
			detail: 'This report is waiting for its first report submission.',
			key: 'awaiting-initial-report',
			label: 'Awaiting Initial Report',
			tone: 'warning',
		})

		expect(getOpenOracleStagePresentation('dispute')).toEqual({
			availableActions: [],
			blockedActions: [],
			detail: 'This report has an active lifecycle and may still be disputed.',
			key: 'dispute-window',
			label: 'Dispute Window Open',
			tone: 'default',
		})

		expect(getOpenOracleStagePresentation('settle')).toEqual({
			availableActions: [],
			blockedActions: [],
			detail: 'The dispute window has ended and this report is ready to settle.',
			key: 'ready-to-settle',
			label: 'Ready To Settle',
			tone: 'success',
		})

		expect(getOpenOracleStagePresentation('read-only')).toEqual({
			availableActions: [],
			blockedActions: [],
			detail: 'This report is already settled and no further write actions are available.',
			key: 'settled',
			label: 'Settled',
			tone: 'success',
		})
	})
})

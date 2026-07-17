/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { getOpenOracleStagePresentation } from '../../../features/open-oracle/lib/openOracleStage.js'

describe('open oracle stage presentation', () => {
	test('maps every action mode to its lifecycle presentation', () => {
		expect(getOpenOracleStagePresentation('dispute')).toEqual({
			availableActions: ['Dispute report', 'Settle when the dispute window ends'],
			blockedActions: [],
			detail: 'This report has an active lifecycle and may still be disputed.',
			key: 'dispute-window',
			label: 'Dispute Window Open',
			tone: 'default',
		})

		expect(getOpenOracleStagePresentation('settle')).toEqual({
			availableActions: ['Settle report'],
			blockedActions: ['Further disputes'],
			detail: 'The dispute window has ended and this report is ready to settle.',
			key: 'ready-to-settle',
			label: 'Ready To Settle',
			tone: 'success',
		})

		expect(getOpenOracleStagePresentation('read-only')).toEqual({
			availableActions: [],
			blockedActions: ['Dispute', 'Settle'],
			detail: 'This report can no longer be disputed or settled.',
			key: 'settled',
			label: 'Settled',
			tone: 'success',
		})
	})
})

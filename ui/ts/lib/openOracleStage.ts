import type { OpenOracleSelectedReportActionMode } from './openOracle.js'
import { assertNever } from './assert.js'
import type { LifecycleStagePresentation } from '../types/components.js'

export function getOpenOracleStagePresentation(actionMode: OpenOracleSelectedReportActionMode): LifecycleStagePresentation {
	switch (actionMode) {
		case 'initial-report':
			return {
				availableActions: ['Submit initial report'],
				blockedActions: ['Dispute', 'Settle'],
				detail: 'This report is waiting for its first report submission.',
				key: 'awaiting-initial-report',
				label: 'Awaiting Initial Report',
				tone: 'warning',
			}
		case 'dispute':
			return {
				availableActions: ['Dispute report', 'Settle when the dispute window ends'],
				blockedActions: [],
				detail: 'This report has an active lifecycle and may still be disputed.',
				key: 'dispute-window',
				label: 'Dispute Window Open',
				tone: 'default',
			}
		case 'settle':
			return {
				availableActions: ['Settle report'],
				blockedActions: ['Further disputes'],
				detail: 'The dispute window has ended and this report is ready to settle.',
				key: 'ready-to-settle',
				label: 'Ready To Settle',
				tone: 'success',
			}
		case 'read-only':
			return {
				availableActions: [],
				blockedActions: ['Initial report', 'Dispute', 'Settle'],
				detail: 'This report is already settled and no further write actions are available.',
				key: 'settled',
				label: 'Settled',
				tone: 'success',
			}
		default:
			return assertNever(actionMode)
	}
}

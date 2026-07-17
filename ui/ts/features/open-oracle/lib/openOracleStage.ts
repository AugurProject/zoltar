import type { OpenOracleSelectedReportActionMode } from './openOracle.js'
import { assertNever } from '../../../lib/assert.js'
import type { LifecycleStagePresentation } from '../../types.js'

export function getOpenOracleStagePresentation(actionMode: OpenOracleSelectedReportActionMode): LifecycleStagePresentation {
	switch (actionMode) {
		case 'dispute':
			return {
				availableActions: [],
				blockedActions: [],
				key: 'dispute-window',
				label: 'Dispute Window Open',
				tone: 'default',
			}
		case 'settle':
			return {
				availableActions: [],
				blockedActions: [],
				key: 'ready-to-settle',
				label: 'Ready To Settle',
				tone: 'success',
			}
		case 'read-only':
			return {
				availableActions: [],
				blockedActions: [],
				key: 'settled',
				label: 'Settled',
				tone: 'success',
			}
		default:
			return assertNever(actionMode)
	}
}

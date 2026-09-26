import * as openOracleCopy from '../../../copy/openOracle.js'
import type { OpenOracleSelectedReportActionMode } from './openOracle.js'
import type { ReadinessAction } from '@zoltar/ui-zoltar-shared/features/types.js'

export function getOpenOracleReadinessActions({ actionMode, disputeMessage, hasReport, settleMessage }: { actionMode: OpenOracleSelectedReportActionMode; disputeMessage: string | undefined; hasReport: boolean; settleMessage: string | undefined }): ReadinessAction[] {
	const baseBlocker = !hasReport ? 'Select a report first.' : undefined
	const actions: ReadinessAction[] = []

	if (actionMode === 'dispute') {
		const disputeBlocker = baseBlocker ?? disputeMessage
		actions.push({
			actionLabel: 'Dispute & swap',
			description: 'Challenge the current report and provide the replacement swap amounts.',
			key: 'dispute-report',
			readiness: disputeBlocker === undefined ? 'ready' : 'blocked',
			title: 'Dispute & swap',
			...(disputeBlocker === undefined ? {} : { blocker: disputeBlocker }),
		})
		const settleBlocker = baseBlocker ?? settleMessage
		actions.push({
			actionLabel: openOracleCopy.settleReport,
			key: 'settle-report',
			readiness: settleBlocker === undefined ? 'ready' : 'blocked',
			title: openOracleCopy.settleReport,
			...(settleBlocker === undefined ? {} : { blocker: settleBlocker }),
		})
	}
	if (actionMode === 'settle') {
		const settleBlocker = baseBlocker ?? settleMessage
		actions.push({
			actionLabel: openOracleCopy.settleReport,
			key: 'settle-report',
			readiness: settleBlocker === undefined ? 'ready' : 'blocked',
			title: openOracleCopy.settleReport,
			...(settleBlocker === undefined ? {} : { blocker: settleBlocker }),
		})
	}
	return actions
}

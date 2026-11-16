import * as openOracleCopy from '../../../copy/openOracle.js'
import type { OpenOracleSelectedReportActionMode } from './openOracle.js'
import type { ReadinessAction } from '@zoltar/ui-zoltar-shared/features/types.js'

function settleReportAction(blocker: string | undefined): ReadinessAction {
	return {
		actionLabel: openOracleCopy.settleReport,
		key: 'settle-report',
		readiness: blocker === undefined ? 'ready' : 'blocked',
		title: openOracleCopy.settleReport,
		...(blocker === undefined ? {} : { blocker }),
	}
}

export function getOpenOracleReadinessActions({ actionMode, disputeMessage, hasReport, settleMessage }: { actionMode: OpenOracleSelectedReportActionMode; disputeMessage: string | undefined; hasReport: boolean; settleMessage: string | undefined }): ReadinessAction[] {
	const baseBlocker = !hasReport ? openOracleCopy.reportLoadRequired : undefined
	const actions: ReadinessAction[] = []

	if (actionMode === 'dispute') {
		const disputeBlocker = baseBlocker ?? disputeMessage
		actions.push({
			actionLabel: openOracleCopy.disputeAndSwap,
			description: 'Challenge the current report and provide the replacement swap amounts.',
			key: 'dispute-report',
			readiness: disputeBlocker === undefined ? 'ready' : 'blocked',
			title: openOracleCopy.disputeAndSwap,
			...(disputeBlocker === undefined ? {} : { blocker: disputeBlocker }),
		})
		actions.push(settleReportAction(baseBlocker ?? settleMessage))
	}
	if (actionMode === 'settle') {
		actions.push(settleReportAction(baseBlocker ?? settleMessage))
	}
	return actions
}

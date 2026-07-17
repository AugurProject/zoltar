import type { OpenOracleSelectedReportActionMode } from './openOracle.js'
import type { ReadinessAction } from '../../types.js'

export function getOpenOracleReadinessActions({ actionMode, disputeMessage, hasReport, settleMessage }: { actionMode: OpenOracleSelectedReportActionMode; disputeMessage: string | undefined; hasReport: boolean; settleMessage: string | undefined }): ReadinessAction[] {
	const baseBlocker = !hasReport ? 'Load a report first.' : undefined
	const actions: ReadinessAction[] = []

	if (actionMode === 'dispute') {
		const disputeBlocker = baseBlocker ?? disputeMessage
		actions.push({
			actionLabel: 'Dispute & Swap',
			description: 'Challenge the current report and provide the replacement swap amounts.',
			key: 'dispute-report',
			readiness: disputeBlocker === undefined ? 'ready' : 'blocked',
			title: 'Dispute & Swap',
			...(disputeBlocker === undefined ? {} : { blocker: disputeBlocker }),
		})
		const settleBlocker = baseBlocker ?? settleMessage
		actions.push({
			actionLabel: 'Settle Report',
			description: 'Review settlement readiness and settle once the dispute window has closed.',
			key: 'settle-report',
			readiness: settleBlocker === undefined ? 'ready' : 'blocked',
			title: 'Settle Report',
			...(settleBlocker === undefined ? {} : { blocker: settleBlocker }),
		})
	}
	if (actionMode === 'settle') {
		const settleBlocker = baseBlocker ?? settleMessage
		actions.push({
			actionLabel: 'Settle Report',
			description: 'Confirm settlement once the report is ready.',
			key: 'settle-report',
			readiness: settleBlocker === undefined ? 'ready' : 'blocked',
			title: 'Settle Report',
			...(settleBlocker === undefined ? {} : { blocker: settleBlocker }),
		})
	}
	if (actionMode === 'read-only')
		actions.push({
			actionLabel: 'No write action',
			description: 'This report has completed its lifecycle.',
			key: 'settled-read-only',
			readiness: 'ready',
			title: 'Settled Report',
		})

	return actions
}

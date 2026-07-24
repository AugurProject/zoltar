import type { OpenOracleSelectedReportActionMode } from './openOracle.js'
import { assertNever } from '../../../lib/assert.js'
import { formatDuration } from '../../../lib/formatters.js'
import type { LifecycleStagePresentation } from '../../types.js'
import type { OpenOracleReportDetails } from '../../../types/contracts.js'

type OpenOracleStageReport = Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentTime' | 'disputeDelay' | 'reportTimestamp' | 'timeType'>

function getDisputeWindowPendingPresentation(report: OpenOracleStageReport): LifecycleStagePresentation | undefined {
	const currentClock = report.timeType ? report.currentTime : report.currentBlockNumber
	const disputeStart = report.reportTimestamp + report.disputeDelay
	if (currentClock >= disputeStart) return undefined
	const remaining = disputeStart - currentClock
	const duration = report.timeType ? formatDuration(remaining) : `${remaining.toString()} block${remaining === 1n ? '' : 's'}`
	return {
		availableActions: [],
		blockedActions: [],
		detail: `Disputes open in ${duration}.`,
		key: 'dispute-pending',
		label: 'Waiting For Dispute Window',
		tone: 'warning',
	}
}

export function getOpenOracleStagePresentation(actionMode: OpenOracleSelectedReportActionMode, report?: OpenOracleStageReport | undefined): LifecycleStagePresentation {
	switch (actionMode) {
		case 'dispute':
			if (report !== undefined) {
				const pendingPresentation = getDisputeWindowPendingPresentation(report)
				if (pendingPresentation !== undefined) return pendingPresentation
			}
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

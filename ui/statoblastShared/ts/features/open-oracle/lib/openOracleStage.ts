import type { OpenOracleSelectedReportActionMode } from './openOracle.js'
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'
import { formatDuration } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import type { LifecycleStagePresentation } from '@zoltar/ui-zoltar-shared/features/types.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import type { OpenOracleReportDetails } from '../../../types/contracts.js'

type OpenOracleStageReport = Pick<OpenOracleReportDetails, 'currentBlockNumber' | 'currentTime' | 'disputeDelay' | 'reportTimestamp' | 'timeType'> & Partial<Pick<OpenOracleReportDetails, 'coordinatorPriceValidUntilTimestamp' | 'settlementTimestamp'>>

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
		label: openOracleCopy.awaitingDisputeWindow,
		tone: 'warning',
	}
}

export function getOpenOraclePriceExpiryPresentation(report: OpenOracleStageReport): LifecycleStagePresentation | undefined {
	const expiresAt = report.coordinatorPriceValidUntilTimestamp
	if (!report.timeType || expiresAt === undefined || report.currentTime < expiresAt) return undefined
	const settled = report.settlementTimestamp !== undefined && report.settlementTimestamp > 0n
	const settledLate = settled && report.settlementTimestamp !== undefined && report.settlementTimestamp >= expiresAt
	let detail = settled ? openOracleCopy.expiredReportPrice : openOracleCopy.staleSettlementWarning
	if (settledLate) detail = openOracleCopy.staleSettledReportWarning
	return {
		availableActions: [],
		blockedActions: [],
		detail,
		key: 'price-expired',
		label: settledLate ? openOracleCopy.settledAfterPriceExpired : openOracleCopy.priceExpired,
		tone: 'warning',
	}
}

export function getOpenOracleStagePresentation(actionMode: OpenOracleSelectedReportActionMode, report?: OpenOracleStageReport | undefined): LifecycleStagePresentation {
	const priceExpiry = report === undefined ? undefined : getOpenOraclePriceExpiryPresentation(report)
	if (priceExpiry !== undefined) return priceExpiry
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
				label: openOracleCopy.disputeWindowOpen,
				tone: 'default',
			}
		case 'settle':
			return {
				availableActions: [],
				blockedActions: [],
				key: 'ready-to-settle',
				label: openOracleCopy.readyToSettle,
				tone: 'success',
			}
		case 'read-only':
			return {
				availableActions: [],
				blockedActions: [],
				key: 'settled',
				label: commonCopy.settled,
				tone: 'success',
			}
		default:
			return assertNever(actionMode)
	}
}

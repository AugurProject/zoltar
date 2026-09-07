import type { ForkAuctionStageView } from '../../../truth-auctions/lib/forkAuction.js'
import { deriveReportingStage } from '@zoltar/ui-zoltar/features/reporting/lib/reporting.js'
import type { SecurityPoolForkStage, SecurityPoolLifecycleState, SecurityPoolReportingStage } from './types.js'
import type { ReportingDetails, ReportingOutcomeKey, SecurityPoolSystemState } from '@zoltar/ui-core-shared/types/contracts.js'

export function isSecurityPoolEnded({
	hasForkActivity,
	isChildPool,
	questionOutcome,
	systemState,
	universeHasForked,
}: {
	hasForkActivity?: boolean | undefined
	isChildPool?: boolean | undefined
	questionOutcome: ReportingOutcomeKey | 'none' | undefined
	systemState: SecurityPoolSystemState | undefined
	universeHasForked?: boolean | undefined
}) {
	if (universeHasForked === true && systemState === 'operational' && isChildPool !== true) return false
	return systemState === 'operational' && hasForkActivity !== true && questionOutcome !== undefined && questionOutcome !== 'none'
}

export function deriveSecurityPoolLifecycleState({
	hasForkActivity,
	isChildPool,
	questionOutcome,
	systemState,
	universeHasForked,
}: {
	hasForkActivity?: boolean | undefined
	isChildPool?: boolean | undefined
	questionOutcome: ReportingOutcomeKey | 'none' | undefined
	systemState: SecurityPoolSystemState | undefined
	universeHasForked?: boolean | undefined
}): SecurityPoolLifecycleState | undefined {
	if (systemState === undefined) return undefined
	if (universeHasForked === true && systemState === 'operational' && isChildPool !== true) return 'poolForked'
	if (isSecurityPoolEnded({ hasForkActivity, isChildPool, questionOutcome, systemState, universeHasForked })) return 'ended'
	return systemState
}

export function deriveSecurityPoolReportingStage({ reportingDetails, reportingReady }: { reportingDetails: ReportingDetails | undefined; reportingReady: boolean | undefined }): SecurityPoolReportingStage | undefined {
	return deriveReportingStage({ reportingDetails, reportingReady })
}

export function deriveSecurityPoolForkStage({ currentStage, workflowDisabled }: { currentStage: ForkAuctionStageView | undefined; workflowDisabled: boolean | undefined }): SecurityPoolForkStage | undefined {
	if (workflowDisabled === true) return 'disabled'
	if (currentStage === undefined) return undefined
	return currentStage
}

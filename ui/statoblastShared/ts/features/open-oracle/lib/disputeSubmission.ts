import type { OpenOracleActionResult, OpenOracleReportDetails } from '../../../types/contracts.js'
import * as openOracleCopy from '../../../copy/openOracle.js'
import type { OpenOracleDisputeSubmissionDetails } from './openOracle.js'

// The proposed price picks the swapped token, so a refreshed report that flips it must be reviewed before any write.
export function assertDisputeSwapTokenUnchanged(reviewed: OpenOracleDisputeSubmissionDetails, refreshed: OpenOracleDisputeSubmissionDetails, reportDetails: OpenOracleReportDetails) {
	if (reviewed.swapTokenKey === undefined || refreshed.swapTokenKey === undefined || reviewed.swapTokenKey === refreshed.swapTokenKey) return
	const symbolOf = (token: 'token1' | 'token2') => (token === 'token1' ? reportDetails.token1Symbol : reportDetails.token2Symbol)
	throw new Error(openOracleCopy.formatDisputeSwapTokenChanged(symbolOf(refreshed.swapTokenKey), symbolOf(reviewed.swapTokenKey)))
}

type PreparedDispute = {
	details: OpenOracleReportDetails
	tokenToSwap: OpenOracleReportDetails['token1']
	newAmount1: bigint
	newAmount2: bigint
}

type DisputePreparation = {
	cachedReport: OpenOracleReportDetails | undefined
	getSubmission: (details: OpenOracleReportDetails) => OpenOracleDisputeSubmissionDetails
	reloadReport: () => Promise<{ details: OpenOracleReportDetails }>
	refreshTokenAccess: (details: OpenOracleReportDetails) => Promise<void>
	assertSelectedReportCurrent: (reportIdInput: string) => void
	submit: (dispute: PreparedDispute) => Promise<OpenOracleActionResult>
}

export async function submitPreparedDispute({ cachedReport, getSubmission, reloadReport, refreshTokenAccess, assertSelectedReportCurrent, submit }: DisputePreparation) {
	const cachedSubmission = cachedReport === undefined ? undefined : getSubmission(cachedReport)
	const { details } = await reloadReport()
	const inputPreflight = getSubmission(details)
	if (inputPreflight.inputBlockMessage !== undefined) throw new Error(inputPreflight.inputBlockMessage.message)
	if (cachedSubmission !== undefined) assertDisputeSwapTokenUnchanged(cachedSubmission, inputPreflight, details)

	await refreshTokenAccess(details)
	assertSelectedReportCurrent(details.reportId.toString())
	const { canSubmit, blockMessage, newAmount1, newAmount2, swapTokenKey } = getSubmission(details)
	if (!canSubmit || newAmount1 === undefined || newAmount2 === undefined || swapTokenKey === undefined) throw new Error(blockMessage?.message ?? 'Invalid dispute submission details.')
	const tokenToSwap = swapTokenKey === 'token1' ? details.token1 : details.token2
	// Begin the write in the same turn as the selection check.
	return await submit({ details, tokenToSwap, newAmount1, newAmount2 })
}

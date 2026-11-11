import * as reportingCopy from '../../../copy/reporting.js'
import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/transactions/actionGuards.js'
import { formatAdditionalCurrencyBalance, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js'

type ReportingStatus = 'missing' | 'not-started' | 'active'

export function getReportingReportGuardMessage({
	actualDepositAmount,
	accountAddress,
	contributionPreviewReason,
	isOnActiveAppChain,
	remainingSelectedOutcomeCapacity,
	reportAmount,
	reportingStatus,
	selectedOutcome,
	selectedAmount,
	requireAllowance = true,
	walletDepositAmount = actualDepositAmount,
	viewerWalletRepAllowanceAttoRep,
	viewerWalletRepBalanceAttoRep,
}: {
	actualDepositAmount: bigint | undefined
	accountAddress: Address | undefined
	contributionPreviewReason: string | undefined
	isOnActiveAppChain: boolean
	remainingSelectedOutcomeCapacity: bigint | undefined
	reportAmount: string
	reportingStatus: ReportingStatus
	selectedOutcome: ReportingOutcomeKey | undefined
	selectedAmount: bigint | undefined
	requireAllowance?: boolean | undefined
	walletDepositAmount?: bigint | undefined
	viewerWalletRepAllowanceAttoRep?: bigint | undefined
	viewerWalletRepBalanceAttoRep?: bigint | undefined
}) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: commonCopy.formatConnectWalletBefore('reporting on a question') })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (reportingStatus === 'missing') return reportingCopy.loadingReportingDetails
	if (selectedOutcome === undefined) return reportingCopy.reportOutcomeSelectionRequired
	if (reportAmount.trim() === '' || selectedAmount === undefined || selectedAmount <= 0n) return reportingCopy.reportAmountRequired
	if (contributionPreviewReason !== undefined) return contributionPreviewReason
	if (actualDepositAmount === undefined) return 'Unable to preview the REP that would become dispute-staked for this report.'
	if (remainingSelectedOutcomeCapacity !== undefined && actualDepositAmount > remainingSelectedOutcomeCapacity) {
		if (remainingSelectedOutcomeCapacity === 0n) return reportingCopy.selectedSideCapacityEmpty
		return `Only ${formatCurrencyBalanceWithUnit(remainingSelectedOutcomeCapacity, 'REP')} remains before the selected side reaches the non-decision threshold.`
	}
	if (walletDepositAmount === undefined || viewerWalletRepBalanceAttoRep === undefined) return reportingCopy.loadingWalletRepBalance
	if (walletDepositAmount > viewerWalletRepBalanceAttoRep) return `Add ${formatAdditionalCurrencyBalance(walletDepositAmount - viewerWalletRepBalanceAttoRep, 'REP')} to this wallet before reporting.`
	if (!requireAllowance) return undefined
	if (viewerWalletRepAllowanceAttoRep === undefined) return 'Loading REP allowance for the question…'
	if (walletDepositAmount > viewerWalletRepAllowanceAttoRep) return reportingCopy.reportingRepApprovalRequired
	return undefined
}

export function getReportingWithdrawGuardMessage({ accountAddress, isOnActiveAppChain, reportingStatus }: { accountAddress: Address | undefined; isOnActiveAppChain: boolean; reportingStatus: ReportingStatus }) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: commonCopy.formatConnectWalletBefore('settling escalation deposits') })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (reportingStatus === 'missing') return reportingCopy.loadingReportingDetails
	return undefined
}

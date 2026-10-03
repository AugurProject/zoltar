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
	contributionFunding,
	contributionPreviewReason,
	isOnActiveAppChain,
	remainingSelectedOutcomeCapacity,
	reportAmount,
	reportingStatus,
	selectedOutcome,
	selectedAmount,
	requireAllowance = true,
	walletFundingAvailable = false,
	walletDepositAmount = actualDepositAmount,
	viewerPoolHeldVaultRepBackingAttoRep,
	viewerVaultExists,
	viewerWalletRepAllowanceAttoRep,
	viewerWalletRepBalanceAttoRep,
}: {
	actualDepositAmount: bigint | undefined
	accountAddress: Address | undefined
	contributionFunding?: 'vault' | 'wallet' | undefined
	contributionPreviewReason: string | undefined
	isOnActiveAppChain: boolean
	remainingSelectedOutcomeCapacity: bigint | undefined
	reportAmount: string
	reportingStatus: ReportingStatus
	selectedOutcome: ReportingOutcomeKey | undefined
	selectedAmount: bigint | undefined
	requireAllowance?: boolean | undefined
	walletFundingAvailable?: boolean | undefined
	walletDepositAmount?: bigint | undefined
	viewerPoolHeldVaultRepBackingAttoRep: bigint | undefined
	viewerVaultExists: boolean
	viewerWalletRepAllowanceAttoRep?: bigint | undefined
	viewerWalletRepBalanceAttoRep?: bigint | undefined
}) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: commonCopy.formatConnectWalletBefore('reporting on a question') })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (reportingStatus === 'missing') return 'Loading reporting details.'
	if (selectedOutcome === undefined) return reportingCopy.reportOutcomeSelectionRequired
	if (reportAmount.trim() === '') return undefined
	if (selectedAmount === undefined || selectedAmount <= 0n) return undefined
	if (contributionPreviewReason !== undefined) return contributionPreviewReason
	if (actualDepositAmount === undefined) return 'Unable to preview the REP that would become dispute-staked for this report.'
	if (remainingSelectedOutcomeCapacity !== undefined && actualDepositAmount > remainingSelectedOutcomeCapacity) {
		if (remainingSelectedOutcomeCapacity === 0n) return 'No remaining contribution capacity is available on the selected side.'
		return `Only ${formatCurrencyBalanceWithUnit(remainingSelectedOutcomeCapacity, 'REP')} remains before the selected side reaches the threshold.`
	}
	if (contributionFunding === 'wallet') {
		if (walletDepositAmount === undefined) return 'Loading vault funding requirements.'
		if (viewerWalletRepBalanceAttoRep === undefined) return 'Loading wallet REP balance.'
		if (walletDepositAmount > viewerWalletRepBalanceAttoRep) return `Add ${formatAdditionalCurrencyBalance(walletDepositAmount - viewerWalletRepBalanceAttoRep, 'REP')} to this wallet before reporting.`
		if (!requireAllowance) return undefined
		if (viewerWalletRepAllowanceAttoRep === undefined) return 'Loading REP allowance for the security pool.'
		if (walletDepositAmount > viewerWalletRepAllowanceAttoRep) return reportingCopy.reportingRepApprovalRequired
		return undefined
	}
	if (walletFundingAvailable && (!viewerVaultExists || (viewerPoolHeldVaultRepBackingAttoRep ?? 1n) === 0n)) return reportingCopy.noVaultRepSelectWallet
	if (walletFundingAvailable && viewerPoolHeldVaultRepBackingAttoRep !== undefined && actualDepositAmount > viewerPoolHeldVaultRepBackingAttoRep) return reportingCopy.insufficientVaultRepSelectWallet(formatCurrencyBalanceWithUnit(viewerPoolHeldVaultRepBackingAttoRep, 'REP'))
	if (!viewerVaultExists) return 'This contribution uses pool-held REP backing. Deposit REP into your vault before reporting.'
	if (viewerPoolHeldVaultRepBackingAttoRep === undefined) return 'Loading pool-held vault REP backing.'
	if (actualDepositAmount > viewerPoolHeldVaultRepBackingAttoRep) return `Deposit ${formatAdditionalCurrencyBalance(actualDepositAmount - viewerPoolHeldVaultRepBackingAttoRep, 'REP')} into your vault's pool-held backing before reporting.`
	return undefined
}

export function getReportingWithdrawGuardMessage({ accountAddress, isOnActiveAppChain, reportingStatus }: { accountAddress: Address | undefined; isOnActiveAppChain: boolean; reportingStatus: ReportingStatus }) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: commonCopy.formatConnectWalletBefore('settling escalation deposits') })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (reportingStatus === 'missing') return 'Loading reporting details.'
	return undefined
}

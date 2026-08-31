import type { Address } from '@zoltar/shared/ethereum'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/lib/actionGuards.js'
import { formatAdditionalCurrencyBalance, formatCurrencyBalanceWithUnit } from '@zoltar/ui-core-shared/lib/formatters.js'

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
	viewerPoolHeldVaultRepBackingAttoRep: bigint | undefined
	viewerVaultExists: boolean
	viewerWalletRepAllowanceAttoRep?: bigint | undefined
	viewerWalletRepBalanceAttoRep?: bigint | undefined
}) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before reporting on a question.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (reportingStatus === 'missing') return 'Loading reporting details.'
	if (selectedOutcome === undefined) return 'Select an outcome side before reporting on a question.'
	if (reportAmount.trim() === '') return 'Enter a report amount greater than zero.'
	if (selectedAmount === undefined || selectedAmount <= 0n) return 'Enter a valid report amount greater than zero.'
	if (contributionPreviewReason !== undefined) return contributionPreviewReason
	if (actualDepositAmount === undefined) return 'Unable to preview the REP that would become dispute-staked for this report.'
	if (remainingSelectedOutcomeCapacity !== undefined && actualDepositAmount > remainingSelectedOutcomeCapacity) {
		if (remainingSelectedOutcomeCapacity === 0n) return 'No remaining contribution capacity is available on the selected side.'
		return `Only ${formatCurrencyBalanceWithUnit(remainingSelectedOutcomeCapacity, 'REP')} remains before the selected side reaches the threshold.`
	}
	if (contributionFunding === 'wallet') {
		if (viewerWalletRepBalanceAttoRep === undefined) return 'Loading wallet REP balance.'
		if (actualDepositAmount > viewerWalletRepBalanceAttoRep) return `Add ${formatAdditionalCurrencyBalance(actualDepositAmount - viewerWalletRepBalanceAttoRep, 'REP')} to this wallet before reporting.`
		if (!requireAllowance) return undefined
		if (viewerWalletRepAllowanceAttoRep === undefined) return 'Loading escalation-game REP allowance.'
		if (actualDepositAmount > viewerWalletRepAllowanceAttoRep) return 'Approve REP for this escalation game before reporting.'
		return undefined
	}
	if (!viewerVaultExists) return 'This contribution uses pool-held REP backing. Deposit REP into your vault before reporting.'
	if (viewerPoolHeldVaultRepBackingAttoRep === undefined) return 'Loading pool-held vault REP backing.'
	if (actualDepositAmount > viewerPoolHeldVaultRepBackingAttoRep) return `Deposit ${formatAdditionalCurrencyBalance(actualDepositAmount - viewerPoolHeldVaultRepBackingAttoRep, 'REP')} into your vault's pool-held backing before reporting.`
	return undefined
}

export function getReportingWithdrawGuardMessage({ accountAddress, isOnActiveAppChain, reportingStatus }: { accountAddress: Address | undefined; isOnActiveAppChain: boolean; reportingStatus: ReportingStatus }) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before settling escalation deposits.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (reportingStatus === 'missing') return 'Loading reporting details.'
	return undefined
}

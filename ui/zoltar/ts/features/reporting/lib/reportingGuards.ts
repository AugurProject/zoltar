import type { Address } from '@zoltar/shared/ethereum'
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js'
import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/lib/actionGuards.js'
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js'

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
	viewerPoolHeldVaultRepBackingAttoRep,
	viewerVaultExists,
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
	viewerPoolHeldVaultRepBackingAttoRep: bigint | undefined
	viewerVaultExists: boolean
}) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before reporting on a question.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (reportingStatus === 'missing') return 'Loading reporting details.'
	if (selectedOutcome === undefined) return 'Select an outcome side before reporting on a question.'
	if (reportAmount.trim() === '') return 'Enter a report amount greater than zero.'
	if (selectedAmount === undefined || selectedAmount <= 0n) return 'Enter a valid report amount greater than zero.'
	if (contributionPreviewReason !== undefined) return contributionPreviewReason
	if (!viewerVaultExists) return 'Reporting moves pool-held REP backing from your security vault into dispute-staked REP. Deposit REP into your vault before reporting.'
	if (actualDepositAmount === undefined) return 'Unable to preview the REP backing that would become dispute-staked for this report.'
	if (viewerPoolHeldVaultRepBackingAttoRep === undefined) return 'Loading pool-held vault REP backing.'
	if (remainingSelectedOutcomeCapacity !== undefined && actualDepositAmount > remainingSelectedOutcomeCapacity) {
		if (remainingSelectedOutcomeCapacity === 0n) return 'No remaining contribution capacity is available on the selected side.'
		return `Only ${formatCurrencyBalance(remainingSelectedOutcomeCapacity)} REP remains before the selected side reaches the threshold.`
	}
	if (actualDepositAmount > viewerPoolHeldVaultRepBackingAttoRep) return `Deposit ${formatCurrencyBalance(actualDepositAmount - viewerPoolHeldVaultRepBackingAttoRep)} more REP into your vault's pool-held backing before reporting.`
	return undefined
}

export function getReportingWithdrawGuardMessage({ accountAddress, isOnActiveAppChain, reportingStatus }: { accountAddress: Address | undefined; isOnActiveAppChain: boolean; reportingStatus: ReportingStatus }) {
	const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason: 'Connect a wallet before settling escalation deposits.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (reportingStatus === 'missing') return 'Loading reporting details.'
	return undefined
}

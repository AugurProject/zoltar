import type { Address } from '@zoltar/shared/ethereum'
import type { ReportingOutcomeKey } from '../../../types/contracts.js'
import { getWalletMainnetGuardState } from '../../../lib/actionGuards.js'
import { formatCurrencyBalance } from '../../../lib/formatters.js'

type ReportingStatus = 'missing' | 'not-started' | 'active'

export function getReportingReportGuardMessage({
	actualDepositAmount,
	accountAddress,
	contributionPreviewReason,
	isMainnet,
	remainingSelectedOutcomeCapacity,
	reportAmount,
	reportingStatus,
	selectedOutcome,
	selectedAmount,
	viewerVaultAvailableEscalationRep,
	viewerVaultExists,
}: {
	actualDepositAmount: bigint | undefined
	accountAddress: Address | undefined
	contributionPreviewReason: string | undefined
	isMainnet: boolean
	remainingSelectedOutcomeCapacity: bigint | undefined
	reportAmount: string
	reportingStatus: ReportingStatus
	selectedOutcome: ReportingOutcomeKey | undefined
	selectedAmount: bigint | undefined
	viewerVaultAvailableEscalationRep: bigint | undefined
	viewerVaultExists: boolean
}) {
	const walletGuardState = getWalletMainnetGuardState({ accountAddress, isMainnet, walletRequiredReason: 'Connect a wallet before reporting on a market.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (reportingStatus === 'missing') return 'Load reporting details before reporting on an outcome.'
	if (selectedOutcome === undefined) return 'Select an outcome side before reporting on a market.'
	if (reportAmount.trim() === '') return 'Enter a report amount greater than zero.'
	if (selectedAmount === undefined || selectedAmount <= 0n) return 'Enter a valid report amount greater than zero.'
	if (contributionPreviewReason !== undefined) return contributionPreviewReason
	if (!viewerVaultExists) return 'Reporting locks REP already deposited in your security vault. Deposit REP into your vault before reporting.'
	if (actualDepositAmount === undefined) return 'Unable to preview the REP that would be locked for this report.'
	if (viewerVaultAvailableEscalationRep === undefined) return 'Loading available vault REP.'
	if (remainingSelectedOutcomeCapacity !== undefined && actualDepositAmount > remainingSelectedOutcomeCapacity) {
		if (remainingSelectedOutcomeCapacity === 0n) return 'No remaining contribution capacity is available on the selected side.'
		return `Only ${formatCurrencyBalance(remainingSelectedOutcomeCapacity)} REP remains before the selected side reaches the threshold.`
	}
	if (actualDepositAmount > viewerVaultAvailableEscalationRep) return `Need ${formatCurrencyBalance(actualDepositAmount - viewerVaultAvailableEscalationRep)} more unlocked REP in your vault before reporting.`
	return undefined
}

export function getReportingWithdrawGuardMessage({ accountAddress, isMainnet, reportingStatus }: { accountAddress: Address | undefined; isMainnet: boolean; reportingStatus: ReportingStatus }) {
	const walletGuardState = getWalletMainnetGuardState({ accountAddress, isMainnet, walletRequiredReason: 'Connect a wallet before settling escalation deposits.' })
	if (walletGuardState.blocked) return walletGuardState.reason
	if (reportingStatus === 'missing') return 'Load reporting details before settling escalation deposits.'
	return undefined
}

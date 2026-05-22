import type { Address } from 'viem'
import type { ReportingDetails } from '../types/contracts.js'
import type { ReportingOutcomeKey } from '../types/contracts.js'
import { formatCurrencyBalance } from './formatters.js'

type ReportingStatus = 'missing' | 'not-started' | 'active'

export function getReportingReportGuardMessage({
	actualDepositAmount,
	accountAddress,
	contributionPreviewReason,
	isMainnet,
	lockedReason,
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
	lockedReason: string | undefined
	reportAmount: string
	reportingStatus: ReportingStatus
	selectedOutcome: ReportingOutcomeKey | undefined
	selectedAmount: bigint | undefined
	viewerVaultAvailableEscalationRep: bigint | undefined
	viewerVaultExists: boolean
}) {
	if (lockedReason !== undefined) return lockedReason
	if (accountAddress === undefined) return 'Connect a wallet before reporting on a market.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before reporting on a market.'
	if (reportingStatus === 'missing') return 'Load reporting details before reporting on an outcome.'
	if (selectedOutcome === undefined) return 'Select an outcome side before reporting on a market.'
	if (reportAmount.trim() === '') return 'Enter a report amount greater than zero.'
	if (selectedAmount === undefined || selectedAmount <= 0n) return 'Enter a valid report amount greater than zero.'
	if (contributionPreviewReason !== undefined) return contributionPreviewReason
	if (!viewerVaultExists) return 'Reporting locks REP already deposited in your security vault. Deposit REP into your vault before reporting.'
	if (actualDepositAmount === undefined) return 'Unable to preview the REP that would be locked for this report.'
	if (viewerVaultAvailableEscalationRep === undefined) return 'Loading available vault REP.'
	if (actualDepositAmount > viewerVaultAvailableEscalationRep) {
		return `Need ${formatCurrencyBalance(actualDepositAmount - viewerVaultAvailableEscalationRep)} more unlocked REP in your vault before reporting.`
	}
	return undefined
}

export function getReportingWithdrawGuardMessage({
	accountAddress,
	hasUserDepositsOnSelectedSide,
	isMainnet,
	lockedReason,
	reportingStatus,
	withdrawalEnabled,
	withdrawalState,
	selectedOutcome,
}: {
	accountAddress: Address | undefined
	hasUserDepositsOnSelectedSide: boolean
	isMainnet: boolean
	lockedReason: string | undefined
	reportingStatus: ReportingStatus
	withdrawalEnabled: boolean
	withdrawalState: ReportingDetails['withdrawalState'] | undefined
	selectedOutcome: ReportingOutcomeKey | undefined
}) {
	if (lockedReason !== undefined) return lockedReason
	if (accountAddress === undefined) return 'Connect a wallet before withdrawing escalation deposits.'
	if (!isMainnet) return 'Switch to Ethereum mainnet before withdrawing escalation deposits.'
	if (reportingStatus === 'missing') return 'Load reporting details before withdrawing escalation deposits.'
	if (reportingStatus === 'not-started') return 'Withdrawals are unavailable until the first report or contribution deploys the escalation game.'
	if (!withdrawalEnabled && withdrawalState === 'not-finalized') return 'Escalation deposits cannot be withdrawn until the question is finalized or the game is canceled by an external fork.'
	if (selectedOutcome === undefined) return 'Select an outcome side before withdrawing escalation deposits.'
	if (!hasUserDepositsOnSelectedSide) return 'No deposits are available to withdraw on the selected side.'
	return undefined
}

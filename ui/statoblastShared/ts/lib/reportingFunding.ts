import { getWalletVaultFundingQuote } from '@zoltar/statoblast-shared/escalationGame/walletVaultFunding'
import type { ReportingDetails } from '@zoltar/ui-core-shared/types/contracts.js'

export function getReportingContributionFunding(details: ReportingDetails | undefined, selectedFunding: 'vault' | 'wallet' | undefined): 'vault' | 'wallet' {
	return selectedFunding ?? details?.contributionFunding ?? 'vault'
}

export function getReportingWalletFundingQuote(details: ReportingDetails | undefined, reportAmount: bigint | undefined) {
	if (reportAmount === undefined || details?.status !== 'active' || !details.forkContinuation) return undefined
	const minimum = details.minimumVaultRepDepositAttoRep
	const state = details.walletVaultFunding
	if (minimum === undefined || state === undefined) return undefined
	return getWalletVaultFundingQuote({ ...state, minimumVaultRepDepositAttoRep: minimum }, reportAmount)
}

export function getReportingWalletDepositAmount(details: ReportingDetails | undefined, reportAmount: bigint | undefined) {
	if (details?.status !== 'active' || !details.forkContinuation) return reportAmount
	return getReportingWalletFundingQuote(details, reportAmount)?.depositAmount
}

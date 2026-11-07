import type { ReportingDetails } from '../types/contracts.js'

export function getReportingContributionFunding(_details: ReportingDetails | undefined, _selectedFunding: 'vault' | 'wallet' | undefined): 'wallet' {
	return 'wallet'
}

export function getReportingWalletDepositAmount(_details: ReportingDetails | undefined, reportAmount: bigint | undefined) {
	return reportAmount
}

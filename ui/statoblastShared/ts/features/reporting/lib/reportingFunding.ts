import type { ReportingDetails } from '@zoltar/ui-core-shared/types/contracts.js'

export function getReportingContributionFunding(details: ReportingDetails | undefined, selectedFunding: 'vault' | 'wallet' | undefined): 'vault' | 'wallet' {
	if (details?.status === 'active' && details.forkContinuation) return 'vault'
	return selectedFunding ?? details?.contributionFunding ?? 'vault'
}

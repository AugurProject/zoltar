import type { SponsoredReport } from './sponsored-reports.ts'
import type { Activity, PendingStagedOperation, PendingTransactionIntent } from './operator-state.ts'
import type { PortfolioFunding } from './portfolio-instructions.ts'
import type { PortfolioScope } from '#monitoring/portfolio-monitor'
import type { RuntimeState } from './runtime-state.ts'

export type DurableState = {
	sponsoredReports?: SponsoredReport[] | undefined
	portfolioFunding?: Record<string, PortfolioFunding>
	completedPortfolioInstructions?: Record<string, string>
	portfolioScopes: PortfolioScope[]
	activities: Activity[]
	chainId: number
	lastScannedBlock: string | undefined
	pendingStagedOperations: PendingStagedOperation[]
	pendingTransactions: PendingTransactionIntent[]
	version: 2
}

/** The on-disk document: bigints are written as decimal strings, which `loadDurableState` parses back. */
export function durableStateDocument(state: RuntimeState) {
	return {
		sponsoredReports: state.sponsoredReports ?? [],
		activities: state.activities,
		chainId: state.chainId,
		lastScannedBlock: state.lastScannedBlock,
		pendingStagedOperations: state.pendingStagedOperations,
		pendingTransactions: state.pendingTransactions,
		portfolioFunding: state.portfolioFunding ?? {},
		completedPortfolioInstructions: state.completedPortfolioInstructions ?? {},
		portfolioScopes: state.portfolioScopes,
		version: 2,
	}
}

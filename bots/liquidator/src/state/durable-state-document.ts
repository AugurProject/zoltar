import type { Activity, PendingTransactionIntent } from './operator-state.ts'
import type { PortfolioFunding } from './portfolio-instructions.ts'
import type { PortfolioScope } from '#monitoring/portfolio-monitor'
import type { RuntimeState } from './runtime-state.ts'

export type DurableState = {
	portfolioFunding?: Record<string, PortfolioFunding>
	completedPortfolioInstructions?: Record<string, string>
	lastExpiredTakeoverBlock?: bigint | undefined
	portfolioScopes: PortfolioScope[]
	activities: Activity[]
	chainId: number
	lastScannedBlock: string | undefined
	pendingTransactions: PendingTransactionIntent[]
	version: 2
}

/** The on-disk document: bigints are written as decimal strings, which `loadDurableState` parses back. */
export function durableStateDocument(state: RuntimeState) {
	return {
		activities: state.activities,
		chainId: state.chainId,
		lastScannedBlock: state.lastScannedBlock,
		lastExpiredTakeoverBlock: state.lastExpiredTakeoverBlock,
		pendingTransactions: state.pendingTransactions,
		portfolioFunding: state.portfolioFunding ?? {},
		completedPortfolioInstructions: state.completedPortfolioInstructions ?? {},
		portfolioScopes: state.portfolioScopes,
		version: 2,
	}
}

import type { Activity, PendingTransactionIntent } from './operator-state.ts'
import type { SecurityPoolFunding } from './security-pool-instructions.ts'
import type { SecurityPoolScope } from '#monitoring/security-pool-monitor'
import type { RuntimeState } from './runtime-state.ts'

export type DurableState = {
	securityPoolFunding?: Record<string, SecurityPoolFunding>
	completedSecurityPoolInstructions?: Record<string, string>
	lastExpiredTakeoverBlock?: bigint | undefined
	securityPoolScopes: SecurityPoolScope[]
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
		securityPoolFunding: state.securityPoolFunding ?? {},
		completedSecurityPoolInstructions: state.completedSecurityPoolInstructions ?? {},
		securityPoolScopes: state.securityPoolScopes,
		version: 2,
	}
}

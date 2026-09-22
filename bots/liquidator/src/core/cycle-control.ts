export function shouldStopAfterSuccessfulCycle(once: boolean) {
	return once
}

export async function recoveryWorkBlocksExecution(state: { pendingStagedOperations: readonly unknown[]; pendingTransactions: readonly unknown[] }, recoverTransactions: () => Promise<boolean>, reconcileStagedOperations: () => Promise<void>) {
	if (await recoverTransactions()) return true
	await reconcileStagedOperations()
	return state.pendingTransactions.length !== 0 || state.pendingStagedOperations.length !== 0
}

export function requireRecoveredTransactionSuccess(status: 'reverted' | 'success', hash: string) {
	if (status === 'reverted') throw new Error(`Recovered transaction ${hash} reverted`)
}

export const PRIVATE_INTENT_FINALITY_BLOCKS = 12n

export function ambiguousRecoveryAction(intent: { requiresMarketEvidence: boolean }) {
	// A relay deadline cannot invalidate signed calldata or release the nonce.
	if (!intent.requiresMarketEvidence) return 'resubmit' as const
	return 'retain' as const
}

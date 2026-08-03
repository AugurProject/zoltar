export function shouldStopAfterSuccessfulCycle(once: boolean) {
	return once
}

export function requireRecoveredTransactionSuccess(status: 'reverted' | 'success', hash: string) {
	if (status === 'reverted') throw new Error(`Recovered transaction ${hash} reverted`)
}

export const PRIVATE_INTENT_FINALITY_BLOCKS = 12n

export function ambiguousRecoveryAction(intent: { maxBlockNumber: bigint; mode: 'private' | 'public'; requiresMarketEvidence: boolean }, canonicalHeads: readonly bigint[]) {
	if (!intent.requiresMarketEvidence) return 'resubmit' as const
	if (intent.mode === 'private' && canonicalHeads.length > 0 && canonicalHeads.every(head => head >= intent.maxBlockNumber + PRIVATE_INTENT_FINALITY_BLOCKS)) return 'expire-private' as const
	return 'retain' as const
}

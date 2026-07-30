export function shouldStopAfterSuccessfulCycle(once: boolean) {
	return once
}

export function requireRecoveredTransactionSuccess(status: 'reverted' | 'success', hash: string) {
	if (status === 'reverted') throw new Error(`Recovered transaction ${hash} reverted`)
}

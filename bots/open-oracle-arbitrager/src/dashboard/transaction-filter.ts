import type { PublicTransactionActivity } from '#state/operator-state'

export function transactionMatchesFilter(status: PublicTransactionActivity['status'], filter: string) {
	if (filter === 'all') return true
	if (filter === 'failed') return status === 'reverted' || status === 'submission-failed'
	return status === filter
}

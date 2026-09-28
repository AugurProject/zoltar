import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { hasPendingTransactionActivity, recordTransactionSettled, recordTransactionSubmitted, releaseTransactionActivityWatch } from '@zoltar/ui-core-shared/transactions/transactionActivityStore.js'
import { createTransactionScope } from '@zoltar/ui-core-shared/transactions/transactionScope.js'
import { getTransactionFailureKind } from '@zoltar/ui-core-shared/transactions/transactionLifecycle.js'

function marketTransactionScope(market: Address) {
	return createTransactionScope('market', market)
}

/** A market's ticket stays locked while any transaction on it is pending, including one restored after a reload. */
export function isMarketTransactionPending(market: Address | undefined) {
	return market !== undefined && hasPendingTransactionActivity(marketTransactionScope(market))
}

/** Records one market transaction in the shared activity list as it is broadcast, replaced, and settled. */
export function createMarketTransactionActivity(market: Address, title: string) {
	let current: Hash | undefined
	return {
		broadcast(hash: Hash) {
			current = hash
			recordTransactionSubmitted({ hash, scope: marketTransactionScope(market), title })
		},
		replaced(hash: Hash) {
			recordTransactionSubmitted({ hash, previousHash: current, scope: marketTransactionScope(market), title })
			current = hash
		},
		receipt(status: 'success' | 'reverted') {
			if (current === undefined) return
			recordTransactionSettled(current, status === 'success' ? { status: 'confirmed' } : { status: 'failed', failureKind: 'reverted' })
		},
		/** The ticket stopped waiting (its receipt read failed or it unmounted); the activity list keeps checking. */
		handOff() {
			if (current !== undefined) releaseTransactionActivityWatch(current)
		},
		/** The action stopped after its broadcast: a known outcome (such as a wallet cancellation) settles the row, otherwise the activity list keeps checking. */
		stopped(error: unknown, receiptKnown: boolean) {
			if (current === undefined) return
			if (!receiptKnown) {
				releaseTransactionActivityWatch(current)
				return
			}
			const kind = getTransactionFailureKind(error)
			recordTransactionSettled(current, { status: 'failed', failureKind: kind === 'error' ? 'replaced' : kind })
		},
	}
}

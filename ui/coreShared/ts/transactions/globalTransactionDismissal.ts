import { signal } from '@preact/signals'
import type { GlobalTransactionPresentation } from '../types/components.js'

const MAX_REMEMBERED_DISMISSALS = 100
const dismissedKeys = signal<ReadonlySet<string>>(new Set())
function getDismissalTransactionKey(transaction: GlobalTransactionPresentation | undefined) {
	const dismissKey = transaction?.dismissKey
	if (dismissKey !== undefined && !dismissKey.startsWith('transaction-request-')) return dismissKey
	return transaction?.hash ?? dismissKey ?? transaction?.operationKey
}

function getGlobalTransactionDismissKey(transaction: GlobalTransactionPresentation | undefined) {
	const transactionKey = getDismissalTransactionKey(transaction)
	if (transactionKey === undefined || transaction === undefined) return undefined
	return `${transaction.tone}:${transactionKey}`
}

export function isGlobalTransactionDismissed(transaction: GlobalTransactionPresentation | undefined) {
	const key = getGlobalTransactionDismissKey(transaction)
	return key !== undefined && dismissedKeys.value.has(key)
}

export function dismissGlobalTransaction(transaction: GlobalTransactionPresentation | undefined) {
	const key = getGlobalTransactionDismissKey(transaction)
	if (key === undefined || transaction === undefined) return
	const remembered = new Set(dismissedKeys.peek())
	if (!getDismissalTransactionKey(transaction)?.startsWith('transaction-request-')) {
		if (remembered.size >= MAX_REMEMBERED_DISMISSALS) {
			const oldestKey = remembered.values().next().value
			if (oldestKey !== undefined) remembered.delete(oldestKey)
		}
		remembered.add(key)
	}
	dismissedKeys.value = remembered
}

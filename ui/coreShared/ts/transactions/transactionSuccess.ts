import { signal } from '@preact/signals'

// A success already presented in a dialog does not need a second page-level notice.
export const presentedSuccessHashes = signal<ReadonlySet<string>>(new Set())

export function markTransactionSuccessPresented(hash: string) {
	if (presentedSuccessHashes.value.has(hash)) return
	presentedSuccessHashes.value = new Set([...presentedSuccessHashes.value, hash].slice(-100))
}

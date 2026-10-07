import type { Hash } from '@zoltar/core-shared/evm/ethereum'

// Hashes the user stopped tracking in this page, so a receipt wait that starts or resumes later releases them too.
const stoppedHashes = new Set<string>()
const listeners = new Set<(hash: Hash) => void>()

/** Releases a broadcast transaction everywhere this page waits for it: receipt waits, the status tray, and its action. */
export function announceTransactionTrackingStopped(hash: Hash) {
	stoppedHashes.add(hash.toLowerCase())
	for (const listener of [...listeners]) listener(hash)
}

export function isTransactionTrackingStopped(hash: Hash) {
	return stoppedHashes.has(hash.toLowerCase())
}

export function subscribeTransactionTrackingStopped(listener: (hash: Hash) => void) {
	listeners.add(listener)
	return () => {
		listeners.delete(listener)
	}
}

/** Test isolation: stopped hashes are module state shared by every rendered app. */
export function resetTransactionTrackingStopsForTesting() {
	stoppedHashes.clear()
}

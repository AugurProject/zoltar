import { signal } from '@preact/signals'
import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { useEffect } from 'preact/hooks'
import { createActiveEnvironmentGuard, getActiveBackend, getActiveNetworkProfile } from '../lib/activeEnvironment.js'
import { getBrowserStorage } from '../lib/browserStorage.js'
import { createConnectedReadClient } from '../wallet/clients.js'
import { createRecoveringReceiptWaiter } from './receiptRecovery.js'
import { getTransactionActivityStorageKey, parseStoredTransactionActivity, recordSubmittedTransactionActivity, replaceTransactionActivityHash, serializeTransactionActivity, settleTransactionActivity, type TransactionActivityEntry, type TransactionActivityOutcome } from './transactionActivity.js'
import { transactionScopesOverlap, type TransactionScope } from './transactionScope.js'

type TransactionActivityState = Readonly<{
	chainId: number | undefined
	entries: readonly TransactionActivityEntry[]
	ownerKey: string | undefined
	storageKey: string | undefined
}>

/** Recent transactions of the connected account on the active network, newest first. */
export const transactionActivity = signal<TransactionActivityState>({ chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined })

// Hashes whose receipt this page is already waiting for, either through the initiating action or the activity watcher.
const watchedHashes = new Set<Hash>()
// Bumped when an initiating action stops watching a pending hash, so the activity watcher takes it over.
const releasedWatches = signal(0)

function persist(state: TransactionActivityState) {
	if (state.storageKey === undefined) return
	try {
		getBrowserStorage('localStorage')?.setItem(state.storageKey, serializeTransactionActivity(state.entries))
	} catch (error) {
		// A full or blocked storage keeps the in-memory list; the next successful write stores it.
		if (!(error instanceof DOMException)) throw error
	}
}

function update(change: (entries: readonly TransactionActivityEntry[]) => readonly TransactionActivityEntry[]) {
	const current = transactionActivity.peek()
	const entries = change(current.entries)
	if (entries === current.entries) return
	const next = { ...current, entries }
	transactionActivity.value = next
	persist(next)
}

/**
 * Selects whose activity the list shows. The browser simulation resets on reload, so its activity stays in memory.
 */
export function setTransactionActivityOwner(account: Address | undefined) {
	const backendId = getActiveBackend().id
	const chainId = getActiveNetworkProfile().chain.id
	const storageKey = account === undefined || backendId === 'simulation' ? undefined : getTransactionActivityStorageKey({ account, backendId, chainId })
	const ownerKey = `${backendId}:${chainId}:${account?.toLowerCase() ?? ''}`
	if (transactionActivity.peek().ownerKey === ownerKey) return
	const stored = storageKey === undefined ? [] : parseStoredTransactionActivity(getBrowserStorage('localStorage')?.getItem(storageKey))
	transactionActivity.value = { chainId, entries: stored, ownerKey, storageKey }
}

export function recordTransactionSubmitted({ hash, previousHash, scope, title }: { hash: Hash; previousHash?: Hash | undefined; scope: TransactionScope | undefined; title: string }) {
	watchedHashes.add(hash)
	const chainId = transactionActivity.peek().chainId ?? getActiveNetworkProfile().chain.id
	update(entries => {
		if (previousHash !== undefined && entries.some(entry => entry.hash === previousHash)) return replaceTransactionActivityHash(entries, previousHash, hash)
		return recordSubmittedTransactionActivity(entries, { chainId, hash, scope: scope ?? [], status: 'pending', submittedAt: Date.now(), title })
	})
}

export function recordTransactionSettled(hash: Hash, outcome: TransactionActivityOutcome) {
	watchedHashes.delete(hash)
	update(entries => settleTransactionActivity(entries, hash, outcome, Date.now()))
}

/** The initiating action stopped tracking a broadcast transaction; the activity watcher keeps waiting for its receipt. */
export function releaseTransactionActivityWatch(hash: Hash) {
	if (!watchedHashes.delete(hash)) return
	releasedWatches.value += 1
}

export function hasPendingTransactionActivity(scope: TransactionScope) {
	return transactionActivity.value.entries.some(entry => entry.status === 'pending' && transactionScopesOverlap(entry.scope, scope))
}

/** Resumes receipt watching for pending transactions restored from storage; the initiating action watches its own. */
export function useTransactionActivityReceiptWatcher() {
	const entries = transactionActivity.value.entries
	const released = releasedWatches.value
	useEffect(() => {
		for (const entry of entries) {
			if (entry.status !== 'pending' || watchedHashes.has(entry.hash)) continue
			watchedHashes.add(entry.hash)
			const environment = createActiveEnvironmentGuard()
			const waitForReceipt = createRecoveringReceiptWaiter(createConnectedReadClient(), { isCurrentEnvironment: environment.isCurrent, onTransactionSubmitted: () => undefined })
			void waitForReceipt({ hash: entry.hash })
				.then(receipt => recordTransactionSettled(entry.hash, receipt.status === 'success' ? { status: 'confirmed' } : { status: 'failed', failureKind: 'reverted' }))
				.catch(() => {
					// The network changed; the next owner's list resumes its own pending entries.
					watchedHashes.delete(entry.hash)
				})
		}
	}, [entries, released])
}

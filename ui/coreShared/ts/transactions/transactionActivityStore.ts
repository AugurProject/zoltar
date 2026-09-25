import { signal } from '@preact/signals'
import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { useEffect } from 'preact/hooks'
import { createActiveEnvironmentGuard, getActiveBackend, getActiveNetworkProfile } from '../lib/activeEnvironment.js'
import { getBrowserStorage } from '../lib/browserStorage.js'
import { createConnectedReadClient } from '../wallet/clients.js'
import { createRecoveringReceiptWaiter } from './receiptRecovery.js'
import {
	dismissTransactionActivity,
	mergeStoredTransactionActivity,
	expireStaleTransactionActivity,
	getTransactionActivityStorageKey,
	parseStoredTransactionActivity,
	recordSubmittedTransactionActivity,
	replaceTransactionActivityHash,
	serializeTransactionActivity,
	settleTransactionActivity,
	type TransactionActivityEntry,
	type TransactionActivityOutcome,
} from './transactionActivity.js'
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

function readStored(storageKey: string | undefined) {
	return storageKey === undefined ? [] : parseStoredTransactionActivity(getBrowserStorage('localStorage')?.getItem(storageKey))
}

function update(change: (entries: readonly TransactionActivityEntry[]) => readonly TransactionActivityEntry[]) {
	const current = transactionActivity.peek()
	// Another tab on the same account may have stored entries since this tab loaded; keep them instead of overwriting.
	const merged = mergeStoredTransactionActivity(current.entries, readStored(current.storageKey))
	const entries = change(merged)
	if (entries === current.entries) return
	const next = { ...current, entries }
	transactionActivity.value = next
	persist(next)
}

/** Test isolation: the list and its watch bookkeeping are module state shared by every rendered app. */
export function resetTransactionActivityForTesting() {
	watchedHashes.clear()
	transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
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
	const stored = readStored(storageKey)
	const entries = expireStaleTransactionActivity(stored, Date.now())
	transactionActivity.value = { chainId, entries, ownerKey, storageKey }
	if (entries !== stored) persist(transactionActivity.value)
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

/** Removes an entry the user no longer wants tracked; a stuck pending entry stops locking its objects. */
export function dismissTransactionActivityEntry(hash: Hash) {
	watchedHashes.delete(hash)
	update(entries => dismissTransactionActivity(entries, hash))
}

function isPendingInActivity(hash: Hash) {
	return transactionActivity.peek().entries.some(entry => entry.hash === hash && entry.status === 'pending')
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
			let current = entry.hash
			let replacedOutsideApp = false
			const environment = createActiveEnvironmentGuard()
			// Stop polling once the network changes or the entry is settled, dismissed, or expired elsewhere.
			const stillTracked = () => environment.isCurrent() && isPendingInActivity(current)
			const waitForReceipt = createRecoveringReceiptWaiter(createConnectedReadClient(), { isCurrentEnvironment: stillTracked, onTransactionSubmitted: () => undefined })
			void waitForReceipt({
				hash: entry.hash,
				onReplaced: replacement => {
					if (replacement.reason === 'repriced') {
						// A sped-up transaction keeps its row under the new hash.
						watchedHashes.delete(current)
						watchedHashes.add(replacement.transaction.hash)
						update(entries => replaceTransactionActivityHash(entries, current, replacement.transaction.hash))
						current = replacement.transaction.hash
						return
					}
					replacedOutsideApp = true
				},
			})
				.then(receipt => {
					if (replacedOutsideApp) recordTransactionSettled(current, { status: 'failed', failureKind: 'replaced' })
					else recordTransactionSettled(current, receipt.status === 'success' ? { status: 'confirmed' } : { status: 'failed', failureKind: 'reverted' })
				})
				.catch(() => {
					// The network changed or the entry stopped being tracked; the next owner's list resumes its own pending entries.
					watchedHashes.delete(current)
				})
		}
	}, [entries, released])
}

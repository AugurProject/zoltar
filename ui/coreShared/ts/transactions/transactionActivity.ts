import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import type { TransactionFailureKind } from './transactionLifecycle.js'
import type { TransactionScope } from './transactionScope.js'

type TransactionActivityStatus = 'pending' | 'confirmed' | 'failed'

/** Why a stored transaction failed; `dropped` means it was never included within the tracking window. */
type TransactionActivityFailureKind = TransactionFailureKind | 'dropped'

/** A broadcast transaction remembered per network and account so its status survives a reload. */
export type TransactionActivityEntry = Readonly<{
	chainId: number
	failureKind?: TransactionActivityFailureKind | undefined
	hash: Hash
	/** Earlier hashes of this transaction (wallet speed-ups), so another tab's stale copy is not merged back. */
	replacedHashes?: readonly Hash[] | undefined
	scope: TransactionScope
	settledAt?: number | undefined
	status: TransactionActivityStatus
	submittedAt: number
	title: string
}>

/** A confirmed outcome may carry the result title the status panel showed, so the settled row reads the same. */
export type TransactionActivityOutcome = Readonly<{ status: 'confirmed'; title?: string | undefined }> | Readonly<{ status: 'failed'; failureKind: TransactionActivityFailureKind }>

export const MAX_TRANSACTION_ACTIVITY_ENTRIES = 20

/** A transaction still pending after this long was dropped or replaced outside the app; it stops locking its objects. */
export const MAX_PENDING_TRANSACTION_AGE_MILLISECONDS = 24 * 60 * 60 * 1000

export function getTransactionActivityStorageKey({ account, backendId, chainId }: { account: string; backendId: string; chainId: number }) {
	return `zoltar.transactionActivity.v1:${backendId}:${chainId}:${account.toLowerCase()}`
}

/** Newest first; pending entries are never evicted, settled ones beyond the cap are. */
function capActivity(entries: readonly TransactionActivityEntry[]) {
	const settledBudget = Math.max(0, MAX_TRANSACTION_ACTIVITY_ENTRIES - entries.filter(entry => entry.status === 'pending').length)
	let settledKept = 0
	return entries.filter(entry => {
		if (entry.status === 'pending') return true
		settledKept += 1
		return settledKept <= settledBudget
	})
}

export function recordSubmittedTransactionActivity(entries: readonly TransactionActivityEntry[], entry: TransactionActivityEntry) {
	const existing = entries.find(candidate => candidate.hash === entry.hash)
	if (existing !== undefined) return entries
	return capActivity([entry, ...entries])
}

/** A replacement transaction takes over the entry of the transaction it replaced. */
export function replaceTransactionActivityHash(entries: readonly TransactionActivityEntry[], previousHash: Hash, nextHash: Hash, now: number) {
	if (previousHash === nextHash) return entries
	// The replacement already has its own row (for example recorded by another tab): the previous hash was replaced.
	if (entries.some(entry => entry.hash === nextHash)) return settleTransactionActivity(entries, previousHash, { status: 'failed', failureKind: 'replaced' }, now)
	return entries.map(entry => (entry.hash === previousHash ? { ...entry, hash: nextHash, replacedHashes: [...(entry.replacedHashes ?? []), previousHash] } : entry))
}

export function settleTransactionActivity(entries: readonly TransactionActivityEntry[], hash: Hash, outcome: TransactionActivityOutcome, settledAt: number) {
	const target = entries.find(entry => entry.hash === hash)
	if (target === undefined || target.status !== 'pending') return entries
	const settle = (entry: TransactionActivityEntry): TransactionActivityEntry => {
		if (outcome.status === 'failed') return { ...entry, failureKind: outcome.failureKind, settledAt, status: 'failed' }
		return { ...entry, settledAt, status: 'confirmed', ...(outcome.title === undefined ? {} : { title: outcome.title }) }
	}
	return capActivity(entries.map(entry => (entry.hash === hash ? settle(entry) : entry)))
}

/**
 * Adds entries another tab stored for the same account, newest first. A settled copy of a shared hash wins over a
 * pending one, so an outcome or a "stop tracking" recorded in either tab is never undone by the other.
 * Replacement history from either tab removes superseded hashes from both lists.
 */
export function mergeStoredTransactionActivity(entries: readonly TransactionActivityEntry[], stored: readonly TransactionActivityEntry[]) {
	let changed = false
	const replacedHashes = new Set([...entries, ...stored].flatMap(entry => entry.replacedHashes ?? []))
	const merged = entries.flatMap(entry => {
		if (replacedHashes.has(entry.hash)) {
			changed = true
			return []
		}
		const other = stored.find(candidate => candidate.hash === entry.hash)
		if (other === undefined || entry.status !== 'pending' || other.status === 'pending') return [entry]
		changed = true
		return [other]
	})
	const missing = stored.filter(candidate => !entries.some(entry => entry.hash === candidate.hash) && !replacedHashes.has(candidate.hash))
	if (!changed && missing.length === 0) return entries
	return capActivity([...merged, ...missing].sort((left, right) => right.submittedAt - left.submittedAt))
}

/** Settles pending transactions older than the tracking window as dropped. */
export function expireStaleTransactionActivity(entries: readonly TransactionActivityEntry[], now: number) {
	const stale = entries.filter(entry => entry.status === 'pending' && now - entry.submittedAt > MAX_PENDING_TRANSACTION_AGE_MILLISECONDS)
	return stale.reduce((current, entry) => settleTransactionActivity(current, entry.hash, { status: 'failed', failureKind: 'dropped' }, now), entries)
}

export function countPendingTransactionActivity(entries: readonly TransactionActivityEntry[]) {
	return entries.filter(entry => entry.status === 'pending').length
}

export function getPendingTransactionActivityScopes(entries: readonly TransactionActivityEntry[]): readonly TransactionScope[] {
	return entries.flatMap(entry => (entry.status === 'pending' && entry.scope.length > 0 ? [entry.scope] : []))
}

function isHash(value: unknown): value is Hash {
	return typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
}

function isFailureKind(value: unknown): value is TransactionActivityFailureKind {
	return value === 'rejected' || value === 'reverted' || value === 'replaced' || value === 'error' || value === 'dropped'
}

function isFiniteTimestamp(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function parseEntry(value: unknown): TransactionActivityEntry | undefined {
	if (typeof value !== 'object' || value === null) return undefined
	if (!('hash' in value) || !isHash(value.hash)) return undefined
	if (!('chainId' in value) || typeof value.chainId !== 'number' || !Number.isSafeInteger(value.chainId)) return undefined
	if (!('title' in value) || typeof value.title !== 'string') return undefined
	if (!('submittedAt' in value) || !isFiniteTimestamp(value.submittedAt)) return undefined
	if (!('status' in value) || (value.status !== 'pending' && value.status !== 'confirmed' && value.status !== 'failed')) return undefined
	const scope = 'scope' in value && Array.isArray(value.scope) ? value.scope.filter(key => typeof key === 'string') : []
	const failureKind = 'failureKind' in value && isFailureKind(value.failureKind) ? value.failureKind : undefined
	const settledAt = 'settledAt' in value && isFiniteTimestamp(value.settledAt) ? value.settledAt : undefined
	const replacedHashes = 'replacedHashes' in value && Array.isArray(value.replacedHashes) ? value.replacedHashes.filter(isHash) : []
	if (value.status === 'failed' && failureKind === undefined) return undefined
	return {
		chainId: value.chainId,
		hash: value.hash,
		scope,
		status: value.status,
		submittedAt: value.submittedAt,
		title: value.title,
		...(failureKind === undefined ? {} : { failureKind }),
		...(settledAt === undefined ? {} : { settledAt }),
		...(replacedHashes.length === 0 ? {} : { replacedHashes }),
	}
}

/** Reads stored activity, dropping malformed records instead of failing the whole list. */
export function parseStoredTransactionActivity(raw: string | null | undefined): TransactionActivityEntry[] {
	if (raw === null || raw === undefined || raw === '') return []
	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch (error) {
		// Corrupt storage starts a fresh list rather than breaking the page.
		if (error instanceof SyntaxError) return []
		throw error
	}
	if (!Array.isArray(parsed)) return []
	return capActivity(parsed.flatMap(value => parseEntry(value) ?? []))
}

export function serializeTransactionActivity(entries: readonly TransactionActivityEntry[]) {
	return JSON.stringify(entries)
}

import type { Hash } from '@zoltar/core-shared/evm/ethereum'
import type { TransactionFailureKind } from './transactionLifecycle.js'
import type { TransactionScope } from './transactionScope.js'

type TransactionActivityStatus = 'pending' | 'confirmed' | 'failed'

/** A broadcast transaction remembered per network and account so its status survives a reload. */
export type TransactionActivityEntry = Readonly<{
	chainId: number
	failureKind?: TransactionFailureKind | undefined
	hash: Hash
	scope: TransactionScope
	settledAt?: number | undefined
	status: TransactionActivityStatus
	submittedAt: number
	title: string
}>

export type TransactionActivityOutcome = Readonly<{ status: 'confirmed' }> | Readonly<{ status: 'failed'; failureKind: TransactionFailureKind }>

export const MAX_TRANSACTION_ACTIVITY_ENTRIES = 20

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
export function replaceTransactionActivityHash(entries: readonly TransactionActivityEntry[], previousHash: Hash, nextHash: Hash) {
	if (previousHash === nextHash || entries.some(entry => entry.hash === nextHash)) return entries
	return entries.map(entry => (entry.hash === previousHash ? { ...entry, hash: nextHash } : entry))
}

export function settleTransactionActivity(entries: readonly TransactionActivityEntry[], hash: Hash, outcome: TransactionActivityOutcome, settledAt: number) {
	const target = entries.find(entry => entry.hash === hash)
	if (target === undefined || target.status !== 'pending') return entries
	return capActivity(entries.map(entry => (entry.hash === hash ? { ...entry, ...outcome, settledAt } : entry)))
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

function isFailureKind(value: unknown): value is TransactionFailureKind {
	return value === 'rejected' || value === 'reverted' || value === 'replaced' || value === 'error'
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

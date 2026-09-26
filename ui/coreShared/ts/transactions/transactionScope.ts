/**
 * The objects a transaction touches, as lock keys such as `security-pool:0xabc…` or `market:0xdef…`.
 * A pending transaction locks only the actions whose scope shares a key with it; an unscoped action is
 * never locked by an unrelated transaction.
 */
export type TransactionScope = readonly string[]

export const unscopedTransaction: TransactionScope = []

function normalizeScopeId(id: string | bigint) {
	if (typeof id === 'bigint') return `0x${id.toString(16)}`
	return id.trim().toLowerCase()
}

/** A scope for one object; an absent or blank id yields an empty scope so callers can pass optional values. */
export function createTransactionScope(kind: string, id: string | bigint | undefined): TransactionScope {
	if (id === undefined) return unscopedTransaction
	const normalized = normalizeScopeId(id)
	return normalized === '' ? unscopedTransaction : [`${kind}:${normalized}`]
}

export function mergeTransactionScopes(...scopes: readonly (TransactionScope | undefined)[]): TransactionScope {
	const keys = new Set<string>()
	for (const scope of scopes) for (const key of scope ?? []) keys.add(key)
	return [...keys]
}

export function transactionScopesOverlap(left: TransactionScope | undefined, right: TransactionScope | undefined) {
	if (left === undefined || right === undefined || left.length === 0 || right.length === 0) return false
	return left.some(key => right.includes(key))
}

export function securityPoolTransactionScope(securityPoolAddress: string | undefined) {
	return createTransactionScope('security-pool', securityPoolAddress)
}

export function universeTransactionScope(universeId: bigint | undefined) {
	return createTransactionScope('universe', universeId)
}

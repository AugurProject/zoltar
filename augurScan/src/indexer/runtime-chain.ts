import type { Hash, PublicClient } from '../ethereum.ts'
import { ChainConfigurationError, ChainContinuityError } from './runtime-rpc.ts'

export const queryCanonicalLogRange = async <T>(throughBlock: bigint, readEndBlockHash: () => Promise<Hash>, query: () => Promise<readonly T[]>): Promise<{ readonly items: readonly T[]; readonly endBlockHash: Hash }> => {
	const before = await readEndBlockHash()
	const items = await query()
	const after = await readEndBlockHash()
	if (before !== after) throw new ChainContinuityError(`Canonical chain changed while querying logs through block ${throughBlock}`)
	return { items, endBlockHash: after }
}

export type ChainProvider = { readonly getChainId: () => Promise<number> }
export type RpcProvider = ChainProvider & { readonly client: PublicClient; readonly endpoint: string; readonly number: number }

const rpcEndpointLabel = (rpcUrl: string): string => {
	const url = new URL(rpcUrl)
	const hostnameParts = url.hostname.split('.')
	const isLocalOrIp = url.hostname === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(':')
	const hostname = !isLocalOrIp && hostnameParts.length > 2 ? `*.${hostnameParts.slice(-2).join('.')}` : url.hostname
	return `${url.protocol}//${hostname}${url.port === '' ? '' : `:${url.port}`}`
}

export const rpcProviderLabel = (rpcUrl: string, index: number): string => `#${index + 1} ${rpcEndpointLabel(rpcUrl)}`

export const rpcFailureLogMessage = (message: string, endpoint: string, reason?: string): string => `${message} (RPC: ${endpoint}${reason === undefined ? '' : `; reason: ${reason}`})`

export const withVerifiedProvider = async <TProvider extends ChainProvider, TResult>(
	providers: readonly TProvider[],
	chainId: number,
	operation: (provider: TProvider) => Promise<TResult>,
	stopFailover = (_error: unknown): boolean => false,
	onAttempt = (_provider: TProvider): void => {},
	verifiedProviders?: WeakSet<TProvider>,
	onFailure = (_provider: TProvider, _error: unknown): void => {},
): Promise<TResult> => {
	let lastFailure: unknown
	for (const provider of providers) {
		onAttempt(provider)
		try {
			if (verifiedProviders?.has(provider) !== true) {
				const remoteChainId = await provider.getChainId()
				if (remoteChainId !== chainId) throw new ChainConfigurationError(`RPC chain mismatch: configured ${chainId}, received ${remoteChainId}`)
				verifiedProviders?.add(provider)
			}
			return await operation(provider)
		} catch (error) {
			onFailure(provider, error)
			if (stopFailover(error)) throw error
			lastFailure = error
		}
	}
	throw lastFailure ?? new ChainConfigurationError('No RPC provider is available for the configured network')
}

export const confirmCanonicalBlock = async (number: bigint, expectedHash: Hash, lookup: (blockNumber: bigint) => Promise<Hash>): Promise<void> => {
	const observedHash = await lookup(number)
	if (observedHash !== expectedHash) throw new ChainContinuityError(`Block ${number} changed while it was being indexed`)
}

type StoredBlock = { readonly number: bigint; readonly hash: Hash }

/**
 * The newest stored canonical block that the remote chain still contains. Every stored anchor is a candidate, even
 * below the confirmation depth: a block hash commits to its whole ancestry, so the first match bounds the blocks
 * actually replaced. Because of that commitment, "the remote chain still has stored block N" holds for every stored
 * block up to the answer and for none above it, so the search steps back by doubling offsets until a stored block
 * matches and then bisects between that match and the nearest mismatch: O(log n) header reads, not one per stored block.
 */
export const findSparseCanonicalAncestor = async (before: bigint, checkpointAtOrBefore: (blockNumber: bigint) => Promise<StoredBlock | undefined>, lookup: (blockNumber: bigint) => Promise<Hash>, signal?: AbortSignal): Promise<StoredBlock | undefined> => {
	const matches = async (stored: StoredBlock): Promise<boolean> => {
		signal?.throwIfAborted()
		return (await lookup(stored.number)) === stored.hash
	}
	const newest = await checkpointAtOrBefore(before)
	if (newest === undefined || (await matches(newest))) return newest
	let mismatch = newest
	let best: StoredBlock | undefined
	// The nearest stored block at or before the last target is the match, so none lies in (best, low].
	let low = 0n
	for (let step = 1n; best === undefined; step *= 2n) {
		if (mismatch.number === 0n) return undefined
		const target = mismatch.number > step ? mismatch.number - step : 0n
		const candidate = await checkpointAtOrBefore(target)
		if (candidate === undefined) {
			low = target
			break
		}
		if (await matches(candidate)) {
			best = candidate
			low = target
		} else {
			mismatch = candidate
		}
	}
	// Invariant: best matches, mismatch does not, and no unexamined stored block lies in (best, low].
	let high = mismatch.number
	while (high - low > 1n) {
		const middle = (low + high) / 2n
		const candidate = await checkpointAtOrBefore(middle)
		if (candidate === undefined || (best !== undefined && candidate.number <= best.number)) {
			low = middle
		} else if (await matches(candidate)) {
			best = candidate
			low = middle
		} else {
			high = candidate.number
		}
	}
	return best
}

export const commitSparseCanonicalBatch = async (anchors: readonly { readonly number: bigint; readonly hash: Hash }[], lookup: (blockNumber: bigint) => Promise<Hash>, commit: (validateBeforeCommit: () => Promise<void>) => Promise<void>): Promise<void> => {
	const validate = async (): Promise<void> => {
		for (const anchor of anchors) await confirmCanonicalBlock(anchor.number, anchor.hash, lookup)
	}
	await validate()
	await commit(validate)
}

export const commitCanonicalRead = async <T>(number: bigint, expectedHash: Hash, read: () => Promise<T>, lookup: (blockNumber: bigint) => Promise<Hash>, commit: (value: T) => Promise<void>): Promise<void> => {
	const value = await read()
	await confirmCanonicalBlock(number, expectedHash, lookup)
	await commit(value)
}

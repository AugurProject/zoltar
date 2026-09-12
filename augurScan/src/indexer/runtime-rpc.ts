import type { AddressActivity, StoredTransaction } from '../database.ts'
import { type Address, createPublicClient, type Hash, http, type Log, type PublicClient, type RpcFetchFn, zeroAddress } from '../ethereum.ts'
import { safePrunedStateProviderMessage } from '../logging.ts'
import { RpcRequestMethodError, type RpcRequestQueue, withRpcRequestQueue } from '../rpc-request-queue.ts'
import { bigintToSafeNumber } from '../time.ts'
import type { ContractMetadata, StoredLog } from '../types.ts'

export const waitForIndexerDelay = (milliseconds: number, signal: AbortSignal): Promise<void> =>
	new Promise(resolve => {
		const finish = (): void => {
			clearTimeout(timeout)
			signal.removeEventListener('abort', finish)
			resolve()
		}
		const timeout = setTimeout(finish, milliseconds)
		if (signal.aborted) finish()
		else signal.addEventListener('abort', finish, { once: true })
	})

export const normalizedRpcDescription = (value: string): string =>
	[...value]
		.map(character => {
			const codePoint = character.codePointAt(0)
			return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) ? ' ' : character
		})
		.join('')
		.replace(/\p{Cf}/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim()
		.toLowerCase()

const withoutAnsiControlSequences = (value: string): string => {
	const characters: string[] = []
	for (let index = 0; index < value.length; index++) {
		if (value.codePointAt(index) === 0x1b && value[index + 1] === '[') {
			index += 2
			while (index < value.length) {
				const codePoint = value.codePointAt(index)
				if (codePoint !== undefined && codePoint >= 0x40 && codePoint <= 0x7e) break
				index++
			}
			characters.push(' ')
		} else characters.push(value[index] ?? '')
	}
	return characters.join('')
}

export const singleLineErrorDescription = (value: string): string =>
	[...withoutAnsiControlSequences(value)]
		.map(character => {
			const codePoint = character.codePointAt(0)
			return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) ? ' ' : character
		})
		.join('')
		.replace(/\p{Cf}/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim()

const classifiedRpcDescription = (value: string): string =>
	normalizedRpcDescription(value)
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim()

export type RpcDescriptionCategory = 'block-range' | 'rate-limit' | 'response-size' | 'result-limit' | 'timeout' | 'too-many-logs' | 'too-many-results'

const rpcDescriptionCategory = (value: string): RpcDescriptionCategory | undefined => {
	const description = classifiedRpcDescription(value)
	if (
		description.includes('rate limit') ||
		description.includes('too many requests') ||
		description.includes('request limit') ||
		description.includes('request rate') ||
		description.includes('request quota') ||
		description.includes('quota exceeded') ||
		/\bmore than\b.*\brequests?\b/u.test(description) ||
		/\brequests? per (?:second|minute|hour)\b/u.test(description)
	)
		return 'rate-limit'
	if (description.includes('too many logs') || /\bmore than\b.*\blogs\b/u.test(description)) return 'too-many-logs'
	if (description.includes('too many results') || /\bmore than\b.*\bresults\b/u.test(description)) return 'too-many-results'
	if (description.includes('response size') || description.includes('response too large') || description.includes('response body too large')) return 'response-size'
	if (description.includes('query timeout') || description.includes('query timed out') || description.includes('request timeout') || description.includes('request timed out')) return 'timeout'
	if (description.includes('block range') || description.includes('too wide') || description.includes('please reduce')) return 'block-range'
	if (description.includes('limit exceeded') || /\bexceeds? (?:the )?maximum\b/u.test(description) || description.includes('more than')) return 'result-limit'
	return undefined
}

export const preferredRpcDescriptions = (value: object): readonly string[] => {
	if ('details' in value && typeof value.details === 'string') return [value.details]
	if ('name' in value && (value.name === 'ResponseBodyTooLargeError' || value.name === 'TimeoutError')) return []
	if ('shortMessage' in value && typeof value.shortMessage === 'string') return [value.shortMessage]
	return 'message' in value && typeof value.message === 'string' ? [value.message] : []
}

export const rpcErrorCategory = (error: unknown): RpcDescriptionCategory | undefined => {
	const seen = new Set<unknown>()
	let firstCategory: RpcDescriptionCategory | undefined
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if ('status' in current && current.status === 429) return 'rate-limit'
		for (const description of preferredRpcDescriptions(current)) {
			const category = rpcDescriptionCategory(description)
			if (category === 'rate-limit') return category
			firstCategory ??= category
		}
		if ('name' in current && current.name === 'ResponseBodyTooLargeError') firstCategory ??= 'response-size'
		if ('name' in current && current.name === 'TimeoutError') firstCategory ??= 'timeout'
		if ('code' in current && current.code === -32005) firstCategory ??= 'result-limit'
		current = 'cause' in current ? current.cause : undefined
	}
	return firstCategory
}

export const isPermanentHistoricalCodeError = (error: unknown): boolean => {
	if (isPrunedHistoricalStateError(error)) return true
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if ('code' in current && current.code === -32601) return true
		for (const description of preferredRpcDescriptions(current)) {
			const normalized = classifiedRpcDescription(description)
			if (
				normalized.includes('missing trie node') ||
				normalized.includes('archive unavailable') ||
				normalized.includes('archive data unavailable') ||
				normalized.includes('archival data unavailable') ||
				normalized.includes('archive node required') ||
				normalized.includes('requires an archive node') ||
				normalized.includes('requires archive node') ||
				normalized.includes('historical state unavailable') ||
				normalized.includes('historical state is unavailable') ||
				normalized.includes('historical state not available') ||
				normalized.includes('historical state is not available') ||
				normalized.includes('historical data unavailable') ||
				normalized.includes('historical data is unavailable') ||
				normalized.includes('historical data not available') ||
				normalized.includes('historical data is not available') ||
				normalized.includes('pruned historical state') ||
				normalized.includes('historical state pruned') ||
				normalized.includes('method not found') ||
				normalized.includes('method not supported') ||
				normalized.includes('unsupported method')
			)
				return true
		}
		current = 'cause' in current ? current.cause : undefined
	}
	return false
}

export const isPermanentHistoricalLogError = (error: unknown): boolean => {
	const seen = new Set<unknown>()
	let getLogsRequest = false
	let prunedHistory = false
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if (current instanceof RpcRequestMethodError && current.method === 'eth_getLogs') getLogsRequest = true
		if ('code' in current && current.code === 4444) prunedHistory = true
		for (const description of preferredRpcDescriptions(current)) {
			const normalized = classifiedRpcDescription(description)
			if (normalized.includes('pruned history unavailable') || normalized.includes('historical logs unavailable')) prunedHistory = true
		}
		current = 'cause' in current ? current.cause : undefined
	}
	return getLogsRequest && prunedHistory
}

export const isPrunedHistoricalStateError = (error: unknown): boolean => {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		for (const description of preferredRpcDescriptions(current)) if (safePrunedStateProviderMessage(description) !== undefined) return true
		current = 'cause' in current ? current.cause : undefined
	}
	return false
}

export const readWithPrunedStateFallback = async <T>(requestedBlock: bigint, fallbackBlock: bigint, read: (blockNumber: bigint) => Promise<T>, onPrunedFallback: (requestedBlock: bigint, fallbackBlock: bigint) => Promise<void> = async () => {}): Promise<{ readonly blockNumber: bigint; readonly value: T }> => {
	try {
		return { blockNumber: requestedBlock, value: await read(requestedBlock) }
	} catch (error) {
		if (!isPrunedHistoricalStateError(error) || fallbackBlock <= requestedBlock) throw error
		const value = await read(fallbackBlock)
		await onPrunedFallback(requestedBlock, fallbackBlock)
		return { blockNumber: fallbackBlock, value }
	}
}

export const isSplittableLogRangeError = (error: unknown): boolean => {
	if (isPermanentHistoricalLogError(error)) return false
	const category = rpcErrorCategory(error)
	return category !== undefined && category !== 'rate-limit'
}

export const createLogClient = (rpcUrl: string, endpoint: string, queue: RpcRequestQueue, fetchFn: RpcFetchFn, retryDelay?: number): PublicClient =>
	createPublicClient({
		transport: withRpcRequestQueue(
			http(rpcUrl, {
				fetchFn,
				requestTimeout: 20_000,
				retryCount: 2,
				...(retryDelay === undefined ? {} : { retryDelay }),
			}),
			queue,
			endpoint,
		),
	})

const findEarliestAvailableLogBlock = async (startBlock: bigint, observedHead: bigint, logsAt: (blockNumber: bigint) => Promise<void>, startBlockKnownUnavailable = false): Promise<bigint> => {
	if (startBlock > observedHead) throw new Error('The log availability search start must not exceed the observed head')
	const isAvailable = async (blockNumber: bigint): Promise<boolean> => {
		try {
			await logsAt(blockNumber)
			return true
		} catch (error) {
			if (isPermanentHistoricalLogError(error)) return false
			throw error
		}
	}
	if (!startBlockKnownUnavailable && (await isAvailable(startBlock))) return startBlock
	if (!(await isAvailable(observedHead))) throw new ChainConfigurationError(`RPC cannot serve logs at observed head #${observedHead}`)
	let lower = startBlock
	let upper = observedHead
	while (lower + 1n < upper) {
		const middle = lower + (upper - lower) / 2n
		if (await isAvailable(middle)) upper = middle
		else lower = middle
	}
	return upper
}

export const findEarliestAvailableStateBlock = async (startBlock: bigint, observedHead: bigint, stateAt: (blockNumber: bigint) => Promise<void>, startBlockKnownUnavailable = false): Promise<bigint> => {
	if (startBlock > observedHead) throw new Error('The state availability search start must not exceed the observed head')
	const isAvailable = async (blockNumber: bigint): Promise<boolean> => {
		try {
			await stateAt(blockNumber)
			return true
		} catch (error) {
			if (isPrunedHistoricalStateError(error)) return false
			throw error
		}
	}
	if (!startBlockKnownUnavailable && (await isAvailable(startBlock))) return startBlock
	if (!(await isAvailable(observedHead))) throw new ChainConfigurationError(`RPC cannot serve state at observed head #${observedHead}`)
	let lower = startBlock
	let upper = observedHead
	while (lower + 1n < upper) {
		const middle = lower + (upper - lower) / 2n
		if (await isAvailable(middle)) upper = middle
		else lower = middle
	}
	return upper
}

export const findEarliestAvailableLogProvider = async <TProvider>(
	providers: readonly TProvider[],
	startBlock: bigint,
	observedHead: (provider: TProvider) => Promise<bigint>,
	logsAt: (provider: TProvider, blockNumber: bigint) => Promise<void>,
	reportProviderFailure: (provider: TProvider, error: unknown) => void = () => {},
): Promise<{ readonly provider: TProvider; readonly startBlock: bigint } | undefined> => {
	let earliest: { readonly provider: TProvider; readonly startBlock: bigint } | undefined
	for (const provider of providers) {
		try {
			const head = await observedHead(provider)
			if (head < startBlock) continue
			const availableStart = await findEarliestAvailableLogBlock(startBlock, head, blockNumber => logsAt(provider, blockNumber))
			if (earliest === undefined || availableStart < earliest.startBlock) earliest = { provider, startBlock: availableStart }
		} catch (error) {
			if (!(error instanceof ChainConfigurationError) && !(error instanceof RpcRequestMethodError)) throw error
			reportProviderFailure(provider, error)
			// Recovery is best-effort across providers. The lifecycle retains the
			// original failure when none can establish a usable log boundary.
		}
	}
	return earliest
}

export const labelsFrom = (contracts: ReadonlyMap<string, ContractMetadata>): Map<string, string> => new Map([['0x0000000000000000000000000000000000000000', 'Zero address'], ...[...contracts].map(([address, contract]) => [address, contract.label] as const)])

export const jsonEvidence = (value: unknown): unknown => {
	if (typeof value === 'bigint') return value.toString()
	if (Array.isArray(value)) return value.map(jsonEvidence)
	if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonEvidence(item)]))
	return value
}

export const addressActivityFrom = (transactions: readonly StoredTransaction[], logs: readonly StoredLog[], contracts: ReadonlyMap<string, ContractMetadata>): readonly AddressActivity[] => {
	const result = new Map<string, AddressActivity>()
	for (const transaction of transactions) {
		const transactionLogs = logs.filter(log => log.transactionHash === transaction.hash)
		const referencedAddresses = [...(transaction.decoded.referencedAddresses ?? []), ...transactionLogs.flatMap(log => log.decoded.referencedAddresses ?? [])]
		const pools = new Set<Address>()
		if (transaction.to !== null && contracts.get(transaction.to.toLowerCase())?.kind === 'securityPool') pools.add(transaction.to)
		for (const log of transactionLogs) if (contracts.get(log.address.toLowerCase())?.kind === 'securityPool') pools.add(log.address)
		for (const candidate of referencedAddresses) {
			if (contracts.get(candidate.toLowerCase())?.kind === 'securityPool') pools.add(candidate)
		}
		const participants = new Map<string, { address: Address; role: 'sender' | 'referenced' }>()
		participants.set(transaction.from.toLowerCase(), { address: transaction.from, role: 'sender' })
		for (const candidate of referencedAddresses) {
			if (!participants.has(candidate.toLowerCase())) participants.set(candidate.toLowerCase(), { address: candidate, role: 'referenced' })
		}
		const associatedPools: readonly (Address | undefined)[] = pools.size === 0 ? [undefined] : [...pools]
		for (const participant of participants.values()) {
			for (const poolAddress of associatedPools) {
				const key = `${transaction.hash}:${participant.address.toLowerCase()}:${poolAddress?.toLowerCase() ?? zeroAddress}`
				result.set(key, {
					transactionHash: transaction.hash,
					address: participant.address,
					role: participant.role,
					...(poolAddress === undefined ? {} : { poolAddress }),
				})
			}
		}
	}
	return [...result.values()]
}

export const requireLogPosition = (log: Log): { transactionHash: Hash; transactionIndex: number; logIndex: number; blockHash: Hash; blockNumber: bigint } => {
	if (log.transactionHash === undefined || log.transactionIndex === undefined || log.logIndex === undefined || log.blockHash === undefined || log.blockNumber === undefined) {
		throw new Error('RPC returned a pending log while indexing a confirmed block')
	}
	const transactionIndex = bigintToSafeNumber(log.transactionIndex, 'RPC log transaction index')
	const logIndex = bigintToSafeNumber(log.logIndex, 'RPC log index')
	return {
		transactionHash: log.transactionHash,
		transactionIndex,
		logIndex,
		blockHash: log.blockHash,
		blockNumber: log.blockNumber,
	}
}

export class ChainContinuityError extends Error {}
export class ChainConfigurationError extends Error {}
export class LeaseLostError extends Error {}

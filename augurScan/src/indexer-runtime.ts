import { type AddressActivity, DatabaseConsistencyError, databaseConsistencyDiagnosticMessage, type IndexerLease, type StoredTransaction } from './database.ts'
import { errorChainIncludes } from './error-chain.ts'
import { type Address, type Hash, type Log, type PublicClient, type TransactionReceipt, zeroAddress } from './ethereum.ts'
import { jsonRpcErrorName, safeRpcProviderMessage } from './logging.ts'
import { RpcRequestMethodError, rpcQueueSaturationFrom } from './rpc-request-queue.ts'
import { bigintToSafeNumber } from './time.ts'
import type { ContractMetadata, StoredLog } from './types.ts'

export const waitForIndexerDelay = (milliseconds: number, signal: AbortSignal): Promise<void> =>
	new Promise((resolve) => {
		const finish = (): void => {
			clearTimeout(timeout)
			signal.removeEventListener('abort', finish)
			resolve()
		}
		const timeout = setTimeout(finish, milliseconds)
		if (signal.aborted) finish()
		else signal.addEventListener('abort', finish, { once: true })
	})

const normalizedRpcDescription = (value: string): string =>
	[...value]
		.map((character) => {
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

const singleLineErrorDescription = (value: string): string =>
	[...withoutAnsiControlSequences(value)]
		.map((character) => {
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

type RpcDescriptionCategory = 'block-range' | 'rate-limit' | 'response-size' | 'result-limit' | 'timeout' | 'too-many-logs' | 'too-many-results'

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
	if (description.includes('response size') || description.includes('response too large') || description.includes('response body too large'))
		return 'response-size'
	if (
		description.includes('query timeout') ||
		description.includes('query timed out') ||
		description.includes('request timeout') ||
		description.includes('request timed out')
	)
		return 'timeout'
	if (description.includes('block range') || description.includes('too wide') || description.includes('please reduce')) return 'block-range'
	if (description.includes('limit exceeded') || /\bexceeds? (?:the )?maximum\b/u.test(description) || description.includes('more than')) return 'result-limit'
	return undefined
}

const preferredRpcDescriptions = (value: object): readonly string[] => {
	if ('details' in value && typeof value.details === 'string') return [value.details]
	if ('name' in value && (value.name === 'ResponseBodyTooLargeError' || value.name === 'TimeoutError')) return []
	if ('shortMessage' in value && typeof value.shortMessage === 'string') return [value.shortMessage]
	return 'message' in value && typeof value.message === 'string' ? [value.message] : []
}

const rpcErrorCategory = (error: unknown): RpcDescriptionCategory | undefined => {
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

const isPrunedHistoricalStateError = (error: unknown): boolean => {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		for (const description of preferredRpcDescriptions(current)) {
			const normalized = classifiedRpcDescription(description)
			if (
				normalized.includes('missing trie node') ||
				normalized.includes('pruned historical state') ||
				normalized.includes('historical state pruned') ||
				/^state at block (?:[0-9]+|0x[0-9a-f]+) is pruned$/u.test(normalized)
			)
				return true
		}
		current = 'cause' in current ? current.cause : undefined
	}
	return false
}

export const isSplittableLogRangeError = (error: unknown): boolean => {
	const category = rpcErrorCategory(error)
	return category !== undefined && category !== 'rate-limit'
}

export const labelsFrom = (contracts: ReadonlyMap<string, ContractMetadata>): Map<string, string> =>
	new Map([['0x0000000000000000000000000000000000000000', 'Zero address'], ...[...contracts].map(([address, contract]) => [address, contract.label] as const)])

export const jsonEvidence = (value: unknown): unknown => {
	if (typeof value === 'bigint') return value.toString()
	if (Array.isArray(value)) return value.map(jsonEvidence)
	if (typeof value === 'object' && value !== null) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, jsonEvidence(item)]))
	return value
}

export const addressActivityFrom = (
	transactions: readonly StoredTransaction[],
	logs: readonly StoredLog[],
	contracts: ReadonlyMap<string, ContractMetadata>,
): readonly AddressActivity[] => {
	const result = new Map<string, AddressActivity>()
	for (const transaction of transactions) {
		const transactionLogs = logs.filter((log) => log.transactionHash === transaction.hash)
		const referencedAddresses = [...(transaction.decoded.referencedAddresses ?? []), ...transactionLogs.flatMap((log) => log.decoded.referencedAddresses ?? [])]
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
	if (
		log.transactionHash === undefined ||
		log.transactionIndex === undefined ||
		log.logIndex === undefined ||
		log.blockHash === undefined ||
		log.blockNumber === undefined
	) {
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

export const queryCanonicalLogRange = async <T>(
	throughBlock: bigint,
	readEndBlockHash: () => Promise<Hash>,
	query: () => Promise<readonly T[]>,
): Promise<{ readonly items: readonly T[]; readonly endBlockHash: Hash }> => {
	const before = await readEndBlockHash()
	const items = await query()
	const after = await readEndBlockHash()
	if (before !== after) throw new ChainContinuityError(`Canonical chain changed while querying logs through block ${throughBlock}`)
	return { items, endBlockHash: after }
}

type ChainProvider = { readonly getChainId: () => Promise<number> }
export type RpcProvider = ChainProvider & { readonly client: PublicClient; readonly endpoint: string; readonly number: number }

export const rpcEndpointLabel = (rpcUrl: string): string => {
	const url = new URL(rpcUrl)
	const hostnameParts = url.hostname.split('.')
	const isLocalOrIp = url.hostname === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(url.hostname) || url.hostname.includes(':')
	const hostname = !isLocalOrIp && hostnameParts.length > 2 ? `*.${hostnameParts.slice(-2).join('.')}` : url.hostname
	return `${url.protocol}//${hostname}${url.port === '' ? '' : `:${url.port}`}`
}

export const rpcProviderLabel = (rpcUrl: string, index: number): string => `#${index + 1} ${rpcEndpointLabel(rpcUrl)}`

export const rpcFailureLogMessage = (message: string, endpoint: string, reason?: string): string =>
	`${message} (RPC: ${endpoint}${reason === undefined ? '' : `; reason: ${reason}`})`

export const withVerifiedProvider = async <TProvider extends ChainProvider, TResult>(
	providers: readonly TProvider[],
	chainId: number,
	operation: (provider: TProvider) => Promise<TResult>,
	stopFailover = (_error: unknown): boolean => false,
	onAttempt = (_provider: TProvider): void => {},
	verifiedProviders?: WeakSet<TProvider>,
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

export const commitCanonicalRead = async <T>(
	number: bigint,
	expectedHash: Hash,
	read: () => Promise<T>,
	lookup: (blockNumber: bigint) => Promise<Hash>,
	commit: (value: T) => Promise<void>,
): Promise<void> => {
	const value = await read()
	await confirmCanonicalBlock(number, expectedHash, lookup)
	await commit(value)
}

export const databaseFailureMessage = 'Database request failed; retrying'
export const rpcQueueSaturatedMessage = 'RPC queue saturated; retrying'
const databaseFailureNames = new Set(['DatabaseConsistencyError', 'PostgresError'])
export const leaseFailureNames = new Set([...databaseFailureNames, 'LeaseLostError'])

export const isLocalIndexerFailure = (error: unknown): boolean =>
	error instanceof LeaseLostError || rpcQueueSaturationFrom(error) !== undefined || errorChainIncludes(error, databaseFailureNames)

export const indexingCompletion = (configuredStartBlock: bigint, indexedBlock: bigint, observedHead: bigint) => {
	if (observedHead < configuredStartBlock) return { completedBlocks: 0n, percentage: '100.00', remainingBlocks: 0n, totalBlocks: 0n }
	const boundedHead = observedHead
	const totalBlocks = boundedHead - configuredStartBlock + 1n
	const boundedIndexed = indexedBlock < configuredStartBlock ? configuredStartBlock - 1n : indexedBlock > boundedHead ? boundedHead : indexedBlock
	const completedBlocks = boundedIndexed - configuredStartBlock + 1n
	const remainingBlocks = totalBlocks - completedBlocks
	const roundedHundredths = (completedBlocks * 10_000n + totalBlocks / 2n) / totalBlocks
	const hundredths = remainingBlocks > 0n && roundedHundredths >= 10_000n ? 9_999n : roundedHundredths
	return {
		completedBlocks,
		percentage: `${hundredths / 100n}.${String(hundredths % 100n).padStart(2, '0')}`,
		remainingBlocks,
		totalBlocks,
	}
}

export const compactIndexerDuration = (seconds: number): string => {
	const rounded = Math.max(1, Math.ceil(seconds))
	if (rounded < 60) return `${rounded}s`
	if (rounded < 3_600) return `${Math.floor(rounded / 60)}m ${rounded % 60}s`
	const totalHours = Math.ceil(rounded / 3_600)
	if (totalHours < 24) {
		const totalMinutes = Math.ceil(rounded / 60)
		const minutes = totalMinutes % 60
		return `${Math.floor(totalMinutes / 60)}h${minutes === 0 ? '' : ` ${minutes}m`}`
	}
	const hours = totalHours % 24
	return `${Math.floor(totalHours / 24)}d${hours === 0 ? '' : ` ${hours}h`}`
}

export const indexerWaitingMessage = (networkId: string, configuredStartBlock: bigint, observedHead: bigint): string =>
	`[${networkId}] indexer state: live; observed head #${observedHead}; 100.00% complete; caught up; waiting for configured start block #${configuredStartBlock}`

export const indexerProgressMessage = (
	networkId: string,
	startBlock: bigint,
	endBlock: bigint,
	observedHead: bigint,
	configuredStartBlock: bigint,
	blocksPerSecond?: number,
): string => {
	const state = endBlock >= observedHead ? 'live' : 'backfilling'
	const indexed = startBlock === endBlock ? `indexed block #${endBlock}` : `indexed blocks #${startBlock}–#${endBlock}`
	const completion = indexingCompletion(configuredStartBlock, endBlock, observedHead)
	const progress =
		state === 'live'
			? 'caught up'
			: `${completion.remainingBlocks} blocks behind; ${blocksPerSecond === undefined ? 'estimating ETA' : `ETA ${compactIndexerDuration(bigintToSafeNumber(completion.remainingBlocks, 'Remaining block count') / blocksPerSecond)}`}`
	return `[${networkId}] indexer state: ${state}; ${indexed}; observed head #${observedHead}; ${completion.percentage}% complete; ${progress}`
}

export const safeIndexerFailure = (error: unknown): string => {
	if (error instanceof ChainConfigurationError) return error.message
	if (error instanceof ChainContinuityError) return 'The remote canonical chain changed while indexing; retrying'
	if (rpcQueueSaturationFrom(error) !== undefined) return rpcQueueSaturatedMessage
	if (errorChainIncludes(error, databaseFailureNames)) return databaseFailureMessage
	return 'RPC request failed; retrying'
}

const safeErrorNames = new Set([
	'AbortError',
	'ChainConfigurationError',
	'ChainContinuityError',
	'ConnectTimeoutError',
	'ContractFunctionExecutionError',
	'ContractFunctionRevertedError',
	'DatabaseConsistencyError',
	'Error',
	'HeadersTimeoutError',
	'HttpRequestError',
	'IndexerOwnershipStageError',
	'LeaseLostError',
	'LimitExceededRpcError',
	'PostgresError',
	'ResponseBodyTooLargeError',
	'ResourceUnavailableRpcError',
	'RpcQueueSaturatedError',
	'RpcError',
	'RpcRequestMethodError',
	'RpcRequestError',
	'SocketError',
	'TimeoutError',
	'TypeError',
	'UnknownNodeError',
	'UnknownRpcError',
])

const safeErrorIdentifier = (value: unknown): string | undefined => (typeof value === 'string' && safeErrorNames.has(value) ? value : undefined)

const safeNamedErrorCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT', 'ERR_POSTGRES_CONNECTION_CLOSED'])

const safeErrorCode = (value: unknown): string | undefined => {
	if (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		(value === -32700 || (value >= -32603 && value <= -32600) || (value >= -32099 && value <= -32000))
	)
		return value.toString()
	return typeof value === 'string' && (/^HTTP_[1-5][0-9]{2}$/.test(value) || safeNamedErrorCodes.has(value)) ? value : undefined
}

const safeStandardRpcMessages = new Map([
	['parse error', 'Parse error'],
	['invalid request', 'Invalid Request'],
	['method not found', 'Method not found'],
	['invalid params', 'Invalid params'],
	['internal error', 'Internal error'],
])

const safeRpcCategoryMessages: Readonly<Record<RpcDescriptionCategory, string>> = {
	'block-range': 'provider rejected the requested block range',
	'rate-limit': 'provider rate limit exceeded',
	'response-size': 'provider response size limit exceeded',
	'result-limit': 'provider result limit exceeded',
	timeout: 'provider request timed out',
	'too-many-logs': 'provider returned too many logs',
	'too-many-results': 'provider returned too many results',
}

const safeStandardRpcProviderMessage = (value: unknown): string | undefined => {
	if (typeof value !== 'string') return undefined
	const normalized = normalizedRpcDescription(value)
	return safeStandardRpcMessages.get(normalized.replace(/[.!]$/u, '')) ?? safeRpcProviderMessage(value)
}

const safeRpcRequestMethod = (value: unknown): string | undefined =>
	typeof value === 'string' && /^(?:eth|net|web3)_[A-Za-z0-9_]+$/u.test(value) ? value : undefined

const rpcRequestMethodFrom = (error: unknown): string | undefined => {
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		const method = current instanceof RpcRequestMethodError ? safeRpcRequestMethod(current.method) : undefined
		if (method !== undefined) return method
		current = 'cause' in current ? current.cause : undefined
	}
	return undefined
}

const indexerFailureReason = (error: unknown, includeErrorDescriptions: boolean): string => {
	const saturation = rpcQueueSaturationFrom(error)
	if (saturation !== undefined)
		return `RpcQueueSaturatedError; active ${saturation.active}; queued ${saturation.pending}; maximum queued ${saturation.maximumPending}; high-water mark ${saturation.highWaterMark}; saturation count ${saturation.saturationCount}`
	const names: string[] = []
	const descriptions: string[] = []
	let status: number | undefined
	let code: string | undefined
	let rpcEndpoint: string | undefined
	let standardMessage: string | undefined
	let previousDescriptionName: string | undefined
	let previousDescriptionMessage: string | undefined
	const seen = new Set<unknown>()
	let current: unknown = error
	while (current !== undefined && !seen.has(current)) {
		seen.add(current)
		if (typeof current !== 'object' || current === null) {
			descriptions.push(`UnknownError: ${singleLineErrorDescription(String(current))}`)
			break
		}
		const actualName = 'name' in current && typeof current.name === 'string' ? singleLineErrorDescription(current.name) || undefined : undefined
		const name = safeErrorIdentifier(actualName)
		if (name !== undefined && names.at(-1) !== name) names.push(name)
		const actualMessage =
			singleLineErrorDescription(
				preferredRpcDescriptions(current)
					.find((value) => value.trim() !== '')
					?.trim() ?? '',
			) || undefined
		if (actualName !== undefined || actualMessage !== undefined) {
			if (actualMessage !== undefined && actualMessage === previousDescriptionMessage) {
				if (actualName !== undefined && actualName !== previousDescriptionName) descriptions.push(actualName)
			} else {
				const descriptionName = actualName ?? 'UnknownError'
				descriptions.push(actualMessage === undefined ? descriptionName : `${descriptionName}: ${actualMessage}`)
			}
			previousDescriptionName = actualName
			previousDescriptionMessage = actualMessage
		}
		if (
			status === undefined &&
			'status' in current &&
			typeof current.status === 'number' &&
			Number.isInteger(current.status) &&
			current.status >= 100 &&
			current.status <= 599
		)
			status = current.status
		if (code === undefined && 'code' in current) code = safeErrorCode(current.code)
		if (rpcEndpoint === undefined && current instanceof RpcRequestMethodError) rpcEndpoint = current.endpoint
		if (standardMessage === undefined) {
			for (const description of preferredRpcDescriptions(current)) {
				standardMessage = safeRpcProviderMessage(description)
				if (standardMessage !== undefined) break
			}
		}
		if (standardMessage === undefined && name === 'RpcRequestError' && 'details' in current) standardMessage = safeStandardRpcProviderMessage(current.details)
		current = 'cause' in current ? current.cause : undefined
	}
	const category = rpcErrorCategory(error)
	const message = category === undefined ? standardMessage : safeRpcCategoryMessages[category]
	const fallbackDescription = descriptions.length === 0 ? 'UnknownError' : descriptions.slice(0, 4).join(' caused by ')
	const details = [
		includeErrorDescriptions && message === undefined ? fallbackDescription : names.length === 0 ? 'UnknownError' : names.slice(0, 4).join(' caused by '),
	]
	const method = rpcRequestMethodFrom(error)
	if (method !== undefined) details.push(`method ${method}`)
	if (rpcEndpoint !== undefined) details.push(`RPC ${rpcEndpoint}`)
	if (status !== undefined) details.push(`HTTP ${status}`)
	if (code !== undefined) {
		const numericCode = Number(code)
		const codeName = Number.isInteger(numericCode) ? jsonRpcErrorName(numericCode) : undefined
		details.push(`code ${code}${codeName === undefined ? '' : ` (${codeName})`}`)
	}
	if (message !== undefined) details.push(`message: ${message}`)
	return details.join('; ')
}

export const safeIndexerFailureReason = (error: unknown): string => indexerFailureReason(error, false)

export const rpcIndexerFailureReason = (error: unknown): string => indexerFailureReason(error, true)

const rpcFailureReason = (error: unknown, rpcNumber: number): string => `RPC #${rpcNumber}: ${rpcIndexerFailureReason(error)}`

type RpcDiagnosticProvider = Pick<RpcProvider, 'endpoint' | 'number'>

export const createRpcDiagnosticContext = (initialProvider: RpcDiagnosticProvider) => {
	let activeProvider = initialProvider
	return {
		activeEndpoint: (): string => activeProvider.endpoint,
		activeNumber: (): number => activeProvider.number,
		failureReason: (error: unknown): string => rpcFailureReason(error, activeProvider.number),
		select: (provider: RpcDiagnosticProvider): void => {
			activeProvider = provider
		},
	}
}

export const indexerOperationFailureReason = (error: unknown, rpcNumber: number, source: 'rpc' | 'storage'): string =>
	source === 'rpc' ? rpcFailureReason(error, rpcNumber) : safeIndexerFailureReason(error)

const deploymentReadTimeoutError = (): Error => {
	const error = new Error('Contract deployment history read timed out')
	error.name = 'TimeoutError'
	return error
}

export const boundedDeploymentRead = async <T>(read: () => Promise<T>, timeoutMs: number): Promise<T> =>
	await new Promise<T>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(deploymentReadTimeoutError())
		}, timeoutMs)
		void read()
			.then(resolve, reject)
			.finally(() => clearTimeout(timeout))
	})

export const deploymentReadBudget = (timeoutMs = 5_000, now = Date.now): (<T>(read: () => Promise<T>) => Promise<T>) => {
	const deadline = now() + timeoutMs
	return async <T>(read: () => Promise<T>): Promise<T> => {
		const remaining = deadline - now()
		if (remaining <= 0) throw deploymentReadTimeoutError()
		const value = await boundedDeploymentRead(read, remaining)
		if (now() > deadline) throw deploymentReadTimeoutError()
		return value
	}
}

export const contractDeploymentScanDue = (lastCompletedAt: number | undefined, now: number, cooldownMs = 60_000): boolean =>
	lastCompletedAt === undefined || now - lastCompletedAt >= cooldownMs

export const contractDeploymentCandidateFrom = (
	candidates: readonly ContractMetadata[],
	historicalCodeUnavailable: ReadonlySet<string>,
): ContractMetadata | undefined => candidates.find(({ address }) => !historicalCodeUnavailable.has(address.toLowerCase()))

export const readHistoricalCodeWithPermanentFallback = async <T>(
	read: () => Promise<T>,
	onHistoricalCodeUnavailable: (error: unknown) => void,
): Promise<{ readonly status: 'success'; readonly value: T } | { readonly status: 'unavailable' }> => {
	try {
		return { status: 'success', value: await read() }
	} catch (error) {
		if (!isPermanentHistoricalCodeError(error)) throw error
		onHistoricalCodeUnavailable(error)
		return { status: 'unavailable' }
	}
}

type NetworkLifecycle = {
	readonly verify: () => Promise<void>
	readonly poll: () => Promise<boolean>
	readonly failure: (message: string, nextRetryAt: Date, reason: string) => Promise<void>
	readonly intervalMs: number
	readonly signal: AbortSignal
	readonly random?: () => number
	readonly shouldRethrow?: (error: unknown) => boolean
}

export class IndexerOwnershipStageError extends Error {
	override name = 'IndexerOwnershipStageError'

	constructor(
		readonly stage: OwnershipStage,
		cause: unknown,
	) {
		super(`Indexer ownership stage failed: ${stage}`, { cause })
	}
}

export const retryDelayMs = (consecutiveFailures: number, intervalMs: number, random = Math.random): number => {
	const exponent = Math.min(Math.max(consecutiveFailures - 1, 0), 8)
	const base = Math.min(intervalMs * 2 ** exponent, 300_000)
	return Math.min(Math.round(base * (0.8 + random() * 0.4)), 300_000)
}

export const runNetworkLifecycle = async ({ verify, poll, failure, intervalMs, signal, random, shouldRethrow }: NetworkLifecycle): Promise<void> => {
	let verified = false
	let consecutiveFailures = 0
	while (!signal.aborted) {
		const startedAt = Date.now()
		let caughtUp = true
		let delayAfterFailure: number | undefined
		try {
			if (!verified) {
				await verify()
				verified = true
			}
			caughtUp = await poll()
			consecutiveFailures = 0
		} catch (error) {
			if (error instanceof LeaseLostError || shouldRethrow?.(error) === true) throw error
			consecutiveFailures++
			delayAfterFailure = retryDelayMs(consecutiveFailures, intervalMs, random)
			try {
				const failureMessage = safeIndexerFailure(error)
				const failureReason = failureMessage === 'RPC request failed; retrying' ? rpcIndexerFailureReason(error) : safeIndexerFailureReason(error)
				await failure(failureMessage, new Date(Date.now() + delayAfterFailure), failureReason)
			} catch (failureError) {
				throw new IndexerOwnershipStageError('record-failure', failureError)
			}
		}
		await waitForIndexerDelay(delayAfterFailure ?? (caughtUp ? Math.max(0, intervalMs - (Date.now() - startedAt)) : 0), signal)
	}
}

type OwnedNetworkLifecycle = Omit<NetworkLifecycle, 'verify' | 'poll'> & {
	readonly reconcile: () => Promise<void>
	readonly poll: () => Promise<boolean>
	readonly runWithProvider: <T>(operation: () => Promise<T>) => Promise<T>
}

export const runOwnedNetworkLifecycle = async ({ reconcile, poll, runWithProvider, ...lifecycle }: OwnedNetworkLifecycle): Promise<void> =>
	await runNetworkLifecycle({
		...lifecycle,
		verify: () => runWithProvider(reconcile),
		poll: () => runWithProvider(poll),
		shouldRethrow: (error) => error instanceof DatabaseConsistencyError || lifecycle.shouldRethrow?.(error) === true,
	})

type LeaseControl = Pick<IndexerLease, 'assertHeld' | 'release'> & { readonly backendPid?: number }

type OwnershipStage = 'acquire' | 'verify' | 'seed' | 'owned-run' | 'record-failure' | 'release'

export type IndexerOwnershipEvent =
	| {
			readonly type: 'failure'
			readonly stage: OwnershipStage
			readonly consecutiveFailures: number
			readonly retryDelayMs: number
			readonly backendPid?: number
	  }
	| { readonly type: 'acquired'; readonly backendPid?: number; readonly recoveredAfterFailures: number; readonly acquiredAfterStandby: boolean }
	| { readonly type: 'released'; readonly backendPid?: number }
	| { readonly type: 'standby' }

export type IndexerOwnershipStatus = {
	readonly networkId: string
	readonly active: boolean
	readonly backendPid?: number
	readonly failuresTotal: number
	readonly reacquisitionsTotal: number
	readonly consecutiveFailures: number
	readonly lastFailureAt?: string
	readonly lastFailureStage?: OwnershipStage
}

const ownershipStatuses = new Map<string, IndexerOwnershipStatus>()

export const nextIndexerOwnershipStatus = (
	networkId: string,
	current: IndexerOwnershipStatus | undefined,
	event: IndexerOwnershipEvent,
	now = new Date(),
): IndexerOwnershipStatus => {
	const previous = current ?? {
		networkId,
		active: false,
		failuresTotal: 0,
		reacquisitionsTotal: 0,
		consecutiveFailures: 0,
	}
	if (event.type === 'failure') {
		return {
			...previous,
			active: false,
			...(event.backendPid === undefined ? {} : { backendPid: event.backendPid }),
			failuresTotal: previous.failuresTotal + 1,
			consecutiveFailures: event.consecutiveFailures,
			lastFailureAt: now.toISOString(),
			lastFailureStage: event.stage,
		}
	}
	if (event.type === 'acquired') {
		return {
			...previous,
			active: true,
			...(event.backendPid === undefined ? {} : { backendPid: event.backendPid }),
			reacquisitionsTotal: previous.reacquisitionsTotal + (event.recoveredAfterFailures > 0 || event.acquiredAfterStandby ? 1 : 0),
			consecutiveFailures: 0,
		}
	}
	return {
		...previous,
		active: false,
		backendPid: undefined,
		consecutiveFailures: event.type === 'standby' ? 0 : previous.consecutiveFailures,
	}
}

export const recordOwnershipEvent = (networkId: string, event: IndexerOwnershipEvent): void => {
	ownershipStatuses.set(networkId, nextIndexerOwnershipStatus(networkId, ownershipStatuses.get(networkId), event))
}

export const indexerOwnershipStatuses = (): readonly IndexerOwnershipStatus[] =>
	[...ownershipStatuses.values()].sort((left, right) => left.networkId.localeCompare(right.networkId))

const ownershipFailureReason = (error: unknown): string => {
	const reason = safeIndexerFailureReason(error)
	const seen = new Set<unknown>()
	let current: unknown = error
	while (typeof current === 'object' && current !== null && !seen.has(current)) {
		seen.add(current)
		if (current instanceof DatabaseConsistencyError) {
			const detail = databaseConsistencyDiagnosticMessage(current)
			if (detail !== undefined) return `${reason}: ${detail}`
		}
		current = 'cause' in current ? current.cause : undefined
	}
	return reason
}

export const ownershipFailureLogMessage = (
	networkId: string,
	stage: OwnershipStage,
	error: unknown,
	consecutiveFailures: number,
	retryDelay: number,
	backendPid?: number,
): string =>
	`[${networkId}] indexer ownership failed; stage: ${stage}; consecutive failures: ${consecutiveFailures}; retry delay: ${retryDelay}ms; backend PID: ${backendPid ?? 'unavailable'}; reason: ${ownershipFailureReason(error)}`

type OwnershipLifecycle<TLease extends LeaseControl> = {
	readonly networkId: string
	readonly acquire: () => Promise<TLease | undefined>
	readonly seed: (lease: TLease) => Promise<void>
	readonly runOwned: (lease: TLease) => Promise<void>
	readonly failure: (message: string, lease: TLease | undefined) => Promise<void>
	readonly standby: () => void
	readonly intervalMs: number
	readonly now?: () => number
	readonly onEvent?: (event: IndexerOwnershipEvent) => void
	readonly random?: () => number
	readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>
	readonly signal: AbortSignal
}

export const runIndexerOwnershipLifecycle = async <TLease extends LeaseControl>({
	networkId,
	acquire,
	seed,
	runOwned,
	failure,
	standby,
	intervalMs,
	now = Date.now,
	onEvent = () => {},
	random,
	wait = waitForIndexerDelay,
	signal,
}: OwnershipLifecycle<TLease>): Promise<void> => {
	let standbyReported = false
	let wasStandby = false
	let consecutiveFailures = 0
	while (!signal.aborted) {
		let lease: TLease | undefined
		let ownedRunStartedAt: number | undefined
		let stage: OwnershipStage = 'acquire'
		let retryDelay: number | undefined
		try {
			lease = await acquire()
			if (lease === undefined) {
				consecutiveFailures = 0
				wasStandby = true
				if (!standbyReported) {
					standby()
					onEvent({ type: 'standby' })
					standbyReported = true
				}
			} else {
				standbyReported = false
				stage = 'verify'
				await lease.assertHeld()
				stage = 'seed'
				await seed(lease)
				const recoveredAfterFailures = consecutiveFailures
				const acquiredAfterStandby = wasStandby
				onEvent({
					type: 'acquired',
					...(lease.backendPid === undefined ? {} : { backendPid: lease.backendPid }),
					recoveredAfterFailures,
					acquiredAfterStandby,
				})
				if (recoveredAfterFailures > 0 || acquiredAfterStandby) {
					const source = acquiredAfterStandby ? (recoveredAfterFailures > 0 ? 'standby and failures' : 'standby') : 'failures'
					console.info(
						`[${networkId}] indexer ownership reacquired; backend PID: ${lease.backendPid ?? 'unavailable'}; source: ${source}; previous consecutive failures: ${recoveredAfterFailures}`,
					)
				}
				wasStandby = false
				stage = 'owned-run'
				ownedRunStartedAt = now()
				await runOwned(lease)
				consecutiveFailures = 0
			}
		} catch (error) {
			const failureStage = error instanceof IndexerOwnershipStageError ? error.stage : stage
			if (failureStage === 'owned-run' && ownedRunStartedAt !== undefined && now() - ownedRunStartedAt >= Math.max(intervalMs * 4, 60_000))
				consecutiveFailures = 0
			consecutiveFailures++
			retryDelay = retryDelayMs(consecutiveFailures, intervalMs, random)
			onEvent({
				type: 'failure',
				stage: failureStage,
				consecutiveFailures,
				retryDelayMs: retryDelay,
				...(lease?.backendPid === undefined ? {} : { backendPid: lease.backendPid }),
			})
			console.error(ownershipFailureLogMessage(networkId, failureStage, error, consecutiveFailures, retryDelay, lease?.backendPid))
			try {
				await failure(databaseFailureMessage, lease)
			} catch (error) {
				console.error(ownershipFailureLogMessage(networkId, 'record-failure', error, consecutiveFailures, retryDelay, lease?.backendPid))
				// A database outage can prevent status recording too; retry ownership regardless.
			}
		} finally {
			try {
				await lease?.release()
			} catch (error) {
				if (retryDelay === undefined) {
					consecutiveFailures++
					retryDelay = retryDelayMs(consecutiveFailures, intervalMs, random)
					onEvent({
						type: 'failure',
						stage: 'release',
						consecutiveFailures,
						retryDelayMs: retryDelay,
						...(lease?.backendPid === undefined ? {} : { backendPid: lease.backendPid }),
					})
				}
				console.error(ownershipFailureLogMessage(networkId, 'release', error, consecutiveFailures, retryDelay, lease?.backendPid))
				// PostgreSQL already releases advisory locks when their session is lost.
			}
			if (lease !== undefined) onEvent({ type: 'released', ...(lease.backendPid === undefined ? {} : { backendPid: lease.backendPid }) })
		}
		if (!signal.aborted) await wait(retryDelay ?? intervalMs, signal)
	}
}

export const isProtocolActivitySource = (contract: ContractMetadata | undefined): boolean =>
	contract !== undefined &&
	contract.kind !== 'weth' &&
	contract.kind !== 'usdc' &&
	contract.kind !== 'reputationToken' &&
	contract.kind !== 'multicall3' &&
	contract.kind !== 'proxyDeployer' &&
	contract.kind !== 'scalarOutcomes'

export const indexerLogSources = (contracts: readonly ContractMetadata[]): readonly ContractMetadata[] =>
	contracts.filter((contract) => isProtocolActivitySource(contract) || contract.kind === 'reputationToken')

export const discoveryLogAddresses = (discoveredAddresses: readonly Address[], contracts: ReadonlyMap<string, ContractMetadata>): readonly Address[] => {
	const sources = discoveredAddresses.filter((address) => {
		const contract = contracts.get(address.toLowerCase())
		return isProtocolActivitySource(contract) || contract?.kind === 'reputationToken'
	})
	if (!sources.some((address) => contracts.get(address.toLowerCase())?.kind === 'reputationToken')) return sources
	const addresses = [
		...sources,
		...[...contracts.values()]
			.filter(({ kind }) => kind === 'uniswapV2Factory' || kind === 'uniswapV3Factory' || kind === 'uniswapV4PoolManager')
			.map(({ address }) => address),
	]
	return [...new Map(addresses.map((address) => [address.toLowerCase(), address])).values()]
}

export const scanDiscoveredLogCoverage = async (
	blockNumber: bigint,
	segmentEnd: bigint,
	discoveredAddresses: readonly Address[],
	contracts: ReadonlyMap<string, ContractMetadata>,
	getCurrentBlockLogs: (addresses: readonly Address[]) => Promise<readonly Log[]>,
	getRemainingLogs: (fromBlock: bigint, toBlock: bigint, addresses: readonly Address[]) => Promise<readonly Log[]>,
): Promise<{ readonly currentBlockLogs: readonly Log[]; readonly remainingLogs: readonly Log[] }> => {
	const addresses = discoveryLogAddresses(discoveredAddresses, contracts)
	if (addresses.length === 0) return { currentBlockLogs: [], remainingLogs: [] }
	const currentBlockLogs = await getCurrentBlockLogs(addresses)
	const remainingLogs = blockNumber < segmentEnd ? await getRemainingLogs(blockNumber + 1n, segmentEnd, addresses) : []
	return { currentBlockLogs, remainingLogs }
}

export const requiresManifestHistoryCoverage = (contract: ContractMetadata | undefined): boolean =>
	isProtocolActivitySource(contract) || contract?.kind === 'reputationToken' || contract?.kind === 'weth' || contract?.kind === 'usdc'

export const isProtocolEvidenceEmitter = (contract: ContractMetadata | undefined): contract is ContractMetadata => contract !== undefined

export const requireReceiptPosition = (receipt: TransactionReceipt, blockHash: Hash, blockNumber: bigint): void => {
	if (receipt.blockHash !== blockHash || receipt.blockNumber !== blockNumber) {
		throw new ChainContinuityError(`Receipt ${receipt.transactionHash} no longer belongs to block ${blockNumber}`)
	}
	for (const log of receipt.logs) {
		const position = requireLogPosition(log)
		if (position.blockHash !== blockHash || position.blockNumber !== blockNumber) {
			throw new ChainContinuityError(`Log ${position.transactionHash}:${position.logIndex} no longer belongs to block ${blockNumber}`)
		}
	}
}

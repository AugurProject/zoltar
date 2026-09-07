import { errorChainIncludes } from '../error-chain.ts'
import { jsonRpcErrorName, safeRpcProviderMessage } from '../logging.ts'
import { RpcRequestMethodError, rpcQueueSaturationFrom } from '../rpc-request-queue.ts'
import { bigintToSafeNumber } from '../time.ts'
import type { ContractMetadata } from '../types.ts'
import type { RpcProvider } from './runtime-chain.ts'
import {
	ChainConfigurationError,
	ChainContinuityError,
	isPermanentHistoricalCodeError,
	isPrunedHistoricalStateError,
	LeaseLostError,
	normalizedRpcDescription,
	preferredRpcDescriptions,
	type RpcDescriptionCategory,
	rpcErrorCategory,
	singleLineErrorDescription,
} from './runtime-rpc.ts'

export const databaseFailureMessage = 'Database request failed; retrying'
export const rpcQueueSaturatedMessage = 'RPC queue saturated; retrying'
export const databaseFailureNames = new Set(['DatabaseConsistencyError', 'PostgresError'])
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

export const safeErrorNames = new Set([
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

export const safeErrorIdentifier = (value: unknown): string | undefined => (typeof value === 'string' && safeErrorNames.has(value) ? value : undefined)

export const safeNamedErrorCodes = new Set(['ECONNREFUSED', 'ECONNRESET', 'ENETUNREACH', 'ENOTFOUND', 'ETIMEDOUT', 'ERR_POSTGRES_CONNECTION_CLOSED'])

export const safeErrorCode = (value: unknown): string | undefined => {
	if (
		typeof value === 'number' &&
		Number.isSafeInteger(value) &&
		(value === -32700 || (value >= -32603 && value <= -32600) || (value >= -32099 && value <= -32000))
	)
		return value.toString()
	return typeof value === 'string' && (/^HTTP_[1-5][0-9]{2}$/.test(value) || safeNamedErrorCodes.has(value)) ? value : undefined
}

export const safeStandardRpcMessages = new Map([
	['parse error', 'Parse error'],
	['invalid request', 'Invalid Request'],
	['method not found', 'Method not found'],
	['invalid params', 'Invalid params'],
	['internal error', 'Internal error'],
])

export const safeRpcCategoryMessages: Readonly<Record<RpcDescriptionCategory, string>> = {
	'block-range': 'provider rejected the requested block range',
	'rate-limit': 'provider rate limit exceeded',
	'response-size': 'provider response size limit exceeded',
	'result-limit': 'provider result limit exceeded',
	timeout: 'provider request timed out',
	'too-many-logs': 'provider returned too many logs',
	'too-many-results': 'provider returned too many results',
}

export const safeStandardRpcProviderMessage = (value: unknown): string | undefined => {
	if (typeof value !== 'string') return undefined
	const normalized = normalizedRpcDescription(value)
	return safeStandardRpcMessages.get(normalized.replace(/[.!]$/u, '')) ?? safeRpcProviderMessage(value)
}

export const safeRpcRequestMethod = (value: unknown): string | undefined =>
	typeof value === 'string' && /^(?:eth|net|web3)_[A-Za-z0-9_]+$/u.test(value) ? value : undefined

export const rpcRequestMethodFrom = (error: unknown): string | undefined => {
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

export const indexerFailureReason = (error: unknown, includeErrorDescriptions: boolean): string => {
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

export const rpcFailureReason = (error: unknown, rpcNumber: number): string => `RPC #${rpcNumber}: ${rpcIndexerFailureReason(error)}`

export type RpcDiagnosticProvider = Pick<RpcProvider, 'endpoint' | 'number'>

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

export const deploymentReadTimeoutError = (): Error => {
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
		if (isPrunedHistoricalStateError(error)) throw error
		if (!isPermanentHistoricalCodeError(error)) throw error
		onHistoricalCodeUnavailable(error)
		return { status: 'unavailable' }
	}
}

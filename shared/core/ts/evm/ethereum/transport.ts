import { errorChain } from '../../errors/errorChain.js'
import { type ClientRequestParameters, type DeadlineRunner, type EIP1193Provider, type HttpTransportOptions, type JsonValue, type Transport, type TransportRetryOptions } from './types.js'

import { RpcError } from './errors.js'

const DEFAULT_RATE_LIMIT_RETRY_COUNT = 3

const RATE_LIMIT_RETRY_DELAY_MILLISECONDS = 10_000

async function requestTransportOnce<TValue>(transport: Transport, parameters: ClientRequestParameters): Promise<TValue> {
	const request = async (): Promise<TValue> => {
		if (transport.kind === 'custom') {
			try {
				return (await transport.provider.request({
					method: parameters.method,
					params: parameters.params,
				})) as TValue
			} catch (error) {
				throw toRpcError(error, `${parameters.method} failed`)
			}
		}

		const response = await (transport.fetchFn ?? fetch)(transport.url, {
			body: JSON.stringify({
				id: 1,
				jsonrpc: '2.0',
				method: parameters.method,
				params: parameters.params ?? [],
			}),
			headers: {
				'content-type': 'application/json',
			},
			method: 'POST',
			redirect: 'error',
			signal: AbortSignal.timeout(transport.requestTimeout),
		})
		if (!response.ok) {
			throw new RpcError(`HTTP ${response.status} while calling ${parameters.method}`, {
				code: response.status,
				shortMessage: `HTTP ${response.status} while calling ${parameters.method}`,
			})
		}

		const payload: JsonValue = transport.responseParser === undefined ? ((await response.json()) as JsonValue) : await transport.responseParser(response, parameters.method)
		if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) throw new RpcError(`Malformed JSON-RPC response while calling ${parameters.method}`)
		const envelope = payload as Record<string, JsonValue>
		const hasResult = Object.prototype.hasOwnProperty.call(envelope, 'result')
		const hasError = Object.prototype.hasOwnProperty.call(envelope, 'error')
		if (envelope['jsonrpc'] !== '2.0' || envelope['id'] !== 1 || hasResult === hasError) throw new RpcError(`Malformed JSON-RPC response while calling ${parameters.method}`)
		if (hasError) {
			const error = envelope['error']
			if (typeof error !== 'object' || error === null || Array.isArray(error)) throw new RpcError(`Malformed JSON-RPC error while calling ${parameters.method}`)
			const errorRecord = error as Record<string, JsonValue>
			const code = errorRecord['code']
			const message = errorRecord['message']
			if (typeof code !== 'number' || !Number.isInteger(code) || typeof message !== 'string') throw new RpcError(`Malformed JSON-RPC error while calling ${parameters.method}`)
			throw new RpcError(message, {
				cause: errorRecord['data'],
				code,
				shortMessage: message,
			})
		}
		return envelope['result'] as TValue
	}
	return transport.requestScheduler === undefined ? await request() : await transport.requestScheduler(parameters.method, request)
}

export async function retryRateLimited<TValue>(operation: () => Promise<TValue>, options: { retryCount?: number | undefined; retryDelay: number; startTime?: number | undefined; timeout?: number | undefined }) {
	const startTime = options.timeout === undefined ? undefined : (options.startTime ?? Date.now())
	let retries = 0
	while (true) {
		try {
			return await operation()
		} catch (error) {
			if (!isRateLimitError(error) || (options.retryCount !== undefined && retries >= options.retryCount)) throw error
			const remainingMilliseconds = options.timeout === undefined || startTime === undefined ? undefined : options.timeout - (Date.now() - startTime)
			if (remainingMilliseconds !== undefined && remainingMilliseconds <= 0) throw error
			const delayMilliseconds = remainingMilliseconds === undefined ? options.retryDelay : Math.min(options.retryDelay, remainingMilliseconds)
			await new Promise(resolve => {
				setTimeout(resolve, delayMilliseconds)
			})
			if (options.timeout !== undefined && startTime !== undefined && Date.now() - startTime >= options.timeout) throw error
			retries += 1
		}
	}
}

export async function runWithDeadline<TValue>(parameters: { getTimeoutError: () => Error; operation: (runBeforeDeadline: DeadlineRunner) => Promise<TValue>; timeout: number }) {
	let deadlineTimer: ReturnType<typeof setTimeout> | undefined
	const deadline = new Promise<never>((_resolve, reject) => {
		deadlineTimer = setTimeout(() => reject(parameters.getTimeoutError()), parameters.timeout)
	})
	const runBeforeDeadline: DeadlineRunner = async operation => await Promise.race([operation(), deadline])
	try {
		return await parameters.operation(runBeforeDeadline)
	} finally {
		if (deadlineTimer !== undefined) clearTimeout(deadlineTimer)
	}
}

export async function requestTransport<TValue>(transport: Transport, parameters: ClientRequestParameters): Promise<TValue> {
	return await requestTransportOnce<TValue>(transport, parameters)
}

export async function requestTransportWithRateLimitRetries<TValue>(transport: Transport, parameters: ClientRequestParameters): Promise<TValue> {
	return await retryRateLimited(async () => await requestTransportOnce<TValue>(transport, parameters), {
		retryCount: transport.retryCount,
		retryDelay: transport.retryDelay,
	})
}

export async function requestRpc<TValue>(transport: Transport, parameters: { method: string; params?: unknown }) {
	return await requestTransport<TValue>(transport, parameters)
}

function toRpcError(error: unknown, fallbackMessage: string) {
	if (error instanceof RpcError) return error
	if (typeof error === 'object' && error !== null) {
		const code = 'code' in error && (typeof error.code === 'number' || typeof error.code === 'string') ? error.code : undefined
		const message = 'message' in error && typeof error.message === 'string' ? error.message : fallbackMessage
		return new RpcError(message, {
			cause: error,
			code,
			shortMessage: message,
		})
	}
	if (error instanceof Error) {
		return new RpcError(error.message, {
			cause: error,
			shortMessage: error.message,
		})
	}
	return new RpcError(fallbackMessage, {
		cause: error,
		shortMessage: fallbackMessage,
	})
}

export function isRateLimitError(error: unknown) {
	for (const current of errorChain(error)) {
		if (current instanceof RpcError && (current.code === 429 || current.code === '429' || current.code === -32_005 || current.code === '-32005' || current.message.includes('HTTP 429'))) return true
	}
	return false
}

function normalizeTransportRetryOptions(options: TransportRetryOptions = {}) {
	const retryCount = options.retryCount ?? DEFAULT_RATE_LIMIT_RETRY_COUNT
	const retryDelay = options.retryDelay ?? RATE_LIMIT_RETRY_DELAY_MILLISECONDS
	if (!Number.isSafeInteger(retryCount) || retryCount < 0) throw new Error('RPC retry count must be a non-negative safe integer')
	if (!Number.isSafeInteger(retryDelay) || retryDelay < 0) throw new Error('RPC retry delay must be a non-negative safe integer')
	return { ...(options.requestScheduler === undefined ? {} : { requestScheduler: options.requestScheduler }), retryCount, retryDelay }
}

function normalizeHttpTransportOptions(options: HttpTransportOptions = {}) {
	const requestTimeout = options.requestTimeout ?? 30_000
	if (!Number.isSafeInteger(requestTimeout) || requestTimeout < 1) throw new Error('RPC request timeout must be a positive safe integer')
	return {
		...(options.fetchFn === undefined ? {} : { fetchFn: options.fetchFn }),
		...(options.responseParser === undefined ? {} : { responseParser: options.responseParser }),
		...normalizeTransportRetryOptions(options),
		requestTimeout,
	}
}

export function http(url: string, options?: HttpTransportOptions) {
	return {
		kind: 'http',
		...normalizeHttpTransportOptions(options),
		url,
	} satisfies Transport
}

export function custom(provider: EIP1193Provider, options?: TransportRetryOptions) {
	return {
		kind: 'custom',
		provider,
		...normalizeTransportRetryOptions(options),
	} satisfies Transport
}

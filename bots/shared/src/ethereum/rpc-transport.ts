import { boundedJsonResponse, DEFAULT_RPC_RESPONSE_BYTES, LOG_RPC_RESPONSE_BYTES } from '../infrastructure/bounded-json.ts'
import type { EIP1193Provider, Transport } from './types.ts'

export class RpcError extends Error {
	code?: number | string | undefined
	override cause?: unknown
	shortMessage?: string | undefined

	constructor(message: string, options: { cause?: unknown; code?: number | string | undefined; shortMessage?: string | undefined } = {}) {
		super(message)
		this.name = 'RpcError'
		this.code = options.code
		this.cause = options.cause
		this.shortMessage = options.shortMessage
	}
}

type ClientRequestParameters = {
	method: string
	params?: unknown
}

type JsonRpcEnvelope = {
	error?: {
		code: number | string
		data?: unknown
		message: string
	}
	id: number
	jsonrpc: '2.0'
	result?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function jsonRpcEnvelope(value: unknown, method: string): JsonRpcEnvelope {
	if (!isRecord(value)) throw new RpcError(`Invalid JSON-RPC envelope while calling ${method}`)
	const record = value
	if (record['jsonrpc'] !== '2.0' || record['id'] !== 1) throw new RpcError(`Invalid JSON-RPC envelope while calling ${method}`)
	const hasResult = Object.prototype.hasOwnProperty.call(record, 'result')
	const hasError = Object.prototype.hasOwnProperty.call(record, 'error')
	if (hasResult === hasError) throw new RpcError(`Invalid JSON-RPC envelope while calling ${method}`)
	if (hasError) {
		const error = record['error']
		if (!isRecord(error)) throw new RpcError(`Invalid JSON-RPC error while calling ${method}`)
		const errorRecord = error
		if ((typeof errorRecord['code'] !== 'number' && typeof errorRecord['code'] !== 'string') || typeof errorRecord['message'] !== 'string') {
			throw new RpcError(`Invalid JSON-RPC error while calling ${method}`)
		}
		return {
			error: { code: errorRecord['code'], data: errorRecord['data'], message: errorRecord['message'] },
			id: 1,
			jsonrpc: '2.0',
		}
	}
	return { id: 1, jsonrpc: '2.0', result: record['result'] }
}

function toRpcError(error: unknown, fallbackMessage: string) {
	if (error instanceof RpcError) return error
	if (typeof error === 'object' && error !== null) {
		const code = 'code' in error && (typeof error.code === 'number' || typeof error.code === 'string') ? error.code : undefined
		const message = 'message' in error && typeof error.message === 'string' ? error.message : fallbackMessage
		return new RpcError(message, { cause: error, code, shortMessage: message })
	}
	return new RpcError(error instanceof Error ? error.message : fallbackMessage, {
		cause: error,
		shortMessage: error instanceof Error ? error.message : fallbackMessage,
	})
}

export async function requestTransport<TValue>(transport: Transport, parameters: ClientRequestParameters): Promise<TValue> {
	if (transport.kind === 'custom') {
		let timeout: ReturnType<typeof setTimeout> | undefined
		try {
			return (await Promise.race([
				transport.provider.request({ method: parameters.method, params: parameters.params }),
				new Promise<never>((_resolve, reject) => {
					timeout = setTimeout(() => reject(new Error(`${parameters.method} timed out after ${transport.timeoutMilliseconds.toString()}ms`)), transport.timeoutMilliseconds)
				}),
			])) as TValue
		} catch (error) {
			throw toRpcError(error, `${parameters.method} failed`)
		} finally {
			if (timeout !== undefined) clearTimeout(timeout)
		}
	}

	const response = await fetch(transport.url, {
		body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: parameters.method, params: parameters.params ?? [] }),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(transport.timeoutMilliseconds),
	})
	if (!response.ok) throw new RpcError(`HTTP ${response.status} while calling ${parameters.method}`, { shortMessage: `HTTP ${response.status} while calling ${parameters.method}` })
	const envelope = jsonRpcEnvelope(await boundedJsonResponse(response, parameters.method === 'eth_getLogs' ? LOG_RPC_RESPONSE_BYTES : DEFAULT_RPC_RESPONSE_BYTES, `RPC ${parameters.method}`), parameters.method)
	if (envelope.error !== undefined) throw new RpcError(envelope.error.message, { cause: envelope.error.data, code: envelope.error.code, shortMessage: envelope.error.message })
	return envelope.result as TValue
}

export type TransportOptions = {
	timeoutMilliseconds?: number | undefined
}

const DEFAULT_RPC_TIMEOUT_MILLISECONDS = 15_000

function transportTimeout(options: TransportOptions | undefined) {
	const timeoutMilliseconds = options?.timeoutMilliseconds ?? DEFAULT_RPC_TIMEOUT_MILLISECONDS
	if (!Number.isSafeInteger(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 300_000) throw new Error('Transport timeoutMilliseconds must be an integer from 1 to 300000')
	return timeoutMilliseconds
}

export function http(url: string, options?: TransportOptions) {
	return { kind: 'http', timeoutMilliseconds: transportTimeout(options), url } satisfies Transport
}

export function custom(provider: EIP1193Provider, options?: TransportOptions) {
	return { kind: 'custom', provider, timeoutMilliseconds: transportTimeout(options) } satisfies Transport
}

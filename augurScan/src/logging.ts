import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { boundedLogLine, MINIMUM_LOG_RECORD_BYTES } from './bounded-log-record.ts'
import { boundedResponseText, type JsonValue, RpcError, type RpcFetchFn } from './ethereum.ts'

const JSON_RPC_ERROR_NAMES = new Map<number, string>([
	[-32700, 'Parse error'],
	[-32600, 'Invalid Request'],
	[-32601, 'Method not found'],
	[-32602, 'Invalid params'],
	[-32603, 'Internal error'],
])

export const jsonRpcErrorName = (code: number): string | undefined => JSON_RPC_ERROR_NAMES.get(code) ?? (code >= -32099 && code <= -32000 ? 'Server error' : undefined)

export const safeRpcProviderMessage = (value: unknown): string | undefined => {
	if (typeof value !== 'string' || value.length > 4096) return undefined
	const message = [...value]
		.map(character => {
			const codePoint = character.codePointAt(0)
			return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) ? ' ' : character
		})
		.join('')
		.replace(/\p{Cf}/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim()
	return /^state at block (?:#[0-9]+|0x[0-9a-f]+) is pruned[.!]?$/iu.test(message) || /^pruned history unavailable[.!]?$/iu.test(message) ? message : undefined
}

export const safePrunedStateProviderMessage = (value: unknown): string | undefined => {
	if (typeof value !== 'string' || value.length > 4096) return undefined
	const normalized = value.replace(/\s+/gu, ' ').trim().toLowerCase()
	if (/(?:^|: )state at block (?:#[0-9]+|0x[0-9a-f]+|[0-9]+) is pruned[.!]?$/u.test(normalized)) return 'state at requested block is pruned'
	if (normalized.includes('missing trie node')) return 'missing trie node'
	if (normalized.includes('pruned historical state')) return 'pruned historical state'
	if (normalized.includes('historical state pruned')) return 'historical state pruned'
	return undefined
}

const timestampedLogArguments = (values: readonly unknown[], now = new Date()): readonly unknown[] => [`[${now.toISOString()}]:`, ...values]

let consoleTimestampsInstalled = false

export const installConsoleTimestamps = (): void => {
	if (consoleTimestampsInstalled) return
	consoleTimestampsInstalled = true
	for (const method of ['log', 'info', 'warn', 'error'] as const) {
		const original = console[method].bind(console)
		console[method] = (...values: unknown[]): void => original(...timestampedLogArguments(values))
	}
}

const DEFAULT_RPC_LOG_MAX_BYTES = 100 * 1024 * 1024

export class RotatingJsonLog {
	readonly #filename: string
	readonly #maximumBytes: number
	#pending: Promise<void> = Promise.resolve()

	constructor(filename: string, maximumBytes = DEFAULT_RPC_LOG_MAX_BYTES) {
		if (!Number.isSafeInteger(maximumBytes) || maximumBytes < MINIMUM_LOG_RECORD_BYTES) throw new Error(`Log maximum size must be a safe integer of at least ${MINIMUM_LOG_RECORD_BYTES} bytes`)
		this.#filename = filename
		this.#maximumBytes = maximumBytes
	}

	append(record: unknown): Promise<void> {
		const line = boundedLogLine(record, this.#maximumBytes)
		const write = this.#pending.then(() => this.#appendLine(line))
		this.#pending = write.catch(() => {})
		return write
	}

	async #appendLine(line: string): Promise<void> {
		await mkdir(path.dirname(this.#filename), { recursive: true })
		const lineBytes = Buffer.byteLength(line)
		if (lineBytes > this.#maximumBytes) throw new Error('Log record exceeds the file size limit')
		let currentBytes = 0
		try {
			currentBytes = (await stat(this.#filename)).size
		} catch (error) {
			if (!(typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT')) throw error
		}
		if (currentBytes > 0 && currentBytes + lineBytes > this.#maximumBytes) {
			const rotatedFilename = `${this.#filename}.1`
			await rm(rotatedFilename, { force: true })
			await rename(this.#filename, rotatedFilename)
		}
		const file = await open(this.#filename, 'a', 0o600)
		try {
			await file.writeFile(line)
		} finally {
			await file.close()
		}
	}
}

type RpcEnvelope = {
	readonly id?: JsonValue
	readonly jsonrpc?: JsonValue
	readonly method?: JsonValue
	readonly error?: JsonValue
	readonly result?: JsonValue
}

const isJsonObject = (value: JsonValue): value is { readonly [key: string]: JsonValue } => typeof value === 'object' && value !== null && !Array.isArray(value)

const parseEnvelope = (body: unknown): RpcEnvelope | undefined => {
	if (typeof body !== 'string' || body.length > 64 * 1024) return undefined
	try {
		const parsed: JsonValue = JSON.parse(body)
		return isJsonObject(parsed) ? parsed : undefined
	} catch (error) {
		if (error instanceof SyntaxError) return undefined
		throw error
	}
}

const rpcErrorFrom = (envelope: RpcEnvelope | undefined): { readonly code: number; readonly message?: string } | undefined => {
	if (typeof envelope?.error !== 'object' || envelope.error === null || Array.isArray(envelope.error)) return undefined
	const code = 'code' in envelope.error ? envelope.error['code'] : undefined
	const message = 'message' in envelope.error ? envelope.error['message'] : undefined
	return typeof code === 'number' && Number.isInteger(code) ? { code, ...(typeof message === 'string' ? { message } : {}) } : undefined
}

const isRpcIdentifier = (value: unknown): value is number | string | null => value === null || typeof value === 'number' || typeof value === 'string'

const isSuccessfulRpcResponse = (request: RpcEnvelope | undefined, response: RpcEnvelope | undefined): boolean => response?.jsonrpc === '2.0' && isRpcIdentifier(request?.id) && response.id === request.id && Object.hasOwn(response, 'result') && !Object.hasOwn(response, 'error')

// Log ranges aggregate many blocks; ordinary calls have a smaller allocation budget.
const responseLimit = (method: unknown): number => (method === 'eth_getLogs' ? 32 : 4) * 1024 * 1024
const parsedResponses = new WeakMap<Response, { readonly value: JsonValue } | { readonly error: unknown }>()

export const parseLoggedRpcResponse = async (response: Response, method: string): Promise<JsonValue> => {
	const parsed = parsedResponses.get(response)
	if (parsed !== undefined) {
		parsedResponses.delete(response)
		if ('error' in parsed) throw parsed.error
		return parsed.value
	}
	return JSON.parse(await boundedResponseText(response, responseLimit(method), `RPC ${method}`))
}

const appendRpcRecord = async (log: RotatingJsonLog, logPath: string, record: unknown): Promise<void> => {
	try {
		await log.append(record)
	} catch (error) {
		console.error(`Unable to write RPC exchange log ${logPath} (${error instanceof Error ? error.name : typeof error})`)
	}
}

const historicalStateMethods = new Set(['debug_traceBlockByHash', 'eth_call', 'eth_getBalance', 'eth_getCode', 'eth_getProof', 'eth_getStorageAt', 'eth_getTransactionCount'])

export const createRpcLoggingFetch = (rpcUrl: string, consoleEndpoint: string, logPath: string, log: RotatingJsonLog, fetchFn: RpcFetchFn = fetch): RpcFetchFn => {
	let reportedPrunedState = false
	return async (input, init) => {
		const requestBody = init?.body
		const requestEnvelope = parseEnvelope(requestBody)
		const startedAt = new Date()
		let response: Response | undefined
		try {
			response = await fetchFn(input, init)
			let responseBody: string
			try {
				responseBody = await boundedResponseText(response, responseLimit(requestEnvelope?.method), `RPC ${typeof requestEnvelope?.method === 'string' ? requestEnvelope.method : 'unknown'}`, init?.signal)
			} catch (error) {
				// Preserve HTTP retry/category semantics even when its diagnostic body
				// cannot be read. Abort and timeout remain the original failures.
				if (!response.ok && !init?.signal?.aborted) {
					throw Object.assign(new RpcError(`HTTP ${response.status} while calling ${typeof requestEnvelope?.method === 'string' ? requestEnvelope.method : 'unknown'}`, { code: response.status, cause: error }), { status: response.status })
				}
				throw error
			}
			// Keep the fetch response readable for callers while the transport reuses
			// this parse. There is no unread network tee branch.
			const bufferedResponse = new Response(response.body === null ? null : responseBody, { status: response.status, statusText: response.statusText, headers: response.headers })
			let responseEnvelope: RpcEnvelope | undefined
			try {
				const value: JsonValue = JSON.parse(responseBody)
				parsedResponses.set(bufferedResponse, { value })
				if (isJsonObject(value)) responseEnvelope = value
			} catch (error) {
				parsedResponses.set(bufferedResponse, { error })
			}
			const rpcError = rpcErrorFrom(responseEnvelope)
			if (!response.ok || !isSuccessfulRpcResponse(requestEnvelope, responseEnvelope)) {
				await appendRpcRecord(log, logPath, {
					timestamp: startedAt.toISOString(),
					rpcServer: rpcUrl,
					request: { body: requestBody, headers: init?.headers, method: init?.method },
					response: { body: responseBody, headers: response.headers, status: response.status, statusText: response.statusText },
				})
			}
			if (rpcError !== undefined) {
				const name = jsonRpcErrorName(rpcError.code)
				const providerMessage = safeRpcProviderMessage(rpcError.message)
				const prunedStateMessage = safePrunedStateProviderMessage(rpcError.message)
				const method = typeof requestEnvelope?.method === 'string' ? requestEnvelope.method : 'unknown'
				const message = `RPC error from ${consoleEndpoint}; method ${method}; code ${rpcError.code}${name === undefined ? '' : ` (${name})`}${providerMessage === undefined ? '' : `; message: ${providerMessage}`}; full exchange logged to ${logPath}`
				if (method === 'eth_getLogs' && rpcError.code === 4444 && providerMessage !== undefined) {
					console.warn(`Historical log history unavailable from ${consoleEndpoint}; method ${method}; message: ${providerMessage}; locating earliest retrievable block; full exchange logged to ${logPath}`)
				} else if (historicalStateMethods.has(method) && prunedStateMessage !== undefined) {
					if (!reportedPrunedState) {
						reportedPrunedState = true
						console.warn(`Historical state unavailable from ${consoleEndpoint}; method ${method}; message: ${providerMessage ?? prunedStateMessage}; locating earliest retrievable state block; repeated pruned-state exchanges remain in ${logPath}`)
					}
				} else console.error(message)
			}
			return bufferedResponse
		} catch (error) {
			await appendRpcRecord(log, logPath, {
				timestamp: startedAt.toISOString(),
				rpcServer: rpcUrl,
				request: { body: requestBody, headers: init?.headers, method: init?.method },
				...(response === undefined ? {} : { response: { headers: response.headers, status: response.status, statusText: response.statusText, truncated: true } }),
				transportError: error instanceof Error ? { message: error.message, name: error.name, stack: error.stack, ...('maximumBytes' in error ? { maximumBytes: error.maximumBytes, truncated: true } : {}), ...('receivedBytes' in error ? { receivedBytes: error.receivedBytes } : {}) } : error,
			})
			console.error(`RPC transport error from ${consoleEndpoint}; method ${typeof requestEnvelope?.method === 'string' ? requestEnvelope.method : 'unknown'}; full exchange logged to ${logPath}`)
			throw error
		}
	}
}

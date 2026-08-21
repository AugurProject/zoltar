import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import type { RpcFetchFn } from './ethereum.ts'

const JSON_RPC_ERROR_NAMES = new Map<number, string>([
	[-32700, 'Parse error'],
	[-32600, 'Invalid Request'],
	[-32601, 'Method not found'],
	[-32602, 'Invalid params'],
	[-32603, 'Internal error'],
])

export const jsonRpcErrorName = (code: number): string | undefined =>
	JSON_RPC_ERROR_NAMES.get(code) ?? (code >= -32099 && code <= -32000 ? 'Server error' : undefined)

export const safeRpcProviderMessage = (value: unknown): string | undefined => {
	if (typeof value !== 'string') return undefined
	const message = [...value]
		.map((character) => {
			const codePoint = character.codePointAt(0)
			return codePoint !== undefined && (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) ? ' ' : character
		})
		.join('')
		.replace(/\p{Cf}/gu, ' ')
		.replace(/\s+/gu, ' ')
		.trim()
	return /^state at block (?:#[0-9]+|0x[0-9a-f]+) is pruned[.!]?$/iu.test(message) ? message : undefined
}

export const timestampedLogArguments = (values: readonly unknown[], now = new Date()): readonly unknown[] => [`[${now.toISOString()}]:`, ...values]

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
		if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1) throw new Error('Log maximum size must be a positive safe integer')
		this.#filename = filename
		this.#maximumBytes = maximumBytes
	}

	append(record: unknown): Promise<void> {
		const line = `${JSON.stringify(record)}\n`
		const write = this.#pending.then(() => this.#appendLine(line))
		this.#pending = write.catch(() => {})
		return write
	}

	async #appendLine(line: string): Promise<void> {
		await mkdir(path.dirname(this.#filename), { recursive: true })
		const lineBytes = Buffer.byteLength(line)
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
	readonly id?: unknown
	readonly jsonrpc?: unknown
	readonly method?: unknown
	readonly error?: unknown
	readonly result?: unknown
}

const parseEnvelope = (body: unknown): RpcEnvelope | undefined => {
	if (typeof body !== 'string') return undefined
	try {
		const parsed: unknown = JSON.parse(body)
		return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed : undefined
	} catch (error) {
		if (error instanceof SyntaxError) return undefined
		throw error
	}
}

const rpcErrorFrom = (envelope: RpcEnvelope | undefined): { readonly code: number; readonly message?: string } | undefined => {
	if (typeof envelope?.error !== 'object' || envelope.error === null || Array.isArray(envelope.error)) return undefined
	const code = 'code' in envelope.error ? envelope.error.code : undefined
	const message = 'message' in envelope.error ? envelope.error.message : undefined
	return typeof code === 'number' && Number.isInteger(code) ? { code, ...(typeof message === 'string' ? { message } : {}) } : undefined
}

const isRpcIdentifier = (value: unknown): value is number | string | null => value === null || typeof value === 'number' || typeof value === 'string'

const isSuccessfulRpcResponse = (request: RpcEnvelope | undefined, response: RpcEnvelope | undefined): boolean =>
	response?.jsonrpc === '2.0' &&
	isRpcIdentifier(request?.id) &&
	response.id === request.id &&
	Object.hasOwn(response, 'result') &&
	!Object.hasOwn(response, 'error')

const responseHeaders = (response: Response): Record<string, string> => Object.fromEntries(response.headers.entries())

const appendRpcRecord = async (log: RotatingJsonLog, logPath: string, record: unknown): Promise<void> => {
	try {
		await log.append(record)
	} catch (error) {
		console.error(`Unable to write RPC exchange log ${logPath} (${error instanceof Error ? error.name : typeof error})`)
	}
}

export const createRpcLoggingFetch =
	(rpcUrl: string, consoleEndpoint: string, logPath: string, log: RotatingJsonLog, fetchFn: RpcFetchFn = fetch): RpcFetchFn =>
	async (input, init) => {
		const requestBody = init?.body
		const requestEnvelope = parseEnvelope(requestBody)
		const startedAt = new Date()
		try {
			const response = await fetchFn(input, init)
			const responseBody = await response.clone().text()
			const responseEnvelope = parseEnvelope(responseBody)
			const rpcError = rpcErrorFrom(responseEnvelope)
			if (!response.ok || !isSuccessfulRpcResponse(requestEnvelope, responseEnvelope)) {
				await appendRpcRecord(log, logPath, {
					timestamp: startedAt.toISOString(),
					rpcServer: rpcUrl,
					request: { body: requestBody, headers: init?.headers, method: init?.method },
					response: { body: responseBody, headers: responseHeaders(response), status: response.status, statusText: response.statusText },
				})
			}
			if (rpcError !== undefined) {
				const name = jsonRpcErrorName(rpcError.code)
				const providerMessage = safeRpcProviderMessage(rpcError.message)
				console.error(
					`RPC error from ${consoleEndpoint}; method ${typeof requestEnvelope?.method === 'string' ? requestEnvelope.method : 'unknown'}; code ${rpcError.code}${name === undefined ? '' : ` (${name})`}${providerMessage === undefined ? '' : `; message: ${providerMessage}`}; full exchange logged to ${logPath}`,
				)
			}
			return response
		} catch (error) {
			await appendRpcRecord(log, logPath, {
				timestamp: startedAt.toISOString(),
				rpcServer: rpcUrl,
				request: { body: requestBody, headers: init?.headers, method: init?.method },
				transportError: error instanceof Error ? { message: error.message, name: error.name, stack: error.stack } : String(error),
			})
			console.error(
				`RPC transport error from ${consoleEndpoint}; method ${typeof requestEnvelope?.method === 'string' ? requestEnvelope.method : 'unknown'}; full exchange logged to ${logPath}`,
			)
			throw error
		}
	}

import type { Address, Hex } from '../ethereum.ts'
import { bigintToSafeNumber, keccak256 } from '../ethereum.ts'
import type { SubmissionSettings } from '../execution/transaction-submission.ts'
import { boundedJsonResponse, DEFAULT_RPC_RESPONSE_BYTES } from '../infrastructure/bounded-json.ts'

export type NetworkName = 'mainnet' | 'sepolia'

export type ConnectivitySettings = {
	publicRpcUrls: readonly string[]
	readRpcUrl: string
}

export type EndpointCheck = {
	chainId: number | undefined
	checkedAt: string
	error: string | undefined
	failureDisposition?: 'connectivity-degraded' | 'safety-paused' | undefined
	kind: 'private-relay' | 'public-rpc' | 'read-rpc'
	status: 'failed' | 'healthy'
	target: string
}

class EndpointTransportError extends Error {}
class EndpointSafetyError extends Error {}

function endpointFailureDisposition(error: unknown): 'connectivity-degraded' | 'safety-paused' {
	if (error instanceof EndpointSafetyError) return 'safety-paused'
	if (error instanceof EndpointTransportError) return 'connectivity-degraded'
	if (error instanceof Error) {
		const message = error.message.toLowerCase()
		if (error.name === 'AbortError' || error.name === 'HttpRequestError' || error.name === 'NetworkError' || error.name === 'TimeoutError' || message.includes('fetch failed') || message.includes('connection refused') || message.includes('unable to connect') || message.includes('timed out'))
			return 'connectivity-degraded'
	}
	return 'safety-paused'
}

function endpointMethodFailure(error: unknown, url: string, method: string) {
	const target = endpointLabel(url)
	const detail = (error instanceof Error ? error.message : String(error)).split(url).join(target)
	const targetPrefix = `RPC ${target} `
	const normalizedDetail = detail.startsWith(targetPrefix) ? detail.slice(targetPrefix.length) : detail
	const message = normalizedDetail.includes(method) ? `RPC ${target} ${normalizedDetail}` : `RPC ${target} failed while calling ${method}: ${normalizedDetail}`
	if (error instanceof EndpointTransportError) return new EndpointTransportError(message, { cause: error })
	if (error instanceof EndpointSafetyError) return new EndpointSafetyError(message, { cause: error })
	return new Error(message, { cause: error })
}

type JsonRpcResponse = {
	error?: {
		code?: number
		message?: string
	}
	result?: unknown
}

export class EndpointCheckFailure extends Error {
	readonly checks: readonly EndpointCheck[]

	constructor(message: string, checks: readonly EndpointCheck[]) {
		super(message)
		this.name = 'EndpointCheckFailure'
		this.checks = checks
	}
}

function endpointUrl(value: string) {
	if (value.length > 2_048) throw new Error('RPC URLs must not exceed 2048 characters')
	let parsed: URL
	try {
		parsed = new URL(value)
	} catch (error) {
		if (error instanceof TypeError) throw new Error('Invalid RPC URL')
		throw error
	}
	const localHttpRpc = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]' || parsed.hostname === 'anvil'
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && localHttpRpc)) throw new Error('RPC URL must use HTTPS, loopback HTTP, or the local Anvil service')
	if (parsed.username !== '' || parsed.password !== '') throw new Error('RPC URLs must not contain embedded credentials')
	if (value.includes('#')) throw new Error('RPC URLs must not contain fragments')
	return parsed.toString()
}

export function endpointLabel(value: string) {
	const parsed = new URL(value)
	return parsed.origin
}

export function validateReadRpcUrls(values: readonly string[]) {
	if (values.length > 8) throw new Error('At most 8 read quorum RPC URLs are supported')
	return [...new Set(values.map(value => endpointUrl(value.trim())))]
}

export function validateIndependentReadRpcUrls(primary: string, values: readonly string[]) {
	const normalizedPrimary = endpointUrl(primary.trim())
	if (values.length > 8) throw new Error('At most 8 read quorum RPC URLs are supported')
	const normalized = values.map(value => endpointUrl(value.trim()))
	const origins = [new URL(normalizedPrimary).origin, ...normalized.map(value => new URL(value).origin)]
	if (new Set(origins).size !== origins.length) throw new Error('Read RPC quorum must use independent origins; changing only the URL path does not create an independent provider')
	return normalized
}

export function validateConnectivitySettings(value: unknown): ConnectivitySettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Connectivity settings must be a JSON object')
	const record = value as Record<string, unknown>
	const keys = Object.keys(record)
	if (keys.length !== 2 || !keys.includes('readRpcUrl') || !keys.includes('publicRpcUrls')) throw new Error('Connectivity settings require only readRpcUrl and publicRpcUrls')
	if (typeof record['readRpcUrl'] !== 'string') throw new Error('Read RPC URL must be a string')
	if (!Array.isArray(record['publicRpcUrls']) || record['publicRpcUrls'].some(url => typeof url !== 'string')) throw new Error('Public RPC URLs must be an array of strings')
	if (record['publicRpcUrls'].length > 8) throw new Error('At most 8 public RPC URLs are supported')
	const readRpcUrl = endpointUrl(record['readRpcUrl'].trim())
	const publicRpcUrls = [...new Set(record['publicRpcUrls'].map(url => endpointUrl(String(url).trim())))]
	if (publicRpcUrls.length === 0) throw new Error('At least one public RPC URL is required')
	return { publicRpcUrls, readRpcUrl }
}

async function rawRpcRequest(url: string, method: string, params: readonly unknown[], timeoutMilliseconds: number) {
	const response = await fetch(url, {
		body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(timeoutMilliseconds),
	})
	if (!response.ok) {
		const message = `RPC returned HTTP ${response.status.toString()}`
		if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) throw new EndpointTransportError(message)
		throw new Error(message)
	}
	let value: JsonRpcResponse
	try {
		value = (await boundedJsonResponse(response, DEFAULT_RPC_RESPONSE_BYTES, 'RPC')) as JsonRpcResponse
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`RPC returned non-JSON HTTP ${response.status.toString()}`)
		throw error
	}
	if (value.error !== undefined) throw new EndpointSafetyError(`RPC ${value.error.code?.toString() ?? 'error'}: ${value.error.message ?? 'Unknown error'}`)
	return value.result
}

async function rpcRequest(url: string, method: string, params: readonly unknown[], timeoutMilliseconds: number) {
	try {
		return await rawRpcRequest(url, method, params, timeoutMilliseconds)
	} catch (error) {
		throw endpointMethodFailure(error, url, method)
	}
}

export async function readRpcChainId(url: string, timeoutMilliseconds = 5_000) {
	try {
		const result = await rpcRequest(url, 'eth_chainId', [], timeoutMilliseconds)
		if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) throw new Error('RPC returned an invalid chain id')
		const chainId = bigintToSafeNumber(BigInt(result), 'RPC chain ID')
		if (chainId <= 0) throw new Error('RPC returned an unsupported chain id')
		return chainId
	} catch (error) {
		throw endpointMethodFailure(error, url, 'eth_chainId')
	}
}

export async function sendRawTransactionToRpc(url: string, serializedTransaction: Hex, timeoutMilliseconds = 10_000) {
	try {
		let result: unknown
		try {
			result = await rpcRequest(url, 'eth_sendRawTransaction', [serializedTransaction], timeoutMilliseconds)
		} catch (error) {
			const message = error instanceof Error ? error.message.toLowerCase() : ''
			if (/\balready known\b/.test(message) || /\bknown transaction\b/.test(message)) return keccak256(serializedTransaction)
			throw error
		}
		if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('RPC returned an invalid transaction hash')
		return result as Hex
	} catch (error) {
		throw endpointMethodFailure(error, url, 'eth_sendRawTransaction')
	}
}

function rpcQuantity(value: unknown, label: string) {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error(`RPC returned an invalid ${label}`)
	return BigInt(value)
}

export async function readRpcPendingNonce(url: string, address: Address, timeoutMilliseconds = 10_000) {
	try {
		return rpcQuantity(await rpcRequest(url, 'eth_getTransactionCount', [address, 'pending'], timeoutMilliseconds), 'pending nonce')
	} catch (error) {
		throw endpointMethodFailure(error, url, 'eth_getTransactionCount')
	}
}

export async function estimateRpcTransactionGas(url: string, transaction: { data: Hex; from: Address; to: Address }, timeoutMilliseconds = 10_000) {
	try {
		return rpcQuantity(await rpcRequest(url, 'eth_estimateGas', [transaction], timeoutMilliseconds), 'gas estimate')
	} catch (error) {
		throw endpointMethodFailure(error, url, 'eth_estimateGas')
	}
}

export async function readRpcGasPrice(url: string, timeoutMilliseconds = 10_000) {
	try {
		return rpcQuantity(await rpcRequest(url, 'eth_gasPrice', [], timeoutMilliseconds), 'gas price')
	} catch (error) {
		throw endpointMethodFailure(error, url, 'eth_gasPrice')
	}
}

export async function checkRpcEndpoint(url: string, expectedChainId: number, kind: EndpointCheck['kind']): Promise<EndpointCheck> {
	const checkedAt = new Date().toISOString()
	try {
		const chainId = await readRpcChainId(url)
		if (chainId !== expectedChainId) throw endpointMethodFailure(new Error(`Expected chain ${expectedChainId.toString()}, received ${chainId.toString()}`), url, 'eth_chainId')
		return { chainId, checkedAt, error: undefined, kind, status: 'healthy', target: endpointLabel(url) }
	} catch (error) {
		return {
			chainId: undefined,
			checkedAt,
			error: error instanceof Error ? error.message : String(error),
			failureDisposition: endpointFailureDisposition(error),
			kind,
			status: 'failed',
			target: endpointLabel(url),
		}
	}
}

type RelayMethod = 'eth_callBundle' | 'eth_sendBundle' | 'eth_sendPrivateTransaction'
const unsupportedRelayMethodSentinel = 'zoltar_unsupportedRelayCapabilityProbe_f8b1e7c34d929a650c42bf176f80e2196a7d44ce53239018bd631cc9a4e5702f'

async function rawRelayCapabilityError(url: string, requestedMethod: string, capabilityMethod: RelayMethod, timeoutMilliseconds: number, options?: { allowClientErrorResponse?: boolean | undefined }) {
	const response = await fetch(url, {
		body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: requestedMethod, params: [] }),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(timeoutMilliseconds),
	})
	const boundedClientErrorResponse = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 425 && response.status !== 429
	if (!response.ok && !(options?.allowClientErrorResponse === true && boundedClientErrorResponse)) {
		const message = `Endpoint did not prove ${capabilityMethod} support: RPC returned HTTP ${response.status.toString()}`
		if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) throw new EndpointTransportError(message)
		throw new Error(message)
	}
	let value: unknown
	try {
		value = await boundedJsonResponse(response, DEFAULT_RPC_RESPONSE_BYTES, 'Bundle relay capability check')
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`Bundle relay capability check returned non-JSON HTTP ${response.status.toString()}`)
		throw error
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value) || !('jsonrpc' in value) || value.jsonrpc !== '2.0' || !('id' in value) || (value.id !== 1 && value.id !== null) || !('error' in value) || 'result' in value) {
		throw new Error(`Endpoint did not prove ${capabilityMethod} support: expected one matching JSON-RPC 2.0 error from the intentionally invalid request`)
	}
	const error = value.error
	if (typeof error !== 'object' || error === null || Array.isArray(error) || !('code' in error) || typeof error.code !== 'number' || !Number.isSafeInteger(error.code) || !('message' in error) || typeof error.message !== 'string' || error.message.trim() === '') {
		throw new Error(`Endpoint did not prove ${capabilityMethod} support: malformed JSON-RPC error`)
	}
	return { code: error.code, id: value.id, message: error.message.trim() }
}

async function rawAssertRelayMethodCapability(url: string, method: RelayMethod, timeoutMilliseconds: number) {
	const { code, message } = await rawRelayCapabilityError(url, method, method, timeoutMilliseconds)
	const normalizedMessage = message.toLowerCase()
	const authenticationEvidence = normalizedMessage.includes('signature is required') || normalizedMessage.includes('invalid signature') || normalizedMessage.includes('authentication required') || normalizedMessage.includes('authentication is required')
	const parameterEvidence =
		normalizedMessage.includes('invalid params') || normalizedMessage.includes('invalid parameters') || normalizedMessage.includes('invalid argument') || normalizedMessage.includes('missing transaction') || normalizedMessage.includes('missing tx') || normalizedMessage.includes('invalid transaction')
	if (code === -32_602 && parameterEvidence) return
	if (code === -32_600 && authenticationEvidence) {
		if (method !== 'eth_sendPrivateTransaction') return
		const sentinelError = await rawRelayCapabilityError(url, unsupportedRelayMethodSentinel, method, timeoutMilliseconds, { allowClientErrorResponse: true })
		const normalizedSentinelMessage = sentinelError.message.toLowerCase()
		const unsupportedMethodEvidence = normalizedSentinelMessage.includes('method not found') || (normalizedSentinelMessage.includes('method') && normalizedSentinelMessage.includes('not whitelisted'))
		if (sentinelError.id === 1 && sentinelError.code === -32_601 && unsupportedMethodEvidence) return
		throw new EndpointSafetyError(`Endpoint did not prove ${method} support: unsupported-method sentinel returned RPC ${sentinelError.code.toString()}: ${sentinelError.message}`)
	}
	throw new EndpointSafetyError(`Endpoint did not prove ${method} support: RPC ${code.toString()}: ${message}`)
}

async function assertRelayMethodCapability(url: string, method: RelayMethod, timeoutMilliseconds = 5_000) {
	try {
		await rawAssertRelayMethodCapability(url, method, timeoutMilliseconds)
	} catch (error) {
		throw endpointMethodFailure(error, url, method)
	}
}

async function checkPrivateTransactionRelayEndpoint(url: string, expectedChainId: number): Promise<EndpointCheck> {
	const checkedAt = new Date().toISOString()
	let chainId: number | undefined
	try {
		chainId = await readRpcChainId(url)
		if (chainId !== expectedChainId) throw endpointMethodFailure(new Error(`Expected chain ${expectedChainId.toString()}, received ${chainId.toString()}`), url, 'eth_chainId')
		await assertRelayMethodCapability(url, 'eth_sendPrivateTransaction')
		return { chainId, checkedAt, error: undefined, kind: 'private-relay', status: 'healthy', target: endpointLabel(url) }
	} catch (error) {
		return {
			chainId,
			checkedAt,
			error: error instanceof Error ? error.message : String(error),
			failureDisposition: endpointFailureDisposition(error),
			kind: 'private-relay',
			status: 'failed',
			target: endpointLabel(url),
		}
	}
}

async function checkPrivateRelayEndpoint(url: string, expectedChainId: number): Promise<EndpointCheck> {
	const checkedAt = new Date().toISOString()
	let chainId: number | undefined
	try {
		chainId = await readRpcChainId(url)
		if (chainId !== expectedChainId) throw endpointMethodFailure(new Error(`Expected chain ${expectedChainId.toString()}, received ${chainId.toString()}`), url, 'eth_chainId')
		await assertRelayMethodCapability(url, 'eth_callBundle')
		await assertRelayMethodCapability(url, 'eth_sendBundle')
		return { chainId, checkedAt, error: undefined, kind: 'private-relay', status: 'healthy', target: endpointLabel(url) }
	} catch (error) {
		return {
			chainId,
			checkedAt,
			error: error instanceof Error ? error.message : String(error),
			failureDisposition: endpointFailureDisposition(error),
			kind: 'private-relay',
			status: 'failed',
			target: endpointLabel(url),
		}
	}
}

export async function checkConnectivity(settings: ConnectivitySettings, expectedChainId: number) {
	const checks = await Promise.all([checkRpcEndpoint(settings.readRpcUrl, expectedChainId, 'read-rpc'), ...settings.publicRpcUrls.map(url => checkRpcEndpoint(url, expectedChainId, 'public-rpc'))])
	const failed = checks.filter(check => check.status === 'failed')
	if (failed.length !== 0) throw new EndpointCheckFailure(failed.map(check => (check.error?.includes(check.target) ? check.error : `${check.target}: ${check.error ?? 'endpoint check failed'}`)).join('; '), checks)
	return checks
}

export async function checkSubmissionEndpoints(settings: SubmissionSettings, expectedChainId: number) {
	if (settings.mode === 'public') return []
	const checks = await Promise.all(settings.relayUrls.map(url => checkPrivateRelayEndpoint(url, expectedChainId)))
	const failed = checks.filter(check => check.status === 'failed')
	if (failed.length !== 0) throw new EndpointCheckFailure(failed.map(check => (check.error?.includes(check.target) ? check.error : `${check.target}: ${check.error ?? 'relay check failed'}`)).join('; '), checks)
	return checks
}

export async function checkPrivateTransactionSubmissionEndpoints(settings: SubmissionSettings, expectedChainId: number) {
	if (settings.mode === 'public') return []
	const checks = await Promise.all(settings.relayUrls.map(url => checkPrivateTransactionRelayEndpoint(url, expectedChainId)))
	const failed = checks.filter(check => check.status === 'failed')
	const safetyFailure = failed.find(check => check.failureDisposition !== 'connectivity-degraded')
	const healthyCount = checks.length - failed.length
	if (safetyFailure !== undefined || healthyCount < settings.minimumBundleRelaySuccesses) {
		throw new EndpointCheckFailure(failed.map(check => (check.error?.includes(check.target) ? check.error : `${check.target}: ${check.error ?? 'private transaction relay check failed'}`)).join('; '), checks)
	}
	return checks
}

export function withConnectivityChecks(existing: readonly EndpointCheck[], connectivityChecks: readonly EndpointCheck[]) {
	return [...connectivityChecks, ...existing.filter(check => check.kind === 'private-relay')]
}

export function withSubmissionChecks(existing: readonly EndpointCheck[], submissionChecks: readonly EndpointCheck[]) {
	return [...existing.filter(check => check.kind !== 'private-relay'), ...submissionChecks]
}

export async function updateConnectivityEndpointChecks(state: { endpointChecks: EndpointCheck[] }, check: () => Promise<readonly EndpointCheck[]>) {
	try {
		const connectivityChecks = await check()
		state.endpointChecks = withConnectivityChecks(state.endpointChecks, connectivityChecks)
	} catch (error) {
		if (error instanceof EndpointCheckFailure) state.endpointChecks = withConnectivityChecks(state.endpointChecks, error.checks)
		throw error
	}
}

export async function updateSubmissionEndpointChecks(state: { endpointChecks: EndpointCheck[] }, check: () => Promise<readonly EndpointCheck[]>) {
	try {
		const submissionChecks = await check()
		state.endpointChecks = withSubmissionChecks(state.endpointChecks, submissionChecks)
	} catch (error) {
		if (error instanceof EndpointCheckFailure) state.endpointChecks = withSubmissionChecks(state.endpointChecks, error.checks)
		throw error
	}
}

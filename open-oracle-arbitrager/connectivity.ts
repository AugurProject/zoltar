import type { Hex } from '@zoltar/shared/ethereum'
import type { SubmissionSettings } from './transaction-submission.js'

export type NetworkName = 'mainnet' | 'sepolia'

export type ConnectivitySettings = {
	publicRpcUrls: readonly string[]
	readRpcUrl: string
}

export type EndpointCheck = {
	chainId: number | undefined
	checkedAt: string
	error: string | undefined
	kind: 'private-relay' | 'public-rpc' | 'read-rpc'
	status: 'failed' | 'healthy'
	target: string
}

type JsonRpcResponse = {
	error?: {
		code?: number
		message?: string
	}
	result?: unknown
}

class EndpointCheckFailure extends Error {
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
	const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]'
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) throw new Error('RPC URL must use HTTPS or loopback HTTP')
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
	const normalized = validateReadRpcUrls(values).filter(value => value !== normalizedPrimary)
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

async function rpcRequest(url: string, method: string, params: readonly unknown[], timeoutMilliseconds: number) {
	const response = await fetch(url, {
		body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params }),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(timeoutMilliseconds),
	})
	let value: JsonRpcResponse
	try {
		value = (await response.json()) as JsonRpcResponse
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`RPC returned non-JSON HTTP ${response.status.toString()}`)
		throw error
	}
	if (!response.ok) throw new Error(`RPC returned HTTP ${response.status.toString()}`)
	if (value.error !== undefined) throw new Error(`RPC ${value.error.code?.toString() ?? 'error'}: ${value.error.message ?? 'Unknown error'}`)
	return value.result
}

export async function readRpcChainId(url: string, timeoutMilliseconds = 5_000) {
	const result = await rpcRequest(url, 'eth_chainId', [], timeoutMilliseconds)
	if (typeof result !== 'string' || !/^0x[0-9a-fA-F]+$/.test(result)) throw new Error('RPC returned an invalid chain id')
	const chainId = Number(BigInt(result))
	if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('RPC returned an unsupported chain id')
	return chainId
}

export async function sendRawTransactionToRpc(url: string, serializedTransaction: Hex, timeoutMilliseconds = 10_000) {
	const result = await rpcRequest(url, 'eth_sendRawTransaction', [serializedTransaction], timeoutMilliseconds)
	if (typeof result !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(result)) throw new Error('RPC returned an invalid transaction hash')
	return result as Hex
}

export async function checkRpcEndpoint(url: string, expectedChainId: number, kind: EndpointCheck['kind']): Promise<EndpointCheck> {
	const checkedAt = new Date().toISOString()
	try {
		const chainId = await readRpcChainId(url)
		if (chainId !== expectedChainId) throw new Error(`Expected chain ${expectedChainId.toString()}, received ${chainId.toString()}`)
		return { chainId, checkedAt, error: undefined, kind, status: 'healthy', target: endpointLabel(url) }
	} catch (error) {
		return {
			chainId: undefined,
			checkedAt,
			error: error instanceof Error ? error.message : String(error),
			kind,
			status: 'failed',
			target: endpointLabel(url),
		}
	}
}

async function assertRelayMethodCapability(url: string, method: 'eth_callBundle' | 'eth_sendBundle', timeoutMilliseconds = 5_000) {
	const response = await fetch(url, {
		body: JSON.stringify({ id: 1, jsonrpc: '2.0', method, params: [] }),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(timeoutMilliseconds),
	})
	if (!response.ok) throw new Error(`Endpoint did not prove ${method} support: RPC returned HTTP ${response.status.toString()}`)
	let value: unknown
	try {
		value = await response.json()
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`Bundle relay capability check returned non-JSON HTTP ${response.status.toString()}`)
		throw error
	}
	if (typeof value !== 'object' || value === null || Array.isArray(value) || !('jsonrpc' in value) || value.jsonrpc !== '2.0' || !('id' in value) || (value.id !== 1 && value.id !== null) || !('error' in value) || 'result' in value) {
		throw new Error(`Endpoint did not prove ${method} support: expected one matching JSON-RPC 2.0 error from the intentionally invalid request`)
	}
	const error = value.error
	if (typeof error !== 'object' || error === null || Array.isArray(error) || !('code' in error) || typeof error.code !== 'number' || !Number.isSafeInteger(error.code) || !('message' in error) || typeof error.message !== 'string' || error.message.trim() === '') {
		throw new Error(`Endpoint did not prove ${method} support: malformed JSON-RPC error`)
	}
	const code = error.code
	const message = error.message.trim()
	const normalizedMessage = message.toLowerCase()
	const authenticationEvidence = normalizedMessage.includes('signature is required') || normalizedMessage.includes('invalid signature') || normalizedMessage.includes('authentication required') || normalizedMessage.includes('authentication is required')
	const parameterEvidence =
		normalizedMessage.includes('invalid params') || normalizedMessage.includes('invalid parameters') || normalizedMessage.includes('invalid argument') || normalizedMessage.includes('missing transaction') || normalizedMessage.includes('missing tx') || normalizedMessage.includes('invalid transaction')
	const recognizedCapabilityEvidence = (code === -32_600 && authenticationEvidence) || (code === -32_602 && parameterEvidence)
	if (!recognizedCapabilityEvidence) {
		throw new Error(`Endpoint did not prove ${method} support: RPC ${code.toString()}: ${message}`)
	}
}

async function checkPrivateRelayEndpoint(url: string, expectedChainId: number): Promise<EndpointCheck> {
	const checkedAt = new Date().toISOString()
	let chainId: number | undefined
	try {
		chainId = await readRpcChainId(url)
		if (chainId !== expectedChainId) throw new Error(`Expected chain ${expectedChainId.toString()}, received ${chainId.toString()}`)
		await assertRelayMethodCapability(url, 'eth_callBundle')
		await assertRelayMethodCapability(url, 'eth_sendBundle')
		return { chainId, checkedAt, error: undefined, kind: 'private-relay', status: 'healthy', target: endpointLabel(url) }
	} catch (error) {
		return {
			chainId,
			checkedAt,
			error: error instanceof Error ? error.message : String(error),
			kind: 'private-relay',
			status: 'failed',
			target: endpointLabel(url),
		}
	}
}

export async function checkConnectivity(settings: ConnectivitySettings, expectedChainId: number) {
	const checks = await Promise.all([checkRpcEndpoint(settings.readRpcUrl, expectedChainId, 'read-rpc'), ...settings.publicRpcUrls.map(url => checkRpcEndpoint(url, expectedChainId, 'public-rpc'))])
	const failed = checks.filter(check => check.status === 'failed')
	if (failed.length !== 0) throw new EndpointCheckFailure(failed.map(check => `${check.target}: ${check.error ?? 'endpoint check failed'}`).join('; '), checks)
	return checks
}

export async function checkSubmissionEndpoints(settings: SubmissionSettings, expectedChainId: number) {
	if (settings.mode === 'public') return []
	const checks = await Promise.all(settings.relayUrls.map(url => checkPrivateRelayEndpoint(url, expectedChainId)))
	const failed = checks.filter(check => check.status === 'failed')
	if (failed.length !== 0) throw new EndpointCheckFailure(failed.map(check => `${check.target}: ${check.error ?? 'relay check failed'}`).join('; '), checks)
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

import type { Address, Hex } from '../ethereum.ts'
import { bigintToSafeNumber, getAddress, keccak256, privateKeyToAccount } from '../ethereum.ts'
import type { SubmissionSettings } from '../execution/transaction-submission.ts'
import { authenticatedRelayHeaders, type RelayAuthentication } from '../execution/relay-authentication.ts'
import { boundedJsonResponse, DEFAULT_RPC_RESPONSE_BYTES } from '../infrastructure/bounded-json.ts'

export type { RelayAuthentication } from '../execution/relay-authentication.ts'

export type NetworkName = 'mainnet' | 'sepolia'

export type ConnectivitySettings = {
	publicRpcUrls: readonly string[]
	readRpcUrl: string
}

export type EndpointCheck = {
	authenticatedAddress?: Address | undefined
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

// A validly encoded legacy envelope with v=27, r=1, and s=0. secp256k1
// signatures require s >= 1, so no client can recover a sender or admit it.
export const TRANSACTION_SUBMISSION_CAPABILITY_PROBE = '0xdf800182520894000000000000000000000000000000000000000080801b0180' as const

type TransactionSubmissionMethod = 'eth_sendPrivateTransaction' | 'eth_sendRawTransaction'

function transactionRejectionEvidence(message: string) {
	return (
		message.includes('invalid transaction') ||
		message.includes('malformed transaction') ||
		message.includes('transaction rejected') ||
		message.includes('invalid sender') ||
		message.includes('invalid v, r, s') ||
		message.includes('failed to recover the signer') ||
		message.includes('failed to recover signer') ||
		message.includes('could not recover the signer') ||
		message.includes('could not recover signer') ||
		message.includes('transaction decode') ||
		message.includes('decode transaction') ||
		message.includes('failed to decode') ||
		message.includes('rlp')
	)
}

function publicTransactionRejectionEvidence(code: number, message: string) {
	return transactionRejectionEvidence(message) || (code === -32_602 && message === 'signature error')
}

function relayAuthenticationRejectionEvidence(message: string) {
	return (
		message.includes('authentication') ||
		message.includes('authorization') ||
		message.includes('not authorized') ||
		message.includes('unauthorized') ||
		message.includes('forbidden') ||
		message.includes('access denied') ||
		message.includes('permission denied') ||
		message.includes('signature is required') ||
		message.includes('signature required') ||
		message.includes('invalid signature') ||
		message.includes('bad signature') ||
		message.includes('signature verification') ||
		message.includes('flashbots signature') ||
		message.includes('flashbots-signature') ||
		message.includes('x-flashbots-signature')
	)
}

const RELAY_AUTHENTICATION_SUBJECTS = ['x-flashbots-signature', 'x-flashbots-signature header', 'flashbots signature', 'flashbots authentication', 'relay authentication', 'request authentication', 'authentication', 'authentication header', 'authorization header'] as const

function missingRelayAuthenticationEvidence(message: string) {
	const normalized = message.replace(/[.!]+$/, '').trim()
	return RELAY_AUTHENTICATION_SUBJECTS.some(subject => normalized === `${subject} required` || normalized === `${subject} is required` || normalized === `missing ${subject}` || normalized === `${subject} missing` || normalized === `${subject} is missing`)
}

function invalidRelayAuthenticationEvidence(message: string) {
	const normalized = message.replace(/[.!]+$/, '').trim()
	return RELAY_AUTHENTICATION_SUBJECTS.some(subject => normalized === `invalid ${subject}` || normalized === `${subject} invalid` || normalized === `${subject} is invalid` || normalized === `rejected ${subject}` || normalized === `${subject} rejected` || normalized === `${subject} was rejected`)
}

async function rawCapabilityErrorResponse(url: string, body: string, headers: Readonly<Record<string, string>>, parameters: { allowClientErrorResponse: boolean; alternateExpectedId?: 1 | null | undefined; expectedId: 1 | null; label: string; timeoutMilliseconds: number }) {
	const response = await fetch(url, {
		body,
		headers,
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(parameters.timeoutMilliseconds),
	})
	const boundedClientErrorResponse = response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 425 && response.status !== 429
	if (!response.ok && !(parameters.allowClientErrorResponse && boundedClientErrorResponse)) {
		const message = `${parameters.label}: RPC returned HTTP ${response.status.toString()}`
		if (response.status === 408 || response.status === 425 || response.status === 429 || response.status >= 500) throw new EndpointTransportError(message)
		throw new EndpointSafetyError(message)
	}
	let value: unknown
	try {
		value = await boundedJsonResponse(response, DEFAULT_RPC_RESPONSE_BYTES, parameters.label)
	} catch (error) {
		if (error instanceof SyntaxError) throw new EndpointSafetyError(`${parameters.label} returned a non-JSON response`)
		throw error
	}
	const responseIdMatches = typeof value === 'object' && value !== null && !Array.isArray(value) && 'id' in value && (value.id === parameters.expectedId || (parameters.alternateExpectedId !== undefined && value.id === parameters.alternateExpectedId))
	if (typeof value !== 'object' || value === null || Array.isArray(value) || !('jsonrpc' in value) || value.jsonrpc !== '2.0' || !responseIdMatches || !('error' in value) || 'result' in value) {
		throw new EndpointSafetyError(`${parameters.label} did not return the expected matching JSON-RPC 2.0 error`)
	}
	const error = value.error
	if (typeof error !== 'object' || error === null || Array.isArray(error) || !('code' in error) || typeof error.code !== 'number' || !Number.isSafeInteger(error.code) || !('message' in error) || typeof error.message !== 'string' || error.message.trim() === '') {
		throw new EndpointSafetyError(`${parameters.label} returned a malformed JSON-RPC error`)
	}
	return { code: error.code, message: error.message.trim(), status: response.status }
}

async function rawTransactionSubmissionCapabilityError(
	url: string,
	method: TransactionSubmissionMethod,
	authentication: RelayAuthentication | undefined,
	timeoutMilliseconds: number,
	responseParameters: { allowClientErrorResponse?: boolean | undefined; alternateExpectedId?: 1 | null | undefined; expectedId?: 1 | null | undefined; label?: string | undefined } = {},
) {
	const body = transactionSubmissionCapabilityBody(method)
	return await rawCapabilityErrorResponse(url, body, authentication === undefined ? { 'content-type': 'application/json' } : await authenticatedRelayHeaders(body, authentication), {
		allowClientErrorResponse: responseParameters.allowClientErrorResponse ?? false,
		alternateExpectedId: responseParameters.alternateExpectedId,
		expectedId: responseParameters.expectedId ?? 1,
		label: responseParameters.label ?? `Endpoint did not prove ${method} support`,
		timeoutMilliseconds,
	})
}

function transactionSubmissionCapabilityBody(method: TransactionSubmissionMethod) {
	return JSON.stringify({
		id: 1,
		jsonrpc: '2.0',
		method,
		params: method === 'eth_sendRawTransaction' ? [TRANSACTION_SUBMISSION_CAPABILITY_PROBE] : [{ tx: TRANSACTION_SUBMISSION_CAPABILITY_PROBE }],
	})
}

async function assertPublicTransactionSubmissionCapability(url: string, timeoutMilliseconds = 5_000) {
	try {
		const { code, message, status } = await rawTransactionSubmissionCapabilityError(url, 'eth_sendRawTransaction', undefined, timeoutMilliseconds)
		const recognizedCode = code === -32_602 || (code >= -32_099 && code <= -32_000)
		if (status === 200 && recognizedCode && publicTransactionRejectionEvidence(code, message.toLowerCase())) return
		throw new EndpointSafetyError(`Endpoint did not prove eth_sendRawTransaction support: HTTP ${status.toString()} RPC ${code.toString()}: ${message}`)
	} catch (error) {
		throw endpointMethodFailure(error, url, 'eth_sendRawTransaction')
	}
}

const PRIVATE_TRANSACTION_METHOD_CONTROL = 'zoltar_unsupportedRelayCapabilityProbe_f8b1e7c34d929a650c42bf176f80e2196a7d44ce53239018bd631cc9a4e5702f'
const FLASHBOTS_MAINNET_RELAY_ORIGIN = 'https://relay.flashbots.net'
const FLASHBOTS_SEPOLIA_RELAY_ORIGIN = 'https://relay-sepolia.flashbots.net'
// Public, unfunded deterministic canaries used only to produce a recoverable
// EIP-191 signature that intentionally does not match another canary address.
const RELAY_AUTHENTICATION_MISMATCH_CANARY_KEYS: readonly Hex[] = [`0x${'01'.repeat(32)}`, `0x${'02'.repeat(32)}`, `0x${'03'.repeat(32)}`]

export function flashbotsPrivateTransactionCompatibilityProfileAllowed(url: string, expectedChainId: number) {
	const parsed = new URL(url)
	const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]'
	const officialOrigin = expectedChainId === 1 ? FLASHBOTS_MAINNET_RELAY_ORIGIN : expectedChainId === 11_155_111 ? FLASHBOTS_SEPOLIA_RELAY_ORIGIN : undefined
	return loopback || parsed.origin === officialOrigin
}

function privateCapabilityControlBody(method: string, params: readonly unknown[]) {
	return JSON.stringify({ id: 1, jsonrpc: '2.0', method, params })
}

async function authenticatedPrivateCapabilityControlError(url: string, method: string, params: readonly unknown[], authentication: RelayAuthentication, parameters: { allowClientErrorResponse: boolean; expectedId: 1 | null; label: string; timeoutMilliseconds: number }) {
	const body = privateCapabilityControlBody(method, params)
	return await rawCapabilityErrorResponse(url, body, await authenticatedRelayHeaders(body, authentication), parameters)
}

async function assertFlashbotsPrivateTransactionControls(url: string, authentication: RelayAuthentication, timeoutMilliseconds: number) {
	const unsupported = await authenticatedPrivateCapabilityControlError(url, PRIVATE_TRANSACTION_METHOD_CONTROL, [], authentication, {
		allowClientErrorResponse: true,
		expectedId: 1,
		label: 'Private transaction unsupported-method control',
		timeoutMilliseconds,
	})
	if (unsupported.status !== 403 || unsupported.code !== -32_601 || unsupported.message.trim().toLowerCase() !== 'rpc method is not whitelisted') {
		throw new EndpointSafetyError(`Private transaction unsupported-method control returned HTTP ${unsupported.status.toString()} RPC ${unsupported.code.toString()}: ${unsupported.message}`)
	}

	// This is the hash of the impossible-signature envelope above. The envelope
	// cannot enter a relay, so asking to cancel its hash cannot cancel bot work.
	const cancellationHash = keccak256(TRANSACTION_SUBMISSION_CAPABILITY_PROBE)
	const cancellationParams = [{ txHash: cancellationHash }]
	const authenticatedCancellation = await authenticatedPrivateCapabilityControlError(url, 'eth_cancelPrivateTransaction', cancellationParams, authentication, {
		allowClientErrorResponse: false,
		expectedId: 1,
		label: 'Authenticated private transaction cancellation control',
		timeoutMilliseconds,
	})
	if (authenticatedCancellation.status !== 200 || authenticatedCancellation.code !== -32_700 || authenticatedCancellation.message.trim().toLowerCase() !== 'tx not found') {
		throw new EndpointSafetyError(`Authenticated private transaction cancellation control returned HTTP ${authenticatedCancellation.status.toString()} RPC ${authenticatedCancellation.code.toString()}: ${authenticatedCancellation.message}`)
	}

	const unauthenticatedBody = privateCapabilityControlBody('eth_cancelPrivateTransaction', cancellationParams)
	const unauthenticatedCancellation = await rawCapabilityErrorResponse(
		url,
		unauthenticatedBody,
		{ 'content-type': 'application/json' },
		{
			allowClientErrorResponse: true,
			expectedId: null,
			label: 'Unauthenticated private transaction cancellation control',
			timeoutMilliseconds,
		},
	)
	if (unauthenticatedCancellation.status !== 200 || unauthenticatedCancellation.code !== -32_600 || unauthenticatedCancellation.message.trim().toLowerCase() !== 'signature is required') {
		throw new EndpointSafetyError(`Unauthenticated private transaction cancellation control returned HTTP ${unauthenticatedCancellation.status.toString()} RPC ${unauthenticatedCancellation.code.toString()}: ${unauthenticatedCancellation.message}`)
	}
}

async function assertUnauthenticatedPrivateTransactionIsRejected(url: string, timeoutMilliseconds: number) {
	const { code, message, status } = await rawTransactionSubmissionCapabilityError(url, 'eth_sendPrivateTransaction', undefined, timeoutMilliseconds, {
		allowClientErrorResponse: true,
		alternateExpectedId: null,
		expectedId: 1,
		label: 'Unauthenticated private transaction control',
	})
	const normalizedMessage = message.toLowerCase()
	const recognizedStatus = status === 200 || status === 401 || status === 403
	const recognizedCode = code === -32_602 || code === -32_600 || (code >= -32_099 && code <= -32_000)
	if (recognizedStatus && recognizedCode && missingRelayAuthenticationEvidence(normalizedMessage) && !transactionRejectionEvidence(normalizedMessage)) return
	throw new EndpointSafetyError(`Endpoint did not prove relay authentication enforcement: HTTP ${status.toString()} RPC ${code.toString()}: ${message}`)
}

async function assertDirectRelayAuthenticationValidation(url: string, authentication: RelayAuthentication, expectedParserResponse: { code: number; message: string; status: number }, timeoutMilliseconds: number) {
	const body = transactionSubmissionCapabilityBody('eth_sendPrivateTransaction')
	const configuredAddress = getAddress(authentication.address)
	const [claimedCanary, signingCanary] = RELAY_AUTHENTICATION_MISMATCH_CANARY_KEYS.map(privateKeyToAccount).filter(account => account.address !== configuredAddress)
	if (claimedCanary === undefined || signingCanary === undefined || claimedCanary.address === signingCanary.address) throw new EndpointSafetyError('Two distinct relay-authentication mismatch canaries are required')
	const validCanaryResponse = await rawCapabilityErrorResponse(url, body, await authenticatedRelayHeaders(body, claimedCanary), {
		allowClientErrorResponse: false,
		expectedId: 1,
		label: 'Valid private relay canary authentication control',
		timeoutMilliseconds,
	})
	const validCanaryMessage = validCanaryResponse.message.toLowerCase()
	if (validCanaryResponse.status !== expectedParserResponse.status || validCanaryResponse.code !== expectedParserResponse.code || validCanaryResponse.message !== expectedParserResponse.message || relayAuthenticationRejectionEvidence(validCanaryMessage) || !transactionRejectionEvidence(validCanaryMessage)) {
		throw new EndpointSafetyError(`Endpoint did not prove valid canary relay authentication before transaction parsing: HTTP ${validCanaryResponse.status.toString()} RPC ${validCanaryResponse.code.toString()}: ${validCanaryResponse.message}`)
	}
	const mismatchedSignature = await signingCanary.signMessage(keccak256(body))
	const { code, message, status } = await rawCapabilityErrorResponse(
		url,
		body,
		{ 'content-type': 'application/json', 'x-flashbots-signature': `${claimedCanary.address}:${mismatchedSignature}` },
		{
			allowClientErrorResponse: true,
			alternateExpectedId: null,
			expectedId: 1,
			label: 'Invalid private relay authentication control',
			timeoutMilliseconds,
		},
	)
	const normalizedMessage = message.toLowerCase()
	const recognizedCode = code === -32_602 || code === -32_600 || (code >= -32_099 && code <= -32_000)
	if ((status === 401 || status === 403) && recognizedCode && invalidRelayAuthenticationEvidence(normalizedMessage) && !transactionRejectionEvidence(normalizedMessage)) return
	throw new EndpointSafetyError(`Endpoint did not prove relay authentication signature validation: HTTP ${status.toString()} RPC ${code.toString()}: ${message}`)
}

async function assertAuthenticatedPrivateTransactionSubmissionCapability(url: string, expectedChainId: number, authentication: RelayAuthentication, timeoutMilliseconds = 5_000) {
	try {
		const { code, message, status } = await rawTransactionSubmissionCapabilityError(url, 'eth_sendPrivateTransaction', authentication, timeoutMilliseconds)
		const normalizedMessage = message.toLowerCase()
		if (status === 200 && code === -32_602 && !relayAuthenticationRejectionEvidence(normalizedMessage) && transactionRejectionEvidence(normalizedMessage)) {
			await assertUnauthenticatedPrivateTransactionIsRejected(url, timeoutMilliseconds)
			await assertDirectRelayAuthenticationValidation(url, authentication, { code, message, status }, timeoutMilliseconds)
			return
		}
		if (status === 200 && code === -32_600 && normalizedMessage === 'incorrect request') {
			if (!flashbotsPrivateTransactionCompatibilityProfileAllowed(url, expectedChainId)) throw new EndpointSafetyError('Generic Flashbots private-transaction compatibility evidence is restricted to the official relay matching the configured chain or a loopback test relay')
			await assertFlashbotsPrivateTransactionControls(url, authentication, timeoutMilliseconds)
			return
		}
		throw new EndpointSafetyError(`Endpoint did not prove authenticated eth_sendPrivateTransaction support: HTTP ${status.toString()} RPC ${code.toString()}: ${message}`)
	} catch (error) {
		throw endpointMethodFailure(error, url, 'eth_sendPrivateTransaction')
	}
}

async function checkPublicTransactionSubmissionEndpoint(url: string, expectedChainId: number): Promise<EndpointCheck> {
	const checkedAt = new Date().toISOString()
	let chainId: number | undefined
	try {
		chainId = await readRpcChainId(url)
		if (chainId !== expectedChainId) throw endpointMethodFailure(new Error(`Expected chain ${expectedChainId.toString()}, received ${chainId.toString()}`), url, 'eth_chainId')
		await assertPublicTransactionSubmissionCapability(url)
		return { chainId, checkedAt, error: undefined, kind: 'public-rpc', status: 'healthy', target: endpointLabel(url) }
	} catch (error) {
		return {
			chainId,
			checkedAt,
			error: error instanceof Error ? error.message : String(error),
			failureDisposition: endpointFailureDisposition(error),
			kind: 'public-rpc',
			status: 'failed',
			target: endpointLabel(url),
		}
	}
}

type RelayMethod = 'eth_callBundle' | 'eth_sendBundle'

async function rawRelayCapabilityError(url: string, requestedMethod: string, capabilityMethod: RelayMethod, timeoutMilliseconds: number) {
	const response = await fetch(url, {
		body: JSON.stringify({ id: 1, jsonrpc: '2.0', method: requestedMethod, params: [] }),
		headers: { 'content-type': 'application/json' },
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(timeoutMilliseconds),
	})
	if (!response.ok) {
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
	if (code === -32_600 && authenticationEvidence) return
	throw new EndpointSafetyError(`Endpoint did not prove ${method} support: RPC ${code.toString()}: ${message}`)
}

async function assertRelayMethodCapability(url: string, method: RelayMethod, timeoutMilliseconds = 5_000) {
	try {
		await rawAssertRelayMethodCapability(url, method, timeoutMilliseconds)
	} catch (error) {
		throw endpointMethodFailure(error, url, method)
	}
}

async function checkPrivateTransactionRelayEndpoint(url: string, expectedChainId: number, authentication: RelayAuthentication): Promise<EndpointCheck> {
	const checkedAt = new Date().toISOString()
	const authenticatedAddress = getAddress(authentication.address)
	let chainId: number | undefined
	try {
		chainId = await readRpcChainId(url)
		if (chainId !== expectedChainId) throw endpointMethodFailure(new Error(`Expected chain ${expectedChainId.toString()}, received ${chainId.toString()}`), url, 'eth_chainId')
		await assertAuthenticatedPrivateTransactionSubmissionCapability(url, expectedChainId, authentication)
		return { authenticatedAddress, chainId, checkedAt, error: undefined, kind: 'private-relay', status: 'healthy', target: endpointLabel(url) }
	} catch (error) {
		return {
			authenticatedAddress,
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
	const safetyFailure = failed.find(check => check.failureDisposition !== 'connectivity-degraded')
	const healthyOriginCount = new Set(checks.filter(check => check.status === 'healthy').map(check => check.target)).size
	if (safetyFailure !== undefined || healthyOriginCount < settings.minimumBundleRelaySuccesses) {
		throw new EndpointCheckFailure(failed.map(check => (check.error?.includes(check.target) ? check.error : `${check.target}: ${check.error ?? 'relay check failed'}`)).join('; '), checks)
	}
	return checks
}

function checkedSubmissionThreshold(checks: readonly EndpointCheck[], requiredHealthyOriginCount: number, failureLabel: string) {
	const failed = checks.filter(check => check.status === 'failed')
	const safetyFailure = failed.find(check => check.failureDisposition !== 'connectivity-degraded')
	const healthyOriginCount = new Set(checks.filter(check => check.status === 'healthy').map(check => check.target)).size
	if (safetyFailure !== undefined || healthyOriginCount < requiredHealthyOriginCount) {
		throw new EndpointCheckFailure(failed.map(check => (check.error?.includes(check.target) ? check.error : `${check.target}: ${check.error ?? failureLabel}`)).join('; '), checks)
	}
	return checks
}

export async function checkPublicTransactionSubmissionEndpoints(publicRpcUrls: readonly string[], expectedChainId: number) {
	if (publicRpcUrls.length === 0) throw new Error('Public submission preflight requires at least one RPC URL')
	return checkedSubmissionThreshold(await Promise.all(publicRpcUrls.map(url => checkPublicTransactionSubmissionEndpoint(url, expectedChainId))), 1, 'public transaction endpoint check failed')
}

export async function checkPrivateTransactionSubmissionEndpoints(settings: SubmissionSettings, expectedChainId: number, authentication: RelayAuthentication) {
	if (settings.mode === 'public') return []
	return checkedSubmissionThreshold(await Promise.all(settings.relayUrls.map(url => checkPrivateTransactionRelayEndpoint(url, expectedChainId, authentication))), settings.minimumBundleRelaySuccesses, 'private transaction relay check failed')
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

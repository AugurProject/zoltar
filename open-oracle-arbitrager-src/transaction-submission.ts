import { getAddress, keccak256, type Address, type BlockTransaction, type Hex } from '@zoltar/shared/ethereum'

export type SubmissionMode = 'private' | 'public'

export type SubmissionSettings = {
	mode: SubmissionMode
	relayUrls: readonly string[]
}

export type SubmissionTargetResult = {
	error: string | undefined
	target: string
}

export type SubmittedTransaction = {
	acceptedTargets: readonly string[]
	failedTargets: readonly SubmissionTargetResult[]
	hash: Hex
	mode: SubmissionMode
}

export type SignedTransaction = {
	hash: Hex
	lastValidBlockNumber: bigint | undefined
	maxBlockNumber: bigint
	serializedTransaction: Hex
	transaction: BlockTransaction
}

export class SubmissionFailure extends Error {
	readonly failedTargets: readonly SubmissionTargetResult[]

	constructor(message: string, failedTargets: readonly SubmissionTargetResult[]) {
		super(message)
		this.name = 'SubmissionFailure'
		this.failedTargets = failedTargets
	}
}

type JsonRpcResponse = {
	error?: {
		code?: number
		message?: string
	}
	result?: unknown
}

function relayUrl(value: string) {
	if (value.length > 2_048) throw new Error('Relay URLs must not exceed 2048 characters')
	let parsed: URL
	try {
		parsed = new URL(value)
	} catch (error) {
		if (error instanceof TypeError) throw new Error(`Invalid relay URL: ${value}`)
		throw error
	}
	const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' || parsed.hostname === '[::1]'
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) throw new Error(`Relay URL must use HTTPS or loopback HTTP: ${value}`)
	if (parsed.username !== '' || parsed.password !== '') throw new Error('Relay URLs must not contain embedded credentials')
	if (value.includes('?')) throw new Error('Relay URLs must not contain query parameters')
	if (value.includes('#')) throw new Error('Relay URLs must not contain fragments')
	return parsed.toString()
}

export function validateSubmissionSettings(value: unknown): SubmissionSettings {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Submission settings must be a JSON object')
	const record = value as Record<string, unknown>
	const keys = Object.keys(record)
	if (keys.length !== 2 || !keys.includes('mode') || !keys.includes('relayUrls')) throw new Error('Submission settings require only mode and relayUrls')
	if (record['mode'] !== 'public' && record['mode'] !== 'private') throw new Error('Submission mode must be public or private')
	const rawRelayUrls = record['relayUrls']
	if (!Array.isArray(rawRelayUrls) || rawRelayUrls.some(url => typeof url !== 'string')) throw new Error('Relay URLs must be an array of strings')
	if (rawRelayUrls.length > 8) throw new Error('At most 8 relay URLs are supported')
	const normalizedRelayUrls: string[] = []
	for (const value of rawRelayUrls) {
		if (typeof value !== 'string') throw new Error('Relay URLs must be an array of strings')
		normalizedRelayUrls.push(relayUrl(value.trim()))
	}
	const relayUrls = [...new Set(normalizedRelayUrls)]
	if (record['mode'] === 'private' && relayUrls.length === 0) throw new Error('Private submission requires at least one relay URL')
	return {
		mode: record['mode'],
		relayUrls,
	}
}

export function assertSubmissionWindowOpen(lastValidBlockNumber: bigint | undefined, currentBlockNumber: bigint) {
	if (lastValidBlockNumber !== undefined && currentBlockNumber >= lastValidBlockNumber) throw new Error('Transaction validity window expired before submission')
}

export async function prepareSignedTransaction(parameters: {
	baseFeePerGas: bigint
	blockNumber: bigint
	data: Hex
	from: Address
	gasEstimate: bigint
	lastValidBlockNumber?: bigint | undefined
	nonce: bigint
	signTransaction: (parameters: { chainId: number; data: Hex; gas: bigint; maxFeePerGas: bigint; maxPriorityFeePerGas: bigint; nonce: bigint; to: Address }) => Promise<Hex>
	to: Address
}): Promise<SignedTransaction> {
	assertSubmissionWindowOpen(parameters.lastValidBlockNumber, parameters.blockNumber)
	const maxPriorityFeePerGas = 2n * 10n ** 9n
	const gas = parameters.gasEstimate + parameters.gasEstimate / 5n + 10_000n
	const maxFeePerGas = parameters.baseFeePerGas * 2n + maxPriorityFeePerGas
	const serializedTransaction = await parameters.signTransaction({
		chainId: 1,
		data: parameters.data,
		gas,
		maxFeePerGas,
		maxPriorityFeePerGas,
		nonce: parameters.nonce,
		to: parameters.to,
	})
	const hash = keccak256(serializedTransaction)
	const defaultMaxBlockNumber = parameters.blockNumber + 25n
	return {
		hash,
		lastValidBlockNumber: parameters.lastValidBlockNumber,
		maxBlockNumber: parameters.lastValidBlockNumber === undefined || parameters.lastValidBlockNumber > defaultMaxBlockNumber ? defaultMaxBlockNumber : parameters.lastValidBlockNumber,
		serializedTransaction,
		transaction: {
			from: parameters.from,
			gas,
			hash,
			input: parameters.data,
			maxFeePerGas,
			maxPriorityFeePerGas,
			nonce: parameters.nonce,
			to: parameters.to,
			type: 'eip1559',
			value: 0n,
		},
	}
}

function targetLabel(value: string) {
	const url = new URL(value)
	return `${url.origin}${url.pathname}`
}

function responseError(response: JsonRpcResponse, status: number) {
	if (response.error !== undefined) return `RPC ${response.error.code?.toString() ?? 'error'}: ${response.error.message ?? 'Unknown relay error'}`
	return `Relay returned HTTP ${status.toString()} without a transaction hash`
}

async function sendPrivateTransaction(parameters: { address: Address; hash: Hex; maxBlockNumber: bigint; relayUrl: string; serializedTransaction: Hex; signMessage: (message: string | Uint8Array) => Promise<Hex>; timeoutMilliseconds: number }) {
	const body = JSON.stringify({
		id: 1,
		jsonrpc: '2.0',
		method: 'eth_sendPrivateTransaction',
		params: [
			{
				maxBlockNumber: `0x${parameters.maxBlockNumber.toString(16)}`,
				tx: parameters.serializedTransaction,
			},
		],
	})
	const signature = await parameters.signMessage(keccak256(body))
	const response = await fetch(parameters.relayUrl, {
		body,
		headers: {
			'content-type': 'application/json',
			'x-flashbots-signature': `${getAddress(parameters.address)}:${signature}`,
		},
		method: 'POST',
		redirect: 'error',
		signal: AbortSignal.timeout(parameters.timeoutMilliseconds),
	})
	let value: JsonRpcResponse
	try {
		value = (await response.json()) as JsonRpcResponse
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`Relay returned non-JSON HTTP ${response.status.toString()}`)
		throw error
	}
	if (!response.ok || typeof value.result !== 'string') throw new Error(responseError(value, response.status))
	if (value.result.toLowerCase() !== parameters.hash.toLowerCase()) throw new Error(`Relay returned unexpected transaction hash ${value.result}`)
}

export async function submitSignedTransaction(parameters: {
	address: Address
	hash: Hex
	maxBlockNumber: bigint
	publicSubmit: (serializedTransaction: Hex) => Promise<Hex>
	relayTimeoutMilliseconds?: number | undefined
	serializedTransaction: Hex
	settings: SubmissionSettings
	signMessage: (message: string | Uint8Array) => Promise<Hex>
}): Promise<SubmittedTransaction> {
	if (parameters.settings.mode === 'public') {
		const returnedHash = await parameters.publicSubmit(parameters.serializedTransaction)
		if (returnedHash.toLowerCase() !== parameters.hash.toLowerCase()) throw new Error(`Public RPC returned unexpected transaction hash ${returnedHash}`)
		return {
			acceptedTargets: ['public mempool'],
			failedTargets: [],
			hash: parameters.hash,
			mode: 'public',
		}
	}
	const settled = await Promise.allSettled(
		parameters.settings.relayUrls.map(url =>
			sendPrivateTransaction({
				address: parameters.address,
				hash: parameters.hash,
				maxBlockNumber: parameters.maxBlockNumber,
				relayUrl: url,
				serializedTransaction: parameters.serializedTransaction,
				signMessage: parameters.signMessage,
				timeoutMilliseconds: parameters.relayTimeoutMilliseconds ?? 10_000,
			}),
		),
	)
	const acceptedTargets: string[] = []
	const failedTargets: SubmissionTargetResult[] = []
	for (const [index, result] of settled.entries()) {
		const relay = parameters.settings.relayUrls[index]
		if (relay === undefined) throw new Error('Missing relay URL for submission result')
		const target = targetLabel(relay)
		if (result.status === 'fulfilled') acceptedTargets.push(target)
		else failedTargets.push({ error: result.reason instanceof Error ? result.reason.message : String(result.reason), target })
	}
	if (acceptedTargets.length === 0) throw new SubmissionFailure(`Every private relay rejected the transaction: ${failedTargets.map(result => `${result.target}: ${result.error ?? 'unknown error'}`).join('; ')}`, failedTargets)
	return {
		acceptedTargets,
		failedTargets,
		hash: parameters.hash,
		mode: 'private',
	}
}

export function mergeSubmissionFailures(previous: readonly SubmissionTargetResult[], error: unknown) {
	const latest =
		error instanceof SubmissionFailure
			? error.failedTargets
			: [
					{
						error: error instanceof Error ? error.message : String(error),
						target: 'private relay resubmission',
					},
				]
	const merged = new Map(previous.map(result => [result.target, result]))
	for (const result of latest) merged.set(result.target, result)
	return [...merged.values()]
}

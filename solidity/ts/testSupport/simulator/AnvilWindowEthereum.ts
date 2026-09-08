import type { EthereumBytes32, EthereumData, EthereumQuantity, EthereumQuantitySmall } from './types/wire-types'
import { ensureDefined } from './utils/testUtils'
import { ensureArray } from './utils/array-utils'
import { collectBytecodeCoverageForCall, collectBytecodeCoverageForTransaction, invalidateSolidityBytecodeCoverageAddressCache, resetSolidityBytecodeCoverageAddressCache } from '../../coverage/traceToSource'

type BlockTimeManipulation = { readonly type: 'AddToTimestamp'; readonly deltaToAdd: EthereumQuantity } | { readonly type: 'SetTimestamp'; readonly timeToSet: EthereumQuantity }

type AccountOverride = {
	readonly stateDiff?: Readonly<Record<string, EthereumBytes32>>
	readonly nonce?: EthereumQuantitySmall
	readonly balance?: EthereumQuantity
	readonly code?: EthereumData
}

type GetBlockReturn = {
	readonly timestamp: bigint
}

type StateOverrides = Readonly<Record<string, AccountOverride>>

type JsonRpcSuccess = {
	jsonrpc: string
	id: number | string
	result?: unknown
	error?: { code: number; message: string; data?: unknown }
}

export class JsonRpcError extends Error {
	readonly code: number
	readonly data?: unknown

	constructor(error: { code: number; message: string; data?: unknown }, options?: { cause?: unknown }) {
		super(error.message, options)
		this.name = 'JsonRpcError'
		this.code = error.code
		if ('data' in error) this.data = error.data
	}
}

type RpcBlock = {
	readonly timestamp?: string
}

type RpcTransactionReceipt = {
	readonly status?: string
	readonly to?: string
	readonly contractAddress?: string
}

type RpcTransactionRequest = {
	readonly from?: string
	readonly to?: string
	readonly data?: string
	readonly gas?: string
	readonly gasPrice?: string
	readonly maxFeePerGas?: string
	readonly maxPriorityFeePerGas?: string
	readonly type?: string
}

type EthCallCoverageRequest = {
	readonly transaction: RpcTransactionRequest
	readonly blockNumberOrHash?: unknown
	readonly stateOverrides?: unknown
	readonly blockOverrides?: unknown
}

const DEFAULT_ANVIL_TRANSACTION_GAS = '0x1c9c380'
// CI can keep Anvil receipts pending well past a minute when multiple shards
// are driving simulator-backed transactions concurrently.
const SEND_TRANSACTION_RECEIPT_TIMEOUT_MS = 180_000
const SEND_TRANSACTION_RECEIPT_POLL_INTERVAL_MS = 100
const SEND_TRANSACTION_RECEIPT_MINE_INTERVAL_MS = 1_000
const RECEIPT_DIAGNOSTIC_RPC_TIMEOUT_MS = 1_000

const isObjectRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null

const parseTransactionReceipt = (value: unknown): RpcTransactionReceipt | undefined => {
	if (!isObjectRecord(value)) return undefined
	const typed = value
	return {
		...(typeof typed['status'] === 'string' ? { status: typed['status'] } : {}),
		...(typeof typed['to'] === 'string' ? { to: typed['to'] } : {}),
		...(typeof typed['contractAddress'] === 'string' ? { contractAddress: typed['contractAddress'] } : {}),
	}
}

const formatRpcDiagnosticValue = (value: unknown): string => {
	if (typeof value === 'string') return value
	try {
		return JSON.stringify(value) ?? String(value)
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error)
		return `${String(value)} (JSON serialization failed: ${errorMessage})`
	}
}

function hasJsonRpcBaseFields(value: unknown): value is { jsonrpc: string; id: number | string } {
	return typeof value === 'object' && value !== null && 'jsonrpc' in value && 'id' in value && typeof value.jsonrpc === 'string' && (typeof value.id === 'number' || typeof value.id === 'string')
}

function isJsonRpcError(value: unknown): value is { code: number; message: string; data?: unknown } {
	return typeof value === 'object' && value !== null && 'code' in value && Number.isInteger(value.code) && 'message' in value && typeof value.message === 'string'
}

function isRpcTransactionRequest(value: unknown): value is RpcTransactionRequest {
	return typeof value === 'object' && value !== null
}

function parseEthCallCoverageRequest(params: readonly unknown[]): EthCallCoverageRequest | undefined {
	const [transaction, blockNumberOrHash, stateOverrides, blockOverrides] = params
	if (!isRpcTransactionRequest(transaction)) return undefined
	return {
		transaction,
		...(blockNumberOrHash !== undefined ? { blockNumberOrHash } : {}),
		...(stateOverrides !== undefined ? { stateOverrides } : {}),
		...(blockOverrides !== undefined ? { blockOverrides } : {}),
	}
}

export function normalizeAnvilTransactionParams(params: unknown[]) {
	const [firstParam, ...remainingParams] = params
	if (!isRpcTransactionRequest(firstParam)) return params

	const normalizedTransactionRequest: Record<string, unknown> = {
		...firstParam,
		gas: firstParam.gas ?? DEFAULT_ANVIL_TRANSACTION_GAS,
		gasPrice: firstParam.gasPrice ?? '0x0',
	}

	delete normalizedTransactionRequest['maxFeePerGas']
	delete normalizedTransactionRequest['maxPriorityFeePerGas']
	delete normalizedTransactionRequest['type']

	return [normalizedTransactionRequest, ...remainingParams]
}

export function parseJsonRpcResponse(raw: unknown, expectedId: number | string): JsonRpcSuccess {
	if (typeof raw !== 'object' || raw === null) throw new Error('Invalid JSON-RPC response: not an object')
	if (!hasJsonRpcBaseFields(raw)) throw new Error('Invalid JSON-RPC response: missing base fields')
	if (raw.jsonrpc !== '2.0') throw new Error(`Invalid JSON-RPC version: expected '2.0', got '${raw.jsonrpc}'`)
	if (raw.id !== expectedId) throw new Error(`Invalid JSON-RPC response id: expected ${String(expectedId)}, got ${String(raw.id)}`)
	const hasResult = 'result' in raw
	const hasError = 'error' in raw
	if (hasResult === hasError) throw new Error('Invalid JSON-RPC response: expected exactly one of result or error')
	if ('error' in raw && raw.error !== undefined && !isJsonRpcError(raw.error)) throw new Error('Invalid JSON-RPC response: malformed error object')

	return raw
}

const CANONICAL_QUANTITY = /^0x(?:0|[1-9a-f][0-9a-f]*)$/
const TRANSACTION_HASH = /^0x[0-9a-fA-F]{64}$/

export function validateRpcResult(method: string, value: unknown, context: { transactionHash?: string } = {}): void {
	if (['eth_chainId', 'eth_blockNumber'].includes(method) && (typeof value !== 'string' || !CANONICAL_QUANTITY.test(value))) throw new Error(`Invalid ${method} response: expected canonical quantity`)
	if (['eth_sendTransaction', 'wallet_sendTransaction', 'eth_sendRawTransaction'].includes(method) && (typeof value !== 'string' || !TRANSACTION_HASH.test(value))) throw new Error(`Invalid ${method} response: expected transaction hash`)
	if (method === 'anvil_snapshot' && (typeof value !== 'string' || !CANONICAL_QUANTITY.test(value))) throw new Error('Invalid anvil_snapshot response: expected canonical snapshot id')
	if (['anvil_revert', 'anvil_getAutomine'].includes(method) && typeof value !== 'boolean') throw new Error(`Invalid ${method} response: expected boolean`)
	if (method === 'eth_getTransactionReceipt' && value !== null) {
		if (!isObjectRecord(value)) throw new Error('Invalid eth_getTransactionReceipt response: expected receipt or null')
		const status = value['status']
		if (status !== '0x0' && status !== '0x1') throw new Error('Invalid eth_getTransactionReceipt response: status must be 0x0 or 0x1')
		const transactionHash = value['transactionHash']
		if (typeof transactionHash !== 'string' || !TRANSACTION_HASH.test(transactionHash)) throw new Error('Invalid eth_getTransactionReceipt response: expected transaction hash')
		if (context.transactionHash !== undefined && transactionHash.toLowerCase() !== context.transactionHash.toLowerCase()) throw new Error('Invalid eth_getTransactionReceipt response: receipt does not belong to the submitted hash')
	}
}

const fetchJsonRpcResponse = async ({ body, method, rpcUrl, timeoutMs }: { body: string; method: string; rpcUrl: string; timeoutMs?: number }): Promise<unknown> => {
	const controller = timeoutMs === undefined ? undefined : new AbortController()
	const timeoutId = controller === undefined || timeoutMs === undefined ? undefined : setTimeout(() => controller.abort(), timeoutMs)
	try {
		const response = await fetch(rpcUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body,
			...(controller === undefined ? {} : { signal: controller.signal }),
		})
		if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		return await response.json()
	} catch (error) {
		if (controller?.signal.aborted === true && timeoutMs !== undefined) throw new Error(`Anvil RPC ${method} did not respond within ${timeoutMs.toString()}ms`)
		throw error
	} finally {
		if (timeoutId !== undefined) clearTimeout(timeoutId)
	}
}

function parseSnapshotId(value: unknown) {
	if (typeof value !== 'string') throw new Error('Invalid anvil_snapshot response: expected string snapshot id')
	return value
}

function parseBlockTimestamp(value: unknown): bigint | undefined {
	if (typeof value !== 'object' || value === null || !('timestamp' in value)) return undefined
	const { timestamp } = value as RpcBlock
	if (typeof timestamp !== 'string') return undefined
	return BigInt(timestamp)
}

function parseTransactionReceiptStatus(value: unknown): string | undefined {
	if (typeof value !== 'object' || value === null || !('status' in value)) return undefined
	const { status } = value as RpcTransactionReceipt
	return typeof status === 'string' ? status : undefined
}

function parseTransactionInput(value: unknown): string | undefined {
	if (!isObjectRecord(value)) return undefined
	const input = value['input'] ?? value['data']
	return typeof input === 'string' ? input : undefined
}

export interface AnvilWindowEthereum {
	addStateOverrides: (stateOverrides: StateOverrides) => Promise<void>
	manipulateTime: (blockTimeManipulation: BlockTimeManipulation) => Promise<void>
	getTime: () => Promise<bigint>
	getBlock: () => Promise<GetBlockReturn>
	advanceTime: (amountInSeconds: bigint) => Promise<void>
	setTime: (timestamp: bigint) => Promise<void>
	resetToCleanState: () => Promise<void>
	setNextBlockBaseFeePerGasToZero: () => Promise<void>
	impersonateAccount: (address: string) => Promise<void>
	setBalance: (address: string, amount: bigint) => Promise<void>
	anvilSnapshot: () => Promise<string>
	anvilRevert: (snapshotId: string) => Promise<void>
	request: (args: { method: string; params?: unknown }) => Promise<unknown>
	requestRaw: (args: { method: string; params?: unknown }) => Promise<unknown>
	on: () => void
	removeListener: () => void
}

export class AnvilSnapshotUnavailableError extends Error {
	constructor(snapshotId: string) {
		super(`Anvil snapshot is missing or already consumed: ${snapshotId}`)
		this.name = 'AnvilSnapshotUnavailableError'
	}
}

export const getDefaultAnvilRpcUrl = (): string => 'http://127.0.0.1:8545'

export const validateLocalAnvilRpcUrl = (url: string): void => {
	let parsed: URL
	try {
		parsed = new URL(url)
	} catch (error) {
		const detail = error instanceof Error ? ` ${error.message}` : ''
		throw new Error(`Invalid local Anvil RPC URL: ${url}. Must be a valid HTTP URL.${detail}`)
	}

	if (parsed.protocol !== 'http:') throw new Error(`Invalid local Anvil RPC URL: ${url}. Must use http:// for a local Anvil endpoint.`)

	const allowedHosts = ['localhost', '127.0.0.1', '::1', '[::1]', 'host.docker.internal']
	if (!allowedHosts.includes(parsed.hostname)) throw new Error(`Anvil RPC points to unauthorized host '${parsed.hostname}'. Test RPC endpoints must be local (localhost, 127.0.0.1, ::1, host.docker.internal).`)
}

const isEvmMineUnsupported = (error: unknown): boolean => {
	return error instanceof JsonRpcError && error.code === -32601
}

export const getMockedEthSimulateWindowEthereum = async (rpcUrl?: string): Promise<AnvilWindowEthereum> => {
	const ANVIL_RPC = rpcUrl ?? process.env['ANVIL_RPC'] ?? getDefaultAnvilRpcUrl()
	let currentTimestamp = 0n
	const snapshotTimestamps = new Map<string, bigint>()

	validateLocalAnvilRpcUrl(ANVIL_RPC)

	// Make JSON-RPC request to Anvil
	let requestId = 0
	const requestRaw = async (args: { method: string; params?: unknown[] | unknown | undefined }): Promise<unknown> => {
		const isSendTransactionMethod = args.method === 'eth_sendTransaction' || args.method === 'wallet_sendTransaction' || args.method === 'eth_sendRawTransaction'
		const params = isSendTransactionMethod ? normalizeAnvilTransactionParams(ensureArray(args.params)) : ensureArray(args.params)
		const id = requestId++
		const raw = await fetchJsonRpcResponse({
			rpcUrl: ANVIL_RPC,
			method: args.method,
			body: JSON.stringify({ jsonrpc: '2.0', id, method: args.method, params }),
		})
		const json = parseJsonRpcResponse(raw, id)
		const hasResult = 'result' in json
		const hasError = 'error' in json
		if (hasResult && hasError) throw new Error('Invalid JSON-RPC response: both result and error present')
		if (!hasResult && !hasError) throw new Error('Invalid JSON-RPC response: neither result nor error present')
		if (json.error !== undefined) throw new JsonRpcError(json.error)
		ensureDefined(json.result, 'json.result is undefined')
		const requestedReceiptHash = args.method === 'eth_getTransactionReceipt' && typeof params[0] === 'string' ? params[0] : undefined
		validateRpcResult(args.method, json.result, requestedReceiptHash === undefined ? {} : { transactionHash: requestedReceiptHash })
		return json.result
	}
	const request = async (args: { method: string; params?: unknown[] | unknown | undefined; skipCoverage?: boolean; rpcTimeoutMs?: number }): Promise<unknown> => {
		const isSendTransactionMethod = args.method === 'eth_sendTransaction' || args.method === 'wallet_sendTransaction' || args.method === 'eth_sendRawTransaction'
		const params = isSendTransactionMethod ? normalizeAnvilTransactionParams(ensureArray(args.params)) : ensureArray(args.params)
		const ethCallCoverageRequest = args.skipCoverage || args.method !== 'eth_call' ? undefined : parseEthCallCoverageRequest(params)
		let nextBlockTimestamp: bigint | undefined
		// Avoid preflight eth_call here. Recent Anvil versions can leak state when a
		// mutating call reverts after intermediate writes, which corrupts subsequent
		// eth_sendTransaction behavior inside the same test.
		if (isSendTransactionMethod && params[0]) {
			const latestBlockTimestamp = parseBlockTimestamp(await request({ method: 'eth_getBlockByNumber', params: ['latest', false] }))
			if (latestBlockTimestamp !== undefined) currentTimestamp = latestBlockTimestamp
			nextBlockTimestamp = currentTimestamp + 1n
			await request({
				method: 'evm_setNextBlockTimestamp',
				params: [`0x${nextBlockTimestamp.toString(16)}`],
			})
		}

		const id = requestId++
		const raw = await fetchJsonRpcResponse({
			rpcUrl: ANVIL_RPC,
			method: args.method,
			...(args.rpcTimeoutMs === undefined ? {} : { timeoutMs: args.rpcTimeoutMs }),
			body: JSON.stringify({
				jsonrpc: '2.0',
				id,
				method: args.method,
				params,
			}),
		})
		const json = parseJsonRpcResponse(raw, id)

		// Validate JSON-RPC response structure
		// Ensure exactly one of result or error is present (per JSON-RPC spec)
		const hasResult = 'result' in json
		const hasError = 'error' in json
		if (hasResult && hasError) throw new Error('Invalid JSON-RPC response: both result and error present')
		if (!hasResult && !hasError) throw new Error('Invalid JSON-RPC response: neither result nor error present')

		if (json.error !== undefined) {
			if (ethCallCoverageRequest !== undefined) {
				await collectBytecodeCoverageForCall({
					request,
					...ethCallCoverageRequest,
				})
			}
			if (isSendTransactionMethod && params[0] !== undefined && isRpcTransactionRequest(params[0])) {
				await collectBytecodeCoverageForCall({ request, transaction: params[0] })
			}
			throw new JsonRpcError(json.error)
		}
		if (args.method === 'anvil_reset' || args.method === 'anvil_revert') resetSolidityBytecodeCoverageAddressCache()
		if (args.method === 'anvil_setCode' && typeof params[0] === 'string') invalidateSolidityBytecodeCoverageAddressCache(params[0])

		const minePendingTransactions = async () => {
			const automineEnabled = await request({ method: 'anvil_getAutomine', params: [] })
			if (typeof automineEnabled !== 'boolean') throw new Error('Invalid anvil_getAutomine response: expected boolean')
			if (automineEnabled) return
			try {
				await request({
					method: 'evm_mine',
					params: [],
				})
			} catch (error) {
				if (!isEvmMineUnsupported(error)) throw error
			}
		}
		const waitForReceiptStatus = async (hash: string) => {
			const deadline = Date.now() + SEND_TRANSACTION_RECEIPT_TIMEOUT_MS
			let lastMineAttempt = Date.now()
			while (Date.now() < deadline) {
				const receipt = await request({
					method: 'eth_getTransactionReceipt',
					params: [hash],
				})
				const status = parseTransactionReceiptStatus(receipt)
				if (status !== undefined) return { receipt, status }

				const now = Date.now()
				if (now - lastMineAttempt >= SEND_TRANSACTION_RECEIPT_MINE_INTERVAL_MS) {
					lastMineAttempt = now
					await minePendingTransactions()
				}
				await new Promise(resolve => setTimeout(resolve, SEND_TRANSACTION_RECEIPT_POLL_INTERVAL_MS))
			}
			return undefined
		}
		const getReceiptWaitDiagnostics = async (hash: string): Promise<string> => {
			const transactionDiagnostic = (async (): Promise<string> => {
				try {
					const transaction = await request({
						method: 'eth_getTransactionByHash',
						params: [hash],
						rpcTimeoutMs: RECEIPT_DIAGNOSTIC_RPC_TIMEOUT_MS,
					})
					if (transaction === null) return 'transaction not found'
					if (isObjectRecord(transaction) && transaction['blockNumber'] === null) return 'transaction still pending'
					return `transaction lookup ${formatRpcDiagnosticValue(transaction)}`
				} catch (error) {
					return `transaction lookup failed: ${error instanceof Error ? error.message : String(error)}`
				}
			})()
			const latestBlockDiagnostic = (async (): Promise<string> => {
				try {
					const latestBlockNumber = await request({ method: 'eth_blockNumber', params: [], rpcTimeoutMs: RECEIPT_DIAGNOSTIC_RPC_TIMEOUT_MS })
					return `latest block ${formatRpcDiagnosticValue(latestBlockNumber)}`
				} catch (error) {
					return `latest block lookup failed: ${error instanceof Error ? error.message : String(error)}`
				}
			})()
			const transactionPoolDiagnostic = (async (): Promise<string> => {
				try {
					const transactionPoolStatus = await request({ method: 'txpool_status', params: [], rpcTimeoutMs: RECEIPT_DIAGNOSTIC_RPC_TIMEOUT_MS })
					return `transaction pool ${formatRpcDiagnosticValue(transactionPoolStatus)}`
				} catch (error) {
					return `transaction pool lookup failed: ${error instanceof Error ? error.message : String(error)}`
				}
			})()
			return (await Promise.all([transactionDiagnostic, latestBlockDiagnostic, transactionPoolDiagnostic])).join('; ')
		}

		// For eth_getTransactionReceipt, return the receipt even if status === '0x0' (reverted)
		// Callers can check the status field themselves
		ensureDefined(json.result, 'json.result is undefined')
		const requestedReceiptHash = args.method === 'eth_getTransactionReceipt' && typeof params[0] === 'string' ? params[0] : undefined
		validateRpcResult(args.method, json.result, requestedReceiptHash === undefined ? {} : { transactionHash: requestedReceiptHash })
		if (ethCallCoverageRequest !== undefined) {
			await collectBytecodeCoverageForCall({
				request,
				...ethCallCoverageRequest,
			})
		}
		if (isSendTransactionMethod && params[0] !== undefined && typeof json.result === 'string') {
			const receiptResult = await waitForReceiptStatus(json.result)
			if (receiptResult === undefined) {
				const diagnostics = await getReceiptWaitDiagnostics(json.result)
				throw new Error(`Anvil did not return a receipt for sent transaction ${json.result} within ${SEND_TRANSACTION_RECEIPT_TIMEOUT_MS.toString()}ms. Diagnostics: ${diagnostics}.`)
			}
			const parsedReceipt = parseTransactionReceipt(receiptResult.receipt)
			const transaction = isRpcTransactionRequest(params[0]) ? params[0] : undefined
			let transactionData = transaction !== undefined && typeof transaction.data === 'string' ? transaction.data : undefined
			if (transactionData === undefined) {
				const transactionDetails = await request({
					method: 'eth_getTransactionByHash',
					params: [json.result],
				})
				transactionData = parseTransactionInput(transactionDetails)
			}
			const receipt =
				parsedReceipt === undefined
					? undefined
					: {
							...(typeof parsedReceipt.to === 'string' ? { to: parsedReceipt.to } : {}),
							...(typeof parsedReceipt.contractAddress === 'string' ? { contractAddress: parsedReceipt.contractAddress } : {}),
						}
			const requestOptions = {
				request,
				transactionHash: json.result,
				transaction: {
					...(transaction !== undefined && typeof transaction.to === 'string' ? { to: transaction.to } : {}),
					...(transactionData !== undefined ? { data: transactionData } : {}),
				},
				...(receipt !== undefined ? { receipt } : {}),
			}
			if (receiptResult?.status !== undefined) {
				await collectBytecodeCoverageForTransaction({
					...requestOptions,
				})
			}
			if (receiptResult?.status === '0x0') {
				const latestBlockTimestamp = parseBlockTimestamp(await request({ method: 'eth_getBlockByNumber', params: ['latest', false] }))
				if (latestBlockTimestamp !== undefined) currentTimestamp = latestBlockTimestamp
				try {
					await request({ method: 'eth_call', params: [params[0], 'latest'], skipCoverage: true })
				} catch (error) {
					throw error
				}
				throw new Error('Transaction reverted')
			}
		}
		if (nextBlockTimestamp !== undefined) currentTimestamp = nextBlockTimestamp
		return json.result
	}

	// Reset Anvil to a clean state before each test
	await request({ method: 'anvil_reset', params: [] })
	await request({ method: 'anvil_setNextBlockBaseFeePerGas', params: ['0x0'] })

	// Apply state overrides using Anvil admin methods
	const addStateOverrides = async (stateOverrides: StateOverrides) => {
		const bytesToHex = (bytes: Uint8Array) =>
			'0x' +
			Array.from(bytes)
				.map(b => b.toString(16).padStart(2, '0'))
				.join('')
		for (const address of Object.keys(stateOverrides)) {
			const override = stateOverrides[address]
			if (override === undefined) continue
			if (override.stateDiff !== undefined)
				for (const [keyHex, value] of Object.entries(override.stateDiff)) {
					await request({
						method: 'anvil_setStorageAt',
						params: [address, keyHex, `0x${value.toString(16).padStart(64, '0')}`],
					})
				}
			if (override.balance !== undefined)
				await request({
					method: 'anvil_setBalance',
					params: [address, `0x${override.balance.toString(16)}`],
				})
			if (override.code !== undefined)
				await request({
					method: 'anvil_setCode',
					params: [address, bytesToHex(override.code)],
				})
			if (override.nonce !== undefined)
				await request({
					method: 'anvil_setNonce',
					params: [address, `0x${override.nonce.toString(16)}`],
				})
		}
	}

	// Time manipulation
	const manipulateTime = async (blockTimeManipulation: BlockTimeManipulation) => {
		if (blockTimeManipulation.type === 'AddToTimestamp') {
			await request({
				method: 'evm_increaseTime',
				params: [`0x${blockTimeManipulation.deltaToAdd.toString(16)}`],
			})
			await request({ method: 'evm_mine', params: [] })
			currentTimestamp += blockTimeManipulation.deltaToAdd
		} else if (blockTimeManipulation.type === 'SetTimestamp') {
			const hexTimestamp = `0x${blockTimeManipulation.timeToSet.toString(16)}`
			try {
				await request({
					method: 'evm_setNextBlockTimestamp',
					params: [hexTimestamp],
				})
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : String(error)
				if (!errorMessage.includes('timestamp is too big')) throw error
				await request({
					method: 'evm_setNextBlockTimestamp',
					params: [blockTimeManipulation.timeToSet.toString()],
				})
			}
			await request({ method: 'evm_mine', params: [] })
			currentTimestamp = blockTimeManipulation.timeToSet
		}
	}

	const getTime = async (): Promise<bigint> => {
		return currentTimestamp
	}

	const getBlock = async (): Promise<GetBlockReturn> => {
		return { timestamp: currentTimestamp }
	}

	const advanceTime = async (amountInSeconds: bigint) => {
		await manipulateTime({ type: 'AddToTimestamp', deltaToAdd: amountInSeconds })
	}

	const setTime = async (timestamp: bigint) => {
		await manipulateTime({ type: 'SetTimestamp', timeToSet: timestamp })
	}

	const impersonateAccount = async (address: string) => {
		await request({
			method: 'anvil_impersonateAccount',
			params: [address],
		})
	}

	const setBalance = async (address: string, amount: bigint) => {
		if (amount < 0n) throw new RangeError('Balance cannot be negative')
		await request({
			method: 'anvil_setBalance',
			params: [address, `0x${amount.toString(16)}`],
		})
	}

	const anvilSnapshot = async (): Promise<string> => {
		const result = await request({ method: 'anvil_snapshot', params: [] })
		const snapshotId = parseSnapshotId(result)
		snapshotTimestamps.set(snapshotId, currentTimestamp)
		return snapshotId
	}

	const anvilRevert = async (snapshotId: string): Promise<void> => {
		const reverted = await request({ method: 'anvil_revert', params: [snapshotId] })
		if (reverted !== true) throw new AnvilSnapshotUnavailableError(snapshotId)
		snapshotTimestamps.delete(snapshotId)
		const latestBlockTimestamp = parseBlockTimestamp(await request({ method: 'eth_getBlockByNumber', params: ['latest', false] }))
		if (latestBlockTimestamp === undefined) throw new Error('Invalid block timestamp after anvil_revert')
		currentTimestamp = latestBlockTimestamp
	}

	const resetToCleanState = async (): Promise<void> => {
		await request({ method: 'anvil_reset', params: [] })
		await request({ method: 'anvil_setNextBlockBaseFeePerGas', params: ['0x0'] })
		const latestBlockTimestamp = parseBlockTimestamp(await request({ method: 'eth_getBlockByNumber', params: ['latest', false] }))
		currentTimestamp = latestBlockTimestamp ?? 0n
		snapshotTimestamps.clear()
	}

	const setNextBlockBaseFeePerGasToZero = async (): Promise<void> => {
		await request({ method: 'anvil_setNextBlockBaseFeePerGas', params: ['0x0'] })
	}

	// Reset Anvil to a clean state before each test
	await resetToCleanState()

	const mock: AnvilWindowEthereum = {
		request,
		requestRaw,
		on: () => {},
		removeListener: () => {},
		addStateOverrides,
		manipulateTime,
		getTime,
		getBlock,
		advanceTime,
		setTime,
		resetToCleanState,
		setNextBlockBaseFeePerGasToZero,
		impersonateAccount,
		setBalance,
		anvilSnapshot,
		anvilRevert,
	}

	return mock
}

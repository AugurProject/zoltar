import type { EthereumBytes32, EthereumData, EthereumQuantity, EthereumQuantitySmall } from './types/wire-types'
import { ensureDefined } from './utils/testUtils'
import { ensureArray } from './utils/array-utils'
import { collectBytecodeCoverageForTransaction, resetSolidityBytecodeCoverageAddressCache } from '../../coverage/traceToSource'

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

type RpcBlock = {
	readonly timestamp?: string
}

type RpcTransactionReceipt = {
	readonly status?: string
	readonly to?: string
	readonly contractAddress?: string
}

type RpcTransaction = {
	readonly blockNumber?: string
}

type RpcTransactionRequest = {
	readonly from?: string
	readonly to?: string
	readonly data?: string
	readonly gasPrice?: string
	readonly maxFeePerGas?: string
	readonly maxPriorityFeePerGas?: string
	readonly type?: string
}

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

function hasJsonRpcBaseFields(value: unknown): value is { jsonrpc: string; id: number | string } {
	return typeof value === 'object' && value !== null && 'jsonrpc' in value && 'id' in value && typeof value.jsonrpc === 'string' && (typeof value.id === 'number' || typeof value.id === 'string')
}

function isJsonRpcError(value: unknown): value is { code: number; message: string; data?: unknown } {
	return typeof value === 'object' && value !== null && 'message' in value && typeof value.message === 'string'
}

function isRpcTransactionRequest(value: unknown): value is RpcTransactionRequest {
	return typeof value === 'object' && value !== null
}

export function normalizeAnvilTransactionParams(params: unknown[]) {
	const [firstParam, ...remainingParams] = params
	if (!isRpcTransactionRequest(firstParam)) return params

	const normalizedTransactionRequest: Record<string, unknown> = {
		...firstParam,
		gasPrice: '0x0',
	}

	delete normalizedTransactionRequest['maxFeePerGas']
	delete normalizedTransactionRequest['maxPriorityFeePerGas']
	delete normalizedTransactionRequest['type']

	return [normalizedTransactionRequest, ...remainingParams]
}

function parseJsonRpcResponse(raw: unknown): JsonRpcSuccess {
	if (typeof raw !== 'object' || raw === null) throw new Error('Invalid JSON-RPC response: not an object')
	if (!hasJsonRpcBaseFields(raw)) throw new Error('Invalid JSON-RPC response: missing base fields')
	if (raw.jsonrpc !== '2.0') throw new Error(`Invalid JSON-RPC version: expected '2.0', got '${raw.jsonrpc}'`)
	if ('error' in raw && raw.error !== undefined && !isJsonRpcError(raw.error)) throw new Error('Invalid JSON-RPC response: malformed error object')

	return raw
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

function parseTransactionBlockNumber(value: unknown): bigint | undefined {
	if (typeof value !== 'object' || value === null || !('blockNumber' in value)) return undefined
	const { blockNumber } = value as RpcTransaction
	if (typeof blockNumber !== 'string') return undefined
	return BigInt(blockNumber)
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
	on: () => void
	removeListener: () => void
}

export const getDefaultAnvilRpcUrl = (): string => (process.platform === 'win32' ? 'http://127.0.0.1:8545' : 'http://host.docker.internal:8545')

export const getMockedEthSimulateWindowEthereum = async (rpcUrl?: string): Promise<AnvilWindowEthereum> => {
	const ANVIL_RPC = rpcUrl ?? process.env['ANVIL_RPC'] ?? getDefaultAnvilRpcUrl()
	let currentTimestamp = 0n
	let snapshotTimestamp = 0n

	// Validate RPC endpoint points to localhost only for test security
	const validateLocalhostUrl = (url: string): void => {
		try {
			const parsed = new URL(url)
			const allowedHosts = ['localhost', '127.0.0.1', '::1', 'host.docker.internal']
			if (!allowedHosts.includes(parsed.hostname)) throw new Error(`ANVIL_RPC points to unauthorized host '${parsed.hostname}'. ` + `Test RPC endpoints must be local (localhost, 127.0.0.1, ::1, host.docker.internal). ` + `Set ANVIL_RPC to a local Anvil instance.`)
		} catch (error) {
			if (error instanceof Error && error.message.includes('unauthorized')) throw error
			throw new Error(`Invalid ANVIL_RPC URL: ${url}. Must be a valid HTTP URL.`)
		}
	}
	validateLocalhostUrl(ANVIL_RPC)

	// Make JSON-RPC request to Anvil
	let requestId = 0
	const request = async (args: { method: string; params?: unknown[] | unknown | undefined }): Promise<unknown> => {
		const isSendTransactionMethod = args.method === 'eth_sendTransaction' || args.method === 'wallet_sendTransaction' || args.method === 'eth_sendRawTransaction'
		const params = isSendTransactionMethod ? normalizeAnvilTransactionParams(ensureArray(args.params)) : ensureArray(args.params)
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

		const response = await fetch(ANVIL_RPC, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: requestId++,
				method: args.method,
				params,
			}),
		})
		if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`)
		const raw = await response.json()
		const json = parseJsonRpcResponse(raw)

		// Validate JSON-RPC response structure
		// Ensure exactly one of result or error is present (per JSON-RPC spec)
		const hasResult = 'result' in json
		const hasError = 'error' in json
		if (hasResult && hasError) throw new Error('Invalid JSON-RPC response: both result and error present')
		if (!hasResult && !hasError) throw new Error('Invalid JSON-RPC response: neither result nor error present')

		if (json.error !== undefined) throw new Error(json.error.message || 'RPC error')
		if (args.method === 'anvil_reset') resetSolidityBytecodeCoverageAddressCache()

		const waitForReceiptStatus = async (hash: string) => {
			let transactionBlockNumber: bigint | undefined
			for (let attempt = 0; attempt < 20; attempt++) {
				const receipt = await request({
					method: 'eth_getTransactionReceipt',
					params: [hash],
				})
				const status = parseTransactionReceiptStatus(receipt)
				if (status !== undefined) return { receipt, status }

				if (transactionBlockNumber === undefined) {
					const transaction = await request({
						method: 'eth_getTransactionByHash',
						params: [hash],
					})
					transactionBlockNumber = parseTransactionBlockNumber(transaction)
				}
			}

			if (transactionBlockNumber !== undefined) return undefined
			return undefined
		}

		// For eth_getTransactionReceipt, return the receipt even if status === '0x0' (reverted)
		// Callers can check the status field themselves
		ensureDefined(json.result, 'json.result is undefined')
		if (isSendTransactionMethod && params[0] !== undefined && typeof json.result === 'string') {
			const receiptResult = await waitForReceiptStatus(json.result)
			const parsedReceipt = receiptResult === undefined ? undefined : parseTransactionReceipt(receiptResult.receipt)
			const transaction = isRpcTransactionRequest(params[0]) ? params[0] : undefined
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
					...(transaction !== undefined && typeof transaction.data === 'string' ? { data: transaction.data } : {}),
				},
				...(receipt !== undefined ? { receipt } : {}),
			}
			if (receiptResult?.status !== undefined) {
				await collectBytecodeCoverageForTransaction({
					...requestOptions,
				})
			}
			if (receiptResult?.status === '0x0') {
				try {
					await request({ method: 'eth_call', params: [params[0], 'latest'] })
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
		snapshotTimestamp = currentTimestamp
		const result = await request({ method: 'anvil_snapshot', params: [] })
		return parseSnapshotId(result)
	}

	const anvilRevert = async (snapshotId: string): Promise<void> => {
		await request({ method: 'anvil_revert', params: [snapshotId] })
		currentTimestamp = snapshotTimestamp
	}

	const resetToCleanState = async (): Promise<void> => {
		await request({ method: 'anvil_reset', params: [] })
		await request({ method: 'anvil_setNextBlockBaseFeePerGas', params: ['0x0'] })
		const latestBlockTimestamp = parseBlockTimestamp(await request({ method: 'eth_getBlockByNumber', params: ['latest', false] }))
		currentTimestamp = latestBlockTimestamp ?? 0n
		snapshotTimestamp = currentTimestamp
	}

	const setNextBlockBaseFeePerGasToZero = async (): Promise<void> => {
		await request({ method: 'anvil_setNextBlockBaseFeePerGas', params: ['0x0'] })
	}

	// Reset Anvil to a clean state before each test
	await resetToCleanState()

	const mock: AnvilWindowEthereum = {
		request,
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

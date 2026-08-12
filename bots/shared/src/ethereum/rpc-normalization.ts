import { getAddress, hexQuantity, normalizeAddress, normalizeBoolean, normalizeHash, normalizeNullableAddress, normalizeRpcBigInt, normalizeRpcHex, normalizeTransactionType } from './codec'
import type { Account, Address, Block, BlockTransaction, Hex, ReplacementReason, TransactionLog, TransactionReceipt } from './types'

type ReplacementActions = {
	getBlock: (parameters: { blockNumber: bigint; includeTransactions: true }) => Promise<Block>
}

export function normalizeLog(value: unknown): TransactionLog {
	if (typeof value !== 'object' || value === null) throw new Error('RPC returned an invalid log')
	const log = value as Record<string, unknown>
	return {
		address: normalizeAddress(log['address']),
		blockHash: log['blockHash'] === undefined || log['blockHash'] === null ? undefined : normalizeHash(log['blockHash']),
		blockNumber: log['blockNumber'] === undefined || log['blockNumber'] === null ? undefined : normalizeRpcBigInt(log['blockNumber']),
		data: normalizeRpcHex(log['data']),
		logIndex: log['logIndex'] === undefined || log['logIndex'] === null ? undefined : normalizeRpcBigInt(log['logIndex']),
		removed: normalizeBoolean(log['removed']),
		topics: Array.isArray(log['topics']) ? log['topics'].map(topic => normalizeRpcHex(topic)) : [],
		transactionHash: log['transactionHash'] === undefined || log['transactionHash'] === null ? undefined : normalizeHash(log['transactionHash']),
		transactionIndex: log['transactionIndex'] === undefined || log['transactionIndex'] === null ? undefined : normalizeRpcBigInt(log['transactionIndex']),
	}
}

export function normalizeReceipt(value: unknown): TransactionReceipt {
	if (typeof value !== 'object' || value === null) throw new Error('RPC returned an invalid transaction receipt')
	const receipt = value as Record<string, unknown>
	return {
		blockHash: normalizeHash(receipt['blockHash']),
		blockNumber: normalizeRpcBigInt(receipt['blockNumber']),
		contractAddress: normalizeNullableAddress(receipt['contractAddress']) ?? null,
		cumulativeGasUsed: normalizeRpcBigInt(receipt['cumulativeGasUsed']),
		effectiveGasPrice: receipt['effectiveGasPrice'] === undefined ? undefined : normalizeRpcBigInt(receipt['effectiveGasPrice']),
		from: normalizeAddress(receipt['from']),
		gasUsed: normalizeRpcBigInt(receipt['gasUsed']),
		logs: Array.isArray(receipt['logs']) ? receipt['logs'].map(item => normalizeLog(item)) : [],
		logsBloom: receipt['logsBloom'] === undefined ? undefined : normalizeRpcHex(receipt['logsBloom']),
		status: normalizeBoolean(receipt['status']) ? 'success' : 'reverted',
		to: normalizeNullableAddress(receipt['to']) ?? null,
		transactionHash: normalizeHash(receipt['transactionHash']),
		transactionIndex: normalizeRpcBigInt(receipt['transactionIndex']),
		type: normalizeTransactionType(receipt['type']),
	}
}

export function normalizeTransaction(value: unknown): BlockTransaction {
	if (typeof value !== 'object' || value === null) throw new Error('RPC returned an invalid transaction')
	const transaction = value as Record<string, unknown>
	return {
		blockNumber: transaction['blockNumber'] === undefined || transaction['blockNumber'] === null ? undefined : normalizeRpcBigInt(transaction['blockNumber']),
		from: normalizeAddress(transaction['from']),
		gas: normalizeRpcBigInt(transaction['gas']),
		gasPrice: transaction['gasPrice'] === undefined || transaction['gasPrice'] === null ? undefined : normalizeRpcBigInt(transaction['gasPrice']),
		hash: normalizeHash(transaction['hash']),
		input: normalizeRpcHex(transaction['input'] ?? transaction['data'] ?? '0x'),
		maxFeePerGas: transaction['maxFeePerGas'] === undefined || transaction['maxFeePerGas'] === null ? undefined : normalizeRpcBigInt(transaction['maxFeePerGas']),
		maxPriorityFeePerGas: transaction['maxPriorityFeePerGas'] === undefined || transaction['maxPriorityFeePerGas'] === null ? undefined : normalizeRpcBigInt(transaction['maxPriorityFeePerGas']),
		nonce: normalizeRpcBigInt(transaction['nonce']),
		to: normalizeNullableAddress(transaction['to']) ?? null,
		transactionIndex: transaction['transactionIndex'] === undefined || transaction['transactionIndex'] === null ? undefined : normalizeRpcBigInt(transaction['transactionIndex']),
		type: normalizeTransactionType(transaction['type']),
		value: normalizeRpcBigInt(transaction['value']),
	}
}

export function normalizeBlock(value: unknown, includeTransactions: boolean) {
	if (typeof value !== 'object' || value === null) throw new Error('RPC returned an invalid block')
	const block = value as Record<string, unknown>
	return {
		baseFeePerGas: block['baseFeePerGas'] === undefined || block['baseFeePerGas'] === null ? undefined : normalizeRpcBigInt(block['baseFeePerGas']),
		hash: block['hash'] === undefined || block['hash'] === null ? undefined : normalizeHash(block['hash']),
		number: block['number'] === undefined || block['number'] === null ? undefined : normalizeRpcBigInt(block['number']),
		parentHash: block['parentHash'] === undefined || block['parentHash'] === null ? undefined : normalizeHash(block['parentHash']),
		timestamp: normalizeRpcBigInt(block['timestamp']),
		transactions: Array.isArray(block['transactions']) ? block['transactions'].map(transaction => (includeTransactions ? normalizeTransaction(transaction) : normalizeHash(transaction))) : [],
	} satisfies Block
}

export function isBlockTransaction(value: unknown): value is BlockTransaction {
	return typeof value === 'object' && value !== null && 'hash' in value && 'from' in value && 'nonce' in value
}

export function isTransactionNotFoundError(error: unknown) {
	return error instanceof Error && error.message.includes('could not be found')
}

export function getReplacementReason(originalTransaction: BlockTransaction, replacementTransaction: BlockTransaction): ReplacementReason {
	if (replacementTransaction.to?.toLowerCase() === originalTransaction.from.toLowerCase() && replacementTransaction.value === 0n && replacementTransaction.input === '0x') return 'cancelled'
	if (replacementTransaction.to?.toLowerCase() === originalTransaction.to?.toLowerCase() && replacementTransaction.value === originalTransaction.value && replacementTransaction.input === originalTransaction.input) return 'repriced'
	return 'replaced'
}

export const REPLACEMENT_SCAN_BLOCK_DEPTH = 12n

export async function findReplacementTransaction(actions: ReplacementActions, originalTransaction: BlockTransaction, parameters: { fromBlock: bigint; toBlock: bigint }) {
	for (let blockNumber = parameters.fromBlock; blockNumber <= parameters.toBlock; blockNumber += 1n) {
		const block = await actions.getBlock({
			blockNumber,
			includeTransactions: true,
		})
		const replacementTransaction = block.transactions.find((transaction): transaction is BlockTransaction => isBlockTransaction(transaction) && transaction.hash !== originalTransaction.hash && transaction.nonce === originalTransaction.nonce && transaction.from.toLowerCase() === originalTransaction.from.toLowerCase())
		if (replacementTransaction !== undefined) return replacementTransaction
	}
	return undefined
}

export function buildRpcTransactionRequest(parameters: {
	account?: Account | Address | undefined
	amount?: bigint | undefined
	data?: Hex | undefined
	gas?: bigint | undefined
	gasPrice?: bigint | undefined
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
	nonce?: bigint | number | undefined
	to?: Address | null | undefined
	value?: bigint | undefined
}) {
	const from = normalizeAccountAddress(parameters.account)
	const value = parameters.value ?? parameters.amount
	return {
		...(from === undefined ? {} : { from }),
		...(parameters.to === undefined || parameters.to === null ? {} : { to: parameters.to }),
		...(parameters.data === undefined ? {} : { data: parameters.data }),
		...(parameters.gas === undefined ? {} : { gas: hexQuantity(parameters.gas) }),
		...(parameters.gasPrice === undefined ? {} : { gasPrice: hexQuantity(parameters.gasPrice) }),
		...(parameters.maxFeePerGas === undefined ? {} : { maxFeePerGas: hexQuantity(parameters.maxFeePerGas) }),
		...(parameters.maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas: hexQuantity(parameters.maxPriorityFeePerGas) }),
		...(parameters.nonce === undefined ? {} : { nonce: hexQuantity(parameters.nonce) }),
		...(value === undefined ? {} : { value: hexQuantity(value) }),
	}
}

export function normalizeAccountAddress(account: Account | Address | undefined) {
	if (account === undefined) return undefined
	return typeof account === 'string' ? getAddress(account) : account.address
}

import { bytesToHex, toHex, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { SimulationReceiptLog, SimulationTransaction } from './clock.js'

/** The parts of a sealed tevm block and transaction result the receipt reads. */
export type SimulationReceiptSource = {
	block: { hash(): Uint8Array; header: { baseFeePerGas?: bigint | undefined; number: bigint } }
	result: {
		createdAddress?: { toString(): string } | undefined
		receipt: { bitvector: Uint8Array; cumulativeBlockGasUsed: bigint; logs: SimulationReceiptLog[]; status?: number | undefined }
		totalGasSpent: bigint
	}
	transaction: SimulationTransaction
	transactionIndex: number
}

/** An `eth_getTransactionReceipt` result in JSON-RPC form, as viem expects it from a provider. */
export type SimulationTransactionReceipt = {
	blockHash: Hex
	blockNumber: Hex
	contractAddress: Address | null
	cumulativeGasUsed: Hex
	effectiveGasPrice: Hex
	from: Address
	gasUsed: Hex
	logs: SimulationTransactionLog[]
	logsBloom: Hex
	status: '0x0' | '0x1'
	to: Address | null
	transactionHash: Hex
	transactionIndex: Hex
	type: Hex
}

type SimulationTransactionLog = {
	address: Address
	blockHash: Hex
	blockNumber: Hex
	data: Hex
	logIndex: Hex
	removed: false
	topics: Hex[]
	transactionHash: Hex
	transactionIndex: Hex
}

function toAddress(value: { toString(): string }): Address {
	const text = value.toString()
	if (!text.startsWith('0x')) throw new Error(`Simulation receipt address was not hex: ${text}`)
	return `0x${text.slice(2)}`
}

function getEffectiveGasPrice(transaction: SimulationTransaction, baseFeePerGas: bigint) {
	if ('maxFeePerGas' in transaction) {
		const priorityCapped = baseFeePerGas + transaction.maxPriorityFeePerGas
		return transaction.maxFeePerGas < priorityCapped ? transaction.maxFeePerGas : priorityCapped
	}
	return transaction.gasPrice
}

function getReceiptStatus(receipt: SimulationReceiptSource['result']['receipt']): '0x0' | '0x1' {
	return receipt.status === 1 ? '0x1' : '0x0'
}

/**
 * Formats a receipt from the block that the simulation clock just sealed, so receipt lookups never re-execute the block
 * the way tevm's `eth_getTransactionReceipt` handler does.
 */
export function formatSimulationTransactionReceipt({ block, result, transaction, transactionIndex }: SimulationReceiptSource): SimulationTransactionReceipt {
	const blockHash = bytesToHex(block.hash())
	const blockNumber = toHex(block.header.number)
	const transactionHash = bytesToHex(transaction.hash())
	const transactionIndexHex = toHex(transactionIndex)
	const receipt = result.receipt
	return {
		blockHash,
		blockNumber,
		contractAddress: result.createdAddress === undefined ? null : toAddress(result.createdAddress),
		cumulativeGasUsed: toHex(receipt.cumulativeBlockGasUsed),
		effectiveGasPrice: toHex(getEffectiveGasPrice(transaction, block.header.baseFeePerGas ?? 0n)),
		from: toAddress(transaction.getSenderAddress()),
		gasUsed: toHex(result.totalGasSpent),
		logs: receipt.logs.map(([address, topics, data], index) => ({
			address: toAddress({ toString: () => bytesToHex(address) }),
			blockHash,
			blockNumber,
			data: bytesToHex(data),
			logIndex: toHex(index),
			removed: false,
			topics: topics.map(topic => bytesToHex(topic)),
			transactionHash,
			transactionIndex: transactionIndexHex,
		})),
		logsBloom: bytesToHex(receipt.bitvector),
		status: getReceiptStatus(receipt),
		to: transaction.to === undefined ? null : toAddress(transaction.to),
		transactionHash,
		transactionIndex: transactionIndexHex,
		type: toHex(transaction.type),
	}
}

import { createBlock, createBlockFromRLP } from '@tevm/block'
import { createAddressFromString, keccak256 } from '@tevm/utils'
import { bytesToHex, getAddress, getCreateAddress, hexToBytes, toHex, type Address } from '@zoltar/core-shared/evm/ethereum'
import { getSimulationNode, type SimulationReceiptLog, type TevmLikeClient } from './clock.js'
import type { SerializedSimulationBlock, SerializedSimulationReceipt } from './savedStates.js'
import { formatSimulationTransactionReceipt, type SimulationReceiptSource, type SimulationTransactionReceipt } from './transactionReceipts.js'

/**
 * Block and receipt history for saved states. tevm's state dump holds accounts only; without the blocks a restored
 * chain starts over at block one with no event logs, which breaks every discovery that reads logs. Blocks travel as
 * their RLP encoding and receipts as JSON, and the restored chain continues from the saved block number. This module
 * runs in the simulation worker only: it needs tevm packages the browser import map does not serve.
 */
type HashableTransaction = { getHashedMessageToSign(): Uint8Array; hash(): Uint8Array; isSigned(): boolean }

type StoredReceipt = SimulationReceiptSource['result']['receipt']

/**
 * Restores what tevm's impersonated transactions add to an unsigned transaction: a hash and a sender. The RLP of a
 * block keeps only the unsigned transaction, and tevm's own wrapper lives in a package the UI does not depend on.
 */
function impersonateTransaction<TTransaction extends HashableTransaction>(transaction: TTransaction, sender: Address): TTransaction {
	const senderAddress = createAddressFromString(sender)
	return new Proxy(transaction, {
		get(target, property, receiver) {
			if (property === 'isImpersonated') return true
			if (property === 'isSigned') return () => true
			if (property === 'getSenderAddress') return () => senderAddress
			if (property === 'hash') return () => (target.isSigned() ? target.hash() : keccak256(target.getHashedMessageToSign(), 'bytes'))
			return Reflect.get(target, property, receiver)
		},
	})
}

function equalBytes(left: Uint8Array, right: Uint8Array) {
	return left.length === right.length && left.every((value, index) => value === right[index])
}

function serializeReceipt(receipt: StoredReceipt): SerializedSimulationReceipt {
	return {
		cumulativeGasUsed: toHex(receipt.cumulativeBlockGasUsed),
		logs: receipt.logs.map(([address, topics, data]) => [getAddress(bytesToHex(address)), topics.map(topic => bytesToHex(topic)), bytesToHex(data)]),
		logsBloom: bytesToHex(receipt.bitvector),
		status: receipt.status === 1 ? 1 : 0,
	}
}

function deserializeReceipt(receipt: SerializedSimulationReceipt) {
	return {
		bitvector: hexToBytes(receipt.logsBloom),
		cumulativeBlockGasUsed: BigInt(receipt.cumulativeGasUsed),
		logs: receipt.logs.map(([address, topics, data]): SimulationReceiptLog => [hexToBytes(address), topics.map(topic => hexToBytes(topic)), hexToBytes(data)]),
		status: receipt.status,
	}
}

/** Every block after genesis with its receipts, oldest first. */
export async function exportSimulationChainHistory(memoryClient: TevmLikeClient): Promise<SerializedSimulationBlock[]> {
	const node = getSimulationNode(memoryClient)
	const vm = await node.getVm()
	const receiptsManager = await node.getReceiptsManager()
	const head = await vm.blockchain.getCanonicalHeadBlock()
	const blocks: SerializedSimulationBlock[] = []
	for (let number = 1n; number <= head.header.number; number += 1n) {
		const block = await vm.blockchain.getBlock(number)
		const receipts = await receiptsManager.getReceipts(block.hash(), true)
		blocks.push({
			block: bytesToHex(block.serialize()),
			receipts: receipts.map((receipt: StoredReceipt) => serializeReceipt(receipt)),
			senders: block.transactions.map((transaction: { getSenderAddress(): { toString(): string } }) => getAddress(transaction.getSenderAddress().toString())),
		})
	}
	return blocks
}

/**
 * Re-inserts exported blocks and receipts into a chain whose state was loaded from the same save, and returns the
 * receipts of every restored transaction keyed by lower-case hash. The chain must still be at genesis.
 */
export async function restoreSimulationChainHistory(memoryClient: TevmLikeClient, blocks: readonly SerializedSimulationBlock[]) {
	const node = getSimulationNode(memoryClient)
	const vm = await node.getVm()
	const receiptsManager = await node.getReceiptsManager()
	const restoredReceipts = new Map<string, SimulationTransactionReceipt>()
	for (const entry of blocks) {
		const blockOptions = { common: vm.common, freeze: false, setHardfork: false }
		const parsed = createBlockFromRLP(hexToBytes(entry.block), blockOptions)
		if (parsed.transactions.length !== entry.senders.length) throw new Error(`Saved block ${parsed.header.number.toString()} names ${entry.senders.length.toString()} senders for ${parsed.transactions.length.toString()} transactions`)
		const block = createBlock({ header: parsed.header, transactions: parsed.transactions.map((transaction, index) => impersonateTransaction(transaction, entry.senders[index] ?? '0x')), ...(parsed.withdrawals === undefined ? {} : { withdrawals: parsed.withdrawals }) }, blockOptions)
		if (!equalBytes(block.hash(), parsed.hash())) throw new Error(`Saved block ${parsed.header.number.toString()} changed its hash while restoring`)
		const receipts = entry.receipts.map(receipt => deserializeReceipt(receipt))
		await vm.blockchain.putBlock(block)
		await receiptsManager.saveReceipts(block, receipts)
		let previousCumulativeGasUsed = 0n
		for (const [transactionIndex, transaction] of block.transactions.entries()) {
			const receipt = receipts[transactionIndex]
			if (receipt === undefined) throw new Error(`Saved block ${block.header.number.toString()} is missing receipt ${transactionIndex.toString()}`)
			const sender = getAddress(transaction.getSenderAddress().toString())
			const createdAddress = transaction.to === undefined ? getCreateAddress({ from: sender, nonce: transaction.nonce }) : undefined
			const formatted = formatSimulationTransactionReceipt({
				block,
				result: { ...(createdAddress === undefined ? {} : { createdAddress: { toString: () => createdAddress } }), receipt, totalGasSpent: receipt.cumulativeBlockGasUsed - previousCumulativeGasUsed },
				transaction,
				transactionIndex,
			})
			previousCumulativeGasUsed = receipt.cumulativeBlockGasUsed
			restoredReceipts.set(formatted.transactionHash.toLowerCase(), formatted)
		}
	}
	return restoredReceipts
}

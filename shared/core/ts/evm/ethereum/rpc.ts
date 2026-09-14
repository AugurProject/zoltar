import { type Address, type Block, type BlockTransaction, type Hex, type LogTopicFilter, type TransactionLog, type TransactionReceipt } from './types.js'

import { getAddress, normalizeAddress, normalizeHash, normalizeNullableAddress, normalizeOptionalLogRemoved, normalizeReceiptStatus, normalizeRequiredReceiptQuantity, normalizeRpcBigInt, normalizeRpcHex, normalizeTransactionType } from './encoding.js'

export function normalizeLog(value: unknown): TransactionLog {
	if (typeof value !== 'object' || value === null) throw new Error('RPC returned an invalid log')
	const log = value as Record<string, unknown>
	const topics = log['topics']
	if (!Array.isArray(topics)) throw new Error('RPC returned a log without topics')
	return {
		address: normalizeAddress(log['address']),
		blockHash: log['blockHash'] === undefined || log['blockHash'] === null ? undefined : normalizeHash(log['blockHash']),
		blockNumber: log['blockNumber'] === undefined || log['blockNumber'] === null ? undefined : normalizeRpcBigInt(log['blockNumber']),
		data: normalizeRpcHex(log['data']),
		logIndex: log['logIndex'] === undefined || log['logIndex'] === null ? undefined : normalizeRpcBigInt(log['logIndex']),
		removed: normalizeOptionalLogRemoved(log['removed']),
		topics: topics.map(topic => normalizeHash(topic)),
		transactionHash: log['transactionHash'] === undefined || log['transactionHash'] === null ? undefined : normalizeHash(log['transactionHash']),
		transactionIndex: log['transactionIndex'] === undefined || log['transactionIndex'] === null ? undefined : normalizeRpcBigInt(log['transactionIndex']),
	}
}

export function getLogAddressFilter(address: Address | readonly Address[] | undefined) {
	if (address === undefined) return undefined
	if (typeof address === 'string') return new Set([getAddress(address).toLowerCase()])
	if (address.length === 0) return undefined
	return new Set(address.map(item => getAddress(item).toLowerCase()))
}

export function logMatchesTopicFilter(logTopics: readonly Hex[], topicFilter: readonly LogTopicFilter[]) {
	if (topicFilter.length > logTopics.length) return false
	for (const [index, filter] of topicFilter.entries()) {
		if (filter === null) continue
		const alternatives = typeof filter === 'string' ? [filter] : filter
		if (alternatives.length === 0) continue
		const logTopic = logTopics[index]
		if (logTopic === undefined || !alternatives.some(topic => topic.toLowerCase() === logTopic.toLowerCase())) return false
	}
	return true
}

export function snapshotLogTopicFilter(topicFilter: readonly LogTopicFilter[]) {
	return topicFilter.map(filter => (typeof filter === 'string' || filter === null ? filter : [...filter]))
}

export function normalizeReceipt(value: unknown): TransactionReceipt {
	if (typeof value !== 'object' || value === null) throw new Error('RPC returned an invalid transaction receipt')
	const receipt = value as Record<string, unknown>
	if (!Array.isArray(receipt['logs'])) throw new Error('RPC returned a transaction receipt without required logs')
	const blockHash = normalizeHash(receipt['blockHash'])
	const blockNumber = normalizeRequiredReceiptQuantity(receipt['blockNumber'], 'blockNumber')
	const transactionHash = normalizeHash(receipt['transactionHash'])
	const transactionIndex = normalizeRequiredReceiptQuantity(receipt['transactionIndex'], 'transactionIndex')
	const logs = receipt['logs'].map(item => normalizeLog(item))
	for (const log of logs) {
		if (log.blockHash !== blockHash) throw new Error('RPC returned a transaction receipt with a log whose blockHash does not match the receipt')
		if (log.blockNumber !== blockNumber) throw new Error('RPC returned a transaction receipt with a log whose blockNumber does not match the receipt')
		if (log.transactionHash !== transactionHash) throw new Error('RPC returned a transaction receipt with a log whose transactionHash does not match the receipt')
		if (log.transactionIndex !== transactionIndex) throw new Error('RPC returned a transaction receipt with a log whose transactionIndex does not match the receipt')
	}
	return {
		blockHash,
		blockNumber,
		contractAddress: normalizeNullableAddress(receipt['contractAddress']),
		cumulativeGasUsed: normalizeRequiredReceiptQuantity(receipt['cumulativeGasUsed'], 'cumulativeGasUsed'),
		effectiveGasPrice: receipt['effectiveGasPrice'] === undefined ? undefined : normalizeRpcBigInt(receipt['effectiveGasPrice']),
		from: normalizeAddress(receipt['from']),
		gasUsed: normalizeRequiredReceiptQuantity(receipt['gasUsed'], 'gasUsed'),
		logs,
		logsBloom: receipt['logsBloom'] === undefined ? undefined : normalizeRpcHex(receipt['logsBloom']),
		status: normalizeReceiptStatus(receipt['status']),
		to: normalizeNullableAddress(receipt['to']) ?? null,
		transactionHash,
		transactionIndex,
		type: normalizeTransactionType(receipt['type']),
	}
}

function normalizeRequiredTransactionQuantity(transaction: Record<string, unknown>, field: 'gas' | 'nonce' | 'value') {
	const value = transaction[field]
	if (value === undefined || value === null) throw new Error(`RPC returned a transaction without ${field}`)
	return normalizeRpcBigInt(value)
}

function normalizeTransactionInput(transaction: Record<string, unknown>) {
	const value = transaction['input'] ?? transaction['data']
	if (value === undefined || value === null) throw new Error('RPC returned a transaction without input data')
	return normalizeRpcHex(value)
}

function normalizeTransactionRecipient(transaction: Record<string, unknown>) {
	if (transaction['to'] === undefined) throw new Error('RPC returned a transaction without to')
	return normalizeNullableAddress(transaction['to']) ?? null
}

export function normalizeTransaction(value: unknown): BlockTransaction {
	if (typeof value !== 'object' || value === null) throw new Error('RPC returned an invalid transaction')
	const transaction = value as Record<string, unknown>
	return {
		blockHash: transaction['blockHash'] === undefined || transaction['blockHash'] === null ? undefined : normalizeHash(transaction['blockHash']),
		blockNumber: transaction['blockNumber'] === undefined || transaction['blockNumber'] === null ? undefined : normalizeRpcBigInt(transaction['blockNumber']),
		from: normalizeAddress(transaction['from']),
		gas: normalizeRequiredTransactionQuantity(transaction, 'gas'),
		gasPrice: transaction['gasPrice'] === undefined || transaction['gasPrice'] === null ? undefined : normalizeRpcBigInt(transaction['gasPrice']),
		hash: normalizeHash(transaction['hash']),
		input: normalizeTransactionInput(transaction),
		maxFeePerGas: transaction['maxFeePerGas'] === undefined || transaction['maxFeePerGas'] === null ? undefined : normalizeRpcBigInt(transaction['maxFeePerGas']),
		maxPriorityFeePerGas: transaction['maxPriorityFeePerGas'] === undefined || transaction['maxPriorityFeePerGas'] === null ? undefined : normalizeRpcBigInt(transaction['maxPriorityFeePerGas']),
		nonce: normalizeRequiredTransactionQuantity(transaction, 'nonce'),
		to: normalizeTransactionRecipient(transaction),
		transactionIndex: transaction['transactionIndex'] === undefined || transaction['transactionIndex'] === null ? undefined : normalizeRpcBigInt(transaction['transactionIndex']),
		type: normalizeTransactionType(transaction['type']),
		value: normalizeRequiredTransactionQuantity(transaction, 'value'),
	}
}

export function normalizeBlock(value: unknown, includeTransactions: boolean, pending: boolean) {
	if (typeof value !== 'object' || value === null) throw new Error('RPC returned an invalid block')
	const block = value as Record<string, unknown>
	if (block['timestamp'] === undefined || block['timestamp'] === null) throw new Error('RPC returned a block without a timestamp')
	const hash = block['hash'] === undefined || block['hash'] === null ? undefined : normalizeHash(block['hash'])
	const number = block['number'] === undefined || block['number'] === null ? undefined : normalizeRpcBigInt(block['number'])
	if (pending) {
		if (hash !== undefined || number !== undefined) throw new Error('RPC returned a pending block with mined identifiers')
	} else {
		if (hash === undefined) throw new Error('RPC returned a mined block without a hash')
		if (number === undefined) throw new Error('RPC returned a mined block without a number')
	}
	const rawTransactions = block['transactions']
	if (!Array.isArray(rawTransactions)) throw new Error('RPC returned a block without transactions')
	const transactions = (() => {
		if (!includeTransactions) return rawTransactions.map(transaction => normalizeHash(transaction))
		const normalizedTransactions = rawTransactions.map(transaction => normalizeTransaction(transaction))
		for (const [index, transaction] of normalizedTransactions.entries()) {
			if (pending) {
				if (transaction.blockHash !== undefined || transaction.blockNumber !== undefined || transaction.transactionIndex !== undefined) throw new Error('RPC returned a pending block with a transaction containing mined metadata')
				continue
			}
			if (transaction.blockHash !== hash) throw new Error('RPC returned a block with a transaction whose blockHash does not match the block')
			if (transaction.blockNumber !== number) throw new Error('RPC returned a block with a transaction whose blockNumber does not match the block')
			if (transaction.transactionIndex !== BigInt(index)) throw new Error('RPC returned a block with a transaction whose transactionIndex does not match the block')
		}
		return normalizedTransactions
	})()
	return {
		baseFeePerGas: block['baseFeePerGas'] === undefined || block['baseFeePerGas'] === null ? undefined : normalizeRpcBigInt(block['baseFeePerGas']),
		hash,
		number,
		parentHash: block['parentHash'] === undefined || block['parentHash'] === null ? undefined : normalizeHash(block['parentHash']),
		timestamp: normalizeRpcBigInt(block['timestamp']),
		transactions,
	} satisfies Block
}

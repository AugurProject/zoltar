import type { Address, Hash } from '@zoltar/bot-shared/ethereum'
import { fetchLogsWithAdaptiveRanges, LogScanError } from '@zoltar/bot-shared/monitoring/block-sync'
import { findEarliestAvailableLogBlock, permanentHistoricalLogError } from '@zoltar/bot-shared/monitoring/log-availability'
import type { ChaosProtocolIndex, ProtocolIndexUpdate, UpdateProtocolIndexContext } from './protocol-index.ts'

export class ChaosProtocolIndexReorgError extends Error {
	readonly rescanFromBlock: bigint

	constructor(message: string, rescanFromBlock: bigint) {
		super(message)
		this.name = 'ChaosProtocolIndexReorgError'
		this.rescanFromBlock = rescanFromBlock
	}
}

type ProtocolLogQuery = {
	address: Address | Address[]
	fromBlock: bigint
	toBlock: bigint
	/** Accepted topic0 alternatives, pushed to the RPC so nodes filter server-side. */
	topics: readonly Hash[]
}

export async function fetchProtocolLogs(client: UpdateProtocolIndexContext['client'], query: ProtocolLogQuery) {
	const maximumRange = query.toBlock - query.fromBlock + 1n
	return await fetchLogsWithAdaptiveRanges({ nextBlock: query.fromBlock }, query.toBlock, maximumRange, async range => await client.getLogs({ address: query.address, fromBlock: range.fromBlock, toBlock: range.toBlock, topics: [query.topics] }))
}

export type CanonicalLogPosition = {
	address: Address
	blockHash?: Hash | null | undefined
	blockNumber?: bigint | null | undefined
	data: `0x${string}`
	logIndex?: bigint | number | null | undefined
	removed?: boolean | undefined
	topics: readonly Hash[]
	transactionHash?: Hash | null | undefined
	transactionIndex?: bigint | number | null | undefined
}

export function canonicalLogOrdinal(value: bigint | number, label: string) {
	if (typeof value === 'number') {
		if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`)
		return BigInt(value)
	}
	if (value < 0n) throw new Error(`${label} is invalid`)
	return value
}

export function orderedCanonicalLogs<T extends CanonicalLogPosition>(logs: readonly T[], fromBlock: bigint, toBlock: bigint, label: string) {
	const identities = new Set<string>()
	const ordered = [...logs]
	for (const log of ordered) {
		if (log.removed) throw new Error(`${label} returned a removed canonical log`)
		if (log.blockHash == null || log.blockNumber == null || log.transactionHash == null || log.transactionIndex == null || log.logIndex == null) {
			throw new Error(`${label} returned a log without a canonical position`)
		}
		if (log.blockNumber < fromBlock || log.blockNumber > toBlock) throw new Error(`${label} returned a log outside the requested block range`)
		canonicalLogOrdinal(log.transactionIndex, `${label} transaction index`)
		canonicalLogOrdinal(log.logIndex, `${label} log index`)
		const identity = `${log.blockHash.toLowerCase()}:${log.transactionHash.toLowerCase()}:${log.logIndex.toString()}`
		if (identities.has(identity)) throw new Error(`${label} returned duplicate log ${identity}`)
		identities.add(identity)
	}
	return ordered.sort((left, right) => {
		if (left.blockNumber == null || right.blockNumber == null || left.transactionIndex == null || right.transactionIndex == null || left.logIndex == null || right.logIndex == null) {
			throw new Error(`${label} lost a canonical log position`)
		}
		if (left.blockNumber !== right.blockNumber) return left.blockNumber < right.blockNumber ? -1 : 1
		const leftTransactionIndex = canonicalLogOrdinal(left.transactionIndex, `${label} transaction index`)
		const rightTransactionIndex = canonicalLogOrdinal(right.transactionIndex, `${label} transaction index`)
		if (leftTransactionIndex !== rightTransactionIndex) return leftTransactionIndex < rightTransactionIndex ? -1 : 1
		const leftLogIndex = canonicalLogOrdinal(left.logIndex, `${label} log index`)
		const rightLogIndex = canonicalLogOrdinal(right.logIndex, `${label} log index`)
		if (leftLogIndex === rightLogIndex) return 0
		return leftLogIndex < rightLogIndex ? -1 : 1
	})
}

export function validatePreviousProtocolIndex(context: UpdateProtocolIndexContext, previous: ChaosProtocolIndex) {
	if (previous.schemaVersion !== 3) throw new Error(`Unsupported protocol index schema ${previous.schemaVersion}`)
	if (previous.chainId !== context.chainId) throw new Error('Protocol index chain does not match discovery chain')
	if (previous.openOracle.toLowerCase() !== context.openOracle.toLowerCase()) throw new Error('Protocol index OpenOracle deployment changed')
	if (previous.zoltar.toLowerCase() !== context.zoltar.toLowerCase()) throw new Error('Protocol index Zoltar deployment changed')
	if (previous.securityPoolForker.toLowerCase() !== context.securityPoolForker.toLowerCase()) throw new Error('Protocol index SecurityPoolForker deployment changed')
	if (previous.wallet.toLowerCase() !== context.wallet.toLowerCase()) throw new Error('Protocol index wallet changed')
	if (previous.startBlock !== context.startBlock.toString()) throw new Error('Protocol index start block changed')
}

export async function requireCanonicalBlock(client: UpdateProtocolIndexContext['client'], blockNumber: bigint, expectedHash?: Hash) {
	const block = await client.getBlock({ blockNumber })
	if (block.number !== blockNumber || block.hash === null || block.hash === undefined) throw new Error(`RPC did not return canonical block ${blockNumber.toString()}`)
	if (expectedHash !== undefined && block.hash.toLowerCase() !== expectedHash.toLowerCase()) {
		throw new ChaosProtocolIndexReorgError(`Block ${blockNumber.toString()} changed from ${expectedHash} to ${block.hash}`, blockNumber)
	}
	return block.hash
}

export async function recoverPrunedProtocolLogs(context: UpdateProtocolIndexContext, scanProtocolIndex: (context: UpdateProtocolIndexContext) => Promise<ProtocolIndexUpdate>): Promise<ProtocolIndexUpdate> {
	try {
		return await scanProtocolIndex(context)
	} catch (error) {
		if (!(error instanceof LogScanError) || !permanentHistoricalLogError(error)) throw error
		const availableStartBlock = await findEarliestAvailableLogBlock(error.logRange.fromBlock, context.anchorBlockNumber, blockNumber => context.client.getLogs({ address: context.openOracle, fromBlock: blockNumber, toBlock: blockNumber }))
		if (availableStartBlock <= error.logRange.fromBlock) throw error
		// Rebuild a contiguous suffix. Mixing pre-gap cumulative accounting with
		// post-gap events would invent continuity that the provider cannot prove.
		const { previous: _previous, ...fresh } = context
		return await scanProtocolIndex({ ...fresh, availableStartBlock })
	}
}

export async function protocolLogPrefixAvailable(context: UpdateProtocolIndexContext) {
	if (context.previous?.availableStartBlock === undefined || context.availableStartBlock !== undefined) return false
	try {
		await context.client.getLogs({ address: context.openOracle, fromBlock: context.startBlock, toBlock: context.startBlock })
		return true
	} catch (error) {
		if (!permanentHistoricalLogError(error)) throw error
		return false
	}
}

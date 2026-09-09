import type { Hash } from '@zoltar/bot-shared/ethereum'
import { LogScanError } from '@zoltar/bot-shared/monitoring/block-sync'
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

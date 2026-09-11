import type { Abi, AbiValue, Address } from '@zoltar/bot-shared/ethereum'
import type { ReadClient } from '#core/operator-types'

export type BatchCall = {
	abi: Abi
	address: Address
	args?: readonly AbiValue[] | undefined
	functionName: string
}

export type BatchResult = { result: AbiValue | undefined; status: 'success' } | { error: Error; status: 'failure' }

export type BatchReader = Pick<ReadClient, 'multicall'>

/** Multicall3 requests are chunked so one scan stage never exceeds the RPC call-data and response limits. */
const MAX_BATCH_CALLS = 200

function chunked<Value>(values: readonly Value[], size: number) {
	const chunks: Value[][] = []
	for (let start = 0; start < values.length; start += size) chunks.push(values.slice(start, start + size))
	return chunks
}

/**
 * Reads every call through one Multicall3 `aggregate3` request per chunk at the given block.
 * Each call fails independently so one reverting quote or token never hides the healthy results.
 */
export async function batchRead(client: BatchReader, multicall3: Address, calls: readonly BatchCall[], blockNumber?: bigint | undefined): Promise<readonly BatchResult[]> {
	if (calls.length === 0) return []
	const chunks = await Promise.all(
		chunked(calls, MAX_BATCH_CALLS).map(async chunk => {
			const results = await client.multicall({ allowFailure: true, blockNumber, contracts: chunk, multicallAddress: multicall3 })
			return results.map((entry): BatchResult => (entry.status === 'success' ? { result: entry.result, status: 'success' } : { error: entry.error, status: 'failure' }))
		}),
	)
	return chunks.flat()
}

export function batchValue(result: BatchResult | undefined, description: string) {
	if (result === undefined) throw new Error(`${description} is missing from the batched read`)
	if (result.status === 'failure') throw new Error(`${description} failed: ${result.error.message}`, { cause: result.error })
	return result.result
}

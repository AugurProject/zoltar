import type { Abi, AbiValue, Address } from '@zoltar/bot-shared/ethereum'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'
import type { ReadClient } from '#core/operator-types'

export type BatchCall = {
	abi: Abi
	address: Address
	args?: readonly AbiValue[] | undefined
	functionName: string
}

export type BatchResult = { result: AbiValue | undefined; status: 'success' } | { error: Error; status: 'failure' }

export type BatchReader = Pick<ReadClient, 'multicall' | 'readContract'>

/** Multicall3 requests are chunked so one scan stage never exceeds the RPC call-data and response limits. */
const MAX_BATCH_CALLS = 200

function chunked<Value>(values: readonly Value[], size: number) {
	const chunks: Value[][] = []
	for (let start = 0; start < values.length; start += size) chunks.push(values.slice(start, start + size))
	return chunks
}

/**
 * Reads every call through one Multicall3 `aggregate3` request per chunk at the given block.
 * Trusted calls use aggregate3; untrusted targets require isolation so gas exhaustion
 * cannot consume another call's budget. Connectivity failures still fail the snapshot.
 */
export async function batchRead(client: BatchReader, multicall3: Address, calls: readonly BatchCall[], blockNumber?: bigint | undefined, isolation?: { gas: bigint }): Promise<readonly BatchResult[]> {
	if (calls.length === 0) return []
	if (isolation !== undefined) {
		const results: BatchResult[] = []
		// Separate eth_calls reserve gas independently; aggregate3 allowFailure
		// cannot isolate a target which consumes all forwarded gas.
		for (const chunk of chunked(calls, 8)) {
			results.push(
				...(await Promise.all(
					chunk.map(async (call): Promise<BatchResult> => {
						try {
							return { status: 'success', result: await client.readContract({ ...call, blockNumber, gas: isolation.gas }) }
						} catch (error) {
							// Providers may encode contract gas exhaustion as an internal RPC error.
							const contractFailure = /out of gas|invalid opcode|invalid instruction|execution reverted/i.test(errorMessage(error))
							if (!contractFailure && operationalFailureDisposition(error) === 'connectivity-degraded') throw error
							return { status: 'failure', error: error instanceof Error ? error : new Error('Untrusted read failed', { cause: error }) }
						}
					}),
				)),
			)
		}
		return results
	}
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

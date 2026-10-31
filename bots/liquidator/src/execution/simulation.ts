import { RpcError } from '@zoltar/bot-shared/ethereum'
import { settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import type { RpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { errorChain } from '@zoltar/core-shared/errors/errorChain'

function isExecutionRevert(error: unknown) {
	return [...errorChain(error)].some(cause => cause instanceof RpcError && (cause.code === 3 || cause.code === -32000 || cause.code === -32015) && /\bexecution reverted\b/i.test(cause.shortMessage ?? cause.message))
}

/** Only unanimous explicit execution reverts permit rescreening; mixed or unavailable evidence retains its failure. */
export async function simulateWithRevalidation<T>(label: string, observations: readonly Promise<{ endpoint: string; value: T }>[], requirement: RpcQuorumRequirement, revalidateRevert?: () => Promise<unknown>) {
	const settled = await Promise.allSettled(observations)
	if (revalidateRevert !== undefined && settled.length >= requirement && settled.every(result => result.status === 'rejected' && isExecutionRevert(result.reason))) await revalidateRevert()
	// Revalidation returning normally means the revert is unexplained, so preserve the original failure.
	return settledQuorumValue(label, observations, requirement)
}

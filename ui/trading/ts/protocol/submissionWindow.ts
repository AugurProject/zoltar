import { hasSubmissionWindow } from '@zoltar/ui-core-shared/transactions/submissionTiming.js'
import type { Hash, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_SecurityPool_SecurityPool } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import type { LiveMarket } from './liveMarket.js'
import { latestBlockIdentity } from './tradeQuote.js'
import * as copy from '../copy/availability.js'

export type SubmissionOperation = 'entry' | 'exit' | 'initialize' | 'add' | 'remove'
type SubmissionTiming = Readonly<{ endTime: bigint }>

export function submissionWindowBlocker(timing: SubmissionTiming, operation: SubmissionOperation, timestamp: bigint | undefined) {
	if (operation === 'remove') return undefined
	if (timestamp === undefined || timing.endTime <= 0n) return copy.submissionTimingUnavailableReason
	return hasSubmissionWindow(timestamp, timing.endTime) ? undefined : copy.questionClosingSoonReason
}

/** Use the same exclusive eligibility cutoff for ticket estimates and pinned protocol quotes. */
export function capSubmissionDeadline(timing: SubmissionTiming, operation: SubmissionOperation, requestedDeadline: bigint) {
	if (operation === 'remove') return requestedDeadline
	return requestedDeadline < timing.endTime ? requestedDeadline : timing.endTime - 1n
}

export async function submissionDeadline(client: WalletClient, market: LiveMarket, operation: SubmissionOperation, block: Readonly<{ blockHash: Hash; blockTimestamp: bigint }>, requestedDeadline: bigint) {
	if (operation === 'remove') return requestedDeadline
	const questionData = await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: market.pool, functionName: 'questionData', blockHash: block.blockHash })
	const endTime = await client.readContract({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionData, functionName: 'getQuestionEndDate', args: [market.questionId], blockHash: block.blockHash })
	const blocker = submissionWindowBlocker({ endTime }, operation, block.blockTimestamp)
	if (blocker !== undefined) throw new Error(blocker)
	return capSubmissionDeadline({ endTime }, operation, requestedDeadline)
}

/** Repeat inside the wallet-context guard immediately before requesting the signature. */
export async function requireFreshSubmissionWindow(client: WalletClient, market: LiveMarket, operation: SubmissionOperation, deadline: bigint) {
	if (operation === 'remove') return
	const block = await latestBlockIdentity(client)
	const refreshedDeadline = await submissionDeadline(client, market, operation, block, deadline)
	if (refreshedDeadline < deadline || deadline <= block.blockTimestamp) throw new Error(copy.submissionTimingChangedReason)
}

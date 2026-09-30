import type { Hash, PublicClient, WalletClient } from '@zoltar/core-shared/evm/ethereum'
import { ZoltarQuestionData_ZoltarQuestionData } from '@zoltar/ui-core-shared/contractArtifact.js'
import { statoblast_SecurityPool_SecurityPool, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import type { LiveMarket } from './liveMarket.js'
import { latestBlockIdentity } from './tradeQuote.js'
import * as copy from '../copy/availability.js'

export type SubmissionOperation = 'entry' | 'exit' | 'initialize' | 'add' | 'remove'
type SubmissionTiming = Readonly<{ endTime: bigint; oracleValidUntilTimestamp?: bigint | undefined }>

// A bounded allowance for confirmation and inclusion, not a guarantee against arbitrary wallet/mining delays.
const SUBMISSION_WINDOW_SECONDS = 60n

export function submissionWindowBlocker(timing: SubmissionTiming, operation: SubmissionOperation, timestamp: bigint | undefined) {
	if (operation === 'remove') return undefined
	if (timestamp === undefined || timing.endTime <= 0n) return copy.submissionTimingUnavailableReason
	if (timing.endTime <= timestamp + SUBMISSION_WINDOW_SECONDS) return copy.questionClosingSoonReason
	if (operation === 'exit') return undefined
	if (timing.oracleValidUntilTimestamp === undefined) return copy.submissionTimingUnavailableReason
	return timing.oracleValidUntilTimestamp <= timestamp + SUBMISSION_WINDOW_SECONDS ? copy.oracleExpiringSoonReason : undefined
}

export async function loadOracleValidity(client: Pick<PublicClient, 'readContract' | 'getChainId'>, pool: LiveMarket['pool'], blockHash: Hash) {
	const manager = await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: pool, functionName: 'priceOracleManagerAndOperatorQueuer', blockHash })
	const [lastSettlementTimestamp, chainId] = await Promise.all([client.readContract({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, address: manager, functionName: 'lastSettlementTimestamp', blockHash }), client.getChainId()])
	return lastSettlementTimestamp === 0n ? undefined : lastSettlementTimestamp + (chainId === 11155111 ? 3600n : 300n)
}

export async function submissionDeadline(client: WalletClient, market: LiveMarket, operation: SubmissionOperation, block: Readonly<{ blockHash: Hash; blockTimestamp: bigint }>, requestedDeadline: bigint) {
	if (operation === 'remove') return requestedDeadline
	const questionData = await client.readContract({ abi: statoblast_SecurityPool_SecurityPool.abi, address: market.pool, functionName: 'questionData', blockHash: block.blockHash })
	const [endTime, oracleValidUntilTimestamp] = await Promise.all([
		client.readContract({ abi: ZoltarQuestionData_ZoltarQuestionData.abi, address: questionData, functionName: 'getQuestionEndDate', args: [market.questionId], blockHash: block.blockHash }),
		operation === 'exit' ? undefined : loadOracleValidity(client, market.pool, block.blockHash),
	])
	const blocker = submissionWindowBlocker({ endTime, oracleValidUntilTimestamp }, operation, block.blockTimestamp)
	if (blocker !== undefined) throw new Error(blocker)
	const cutoff = oracleValidUntilTimestamp !== undefined && oracleValidUntilTimestamp < endTime ? oracleValidUntilTimestamp : endTime
	return requestedDeadline < cutoff ? requestedDeadline : cutoff - 1n
}

/** Repeat inside the wallet-context guard immediately before requesting the signature. */
export async function requireFreshSubmissionWindow(client: WalletClient, market: LiveMarket, operation: SubmissionOperation, deadline: bigint) {
	if (operation === 'remove') return
	const block = await latestBlockIdentity(client)
	const refreshedDeadline = await submissionDeadline(client, market, operation, block, deadline)
	if (refreshedDeadline < deadline || deadline <= block.blockTimestamp) throw new Error(copy.submissionTimingChangedReason)
}

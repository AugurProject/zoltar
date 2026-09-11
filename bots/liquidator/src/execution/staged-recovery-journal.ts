import { type PendingStagedOperation } from '#state/operator-state'
import { type Hex } from '@zoltar/bot-shared/ethereum'

export function recordStagedRecoveryChunk(pending: PendingStagedOperation, range: { fromBlock: bigint; toBlock: bigint }, outcome: PendingStagedOperation['candidateOutcome'], historical: boolean) {
	if (outcome !== undefined) {
		pending.candidateOutcome = outcome
		return
	}
	if (historical) {
		if (range.fromBlock === pending.queuedBlock) {
			pending.nextHistoricalBlock = undefined
			pending.historicalRecoveryComplete = true
		} else pending.nextHistoricalBlock = range.fromBlock - 1n
		return
	}
	pending.latestRecoveryBlock = range.toBlock > (pending.latestRecoveryBlock ?? 0n) ? range.toBlock : pending.latestRecoveryBlock
	if (pending.nextHistoricalBlock === undefined && !pending.historicalRecoveryComplete && range.fromBlock > pending.queuedBlock) pending.nextHistoricalBlock = range.fromBlock - 1n
}

export function recordStagedRecoveryGap(pending: PendingStagedOperation, cursorFromBlock: bigint, latestFromBlock: bigint) {
	if (latestFromBlock <= cursorFromBlock) return
	const newestMissingBlock = latestFromBlock - 1n
	if (pending.nextHistoricalBlock === undefined || newestMissingBlock > pending.nextHistoricalBlock) pending.nextHistoricalBlock = newestMissingBlock
	pending.historicalRecoveryComplete = false
}

export function nextStagedHistoricalRecoveryRange(pending: PendingStagedOperation, maximumBlocks: bigint) {
	if (pending.nextHistoricalBlock === undefined || pending.nextHistoricalBlock < pending.queuedBlock) return undefined
	const availableBlocks = pending.nextHistoricalBlock - pending.queuedBlock + 1n
	const requestedBlocks = maximumBlocks < availableBlocks ? maximumBlocks : availableBlocks
	return {
		fromBlock: pending.nextHistoricalBlock - requestedBlocks + 1n,
		toBlock: pending.nextHistoricalBlock,
	}
}

export function stagedRecoveryAnchorMatches(pending: Pick<PendingStagedOperation, 'recoveryAnchorBlock' | 'recoveryAnchorHash'>, head: bigint, observedHash: Hex | undefined) {
	if (pending.recoveryAnchorBlock === undefined || pending.recoveryAnchorHash === undefined) return true
	return pending.recoveryAnchorBlock <= head && observedHash?.toLowerCase() === pending.recoveryAnchorHash.toLowerCase()
}

import { CLAIM_CHECKPOINT_MAX_STEPS, isFinalClaimCheckpointBatch } from '@zoltar/statoblast-shared/escalationGame/claimCheckpoint'
import { encodeFunctionData } from '@zoltar/bot-shared/ethereum'
import { escalationGameAbi, securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'
import type { ForkedClaimCheckpointSnapshot } from '../carry-types.ts'

export function claimCheckpointArguments(candidate: ForkedClaimCheckpointSnapshot) {
	return [
		candidate.outcome,
		BigInt(candidate.amountAttoRep),
		BigInt(candidate.cumulativeAmountAttoRep),
		BigInt(candidate.leafIndex),
		CLAIM_CHECKPOINT_MAX_STEPS,
		candidate.baseCommitment,
		candidate.transforms.map(value => ({ repBeforeAttoRep: BigInt(value.repBeforeAttoRep), repRemainingAttoRep: BigInt(value.repRemainingAttoRep), consumedBeforeAttoRep: BigInt(value.consumedBeforeAttoRep) })),
	] as const
}

export function claimCheckpointWithdrawalCalls(candidate: ForkedClaimCheckpointSnapshot) {
	const final = candidate.finalWithdrawal
	if (final === undefined) throw new Error('Missing authenticated final checkpoint withdrawal')
	if (candidate.preparationReason !== 'required' || candidate.targetGame?.toLowerCase() !== candidate.game.toLowerCase() || !isFinalClaimCheckpointBatch({ nextSourceGame: candidate.nextSourceGame, pendingSteps: BigInt(candidate.pendingSteps) }, candidate.transforms.length))
		throw new Error('Checkpoint batch does not finish the withdrawal target')
	if (final.proof.amountAttoRep !== candidate.amountAttoRep || final.proof.cumulativeAmountAttoRep !== candidate.cumulativeAmountAttoRep || final.proof.leafIndex !== candidate.leafIndex || final.proof.parentDepositIndex !== candidate.parentDepositIndex || final.proof.sourceNodeId !== candidate.sourceNodeId)
		throw new Error('Checkpoint identity differs from authenticated withdrawal proof')
	const proof = {
		...final.proof,
		amountAttoRep: BigInt(final.proof.amountAttoRep),
		cumulativeAmountAttoRep: BigInt(final.proof.cumulativeAmountAttoRep),
		parentDepositIndex: BigInt(final.proof.parentDepositIndex),
		sourceNodeId: BigInt(final.proof.sourceNodeId),
		leafIndex: BigInt(final.proof.leafIndex),
		merkleMountainRangePeakIndex: BigInt(final.proof.merkleMountainRangePeakIndex),
	}
	return [
		{ target: candidate.game, allowFailure: false, callData: encodeFunctionData({ abi: escalationGameAbi, functionName: 'processClaimCheckpoint', args: claimCheckpointArguments(candidate) }) },
		{ target: candidate.pool, allowFailure: false, callData: encodeFunctionData({ abi: securityPoolAbi, functionName: 'withdrawForkedEscalationDeposits', args: [candidate.outcome, [proof]] }) },
	]
}

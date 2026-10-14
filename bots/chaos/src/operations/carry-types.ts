import type { ClaimCheckpointSettlement } from '@zoltar/statoblast-shared/escalationGame/claimCheckpoint'
import type { Address, Hash, Hex } from '@zoltar/bot-shared/ethereum'
import type { CanonicalUintString } from '../core/units.ts'

/** A serialization-safe carried-deposit proof verified against one canonical anchor. */
interface ForkedCarryDepositProofSnapshot {
	depositor: Address
	amountAttoRep: CanonicalUintString
	parentDepositIndex: string
	cumulativeAmountAttoRep: CanonicalUintString
	sourceNodeId: string
	leafIndex: string
	merkleMountainRangeSiblings: Hash[]
	merkleMountainRangePeakIndex: string
	nullifierSiblings: Hash[]
}

/** One independently executable inherited escalation withdrawal. */
export interface ForkedCarryWithdrawalSnapshot {
	pool: Address
	game: Address
	sourcePool: Address
	sourceGame: Address
	claimSourceGame: Address
	outcome: 0 | 1 | 2
	depositor: Address
	amountAttoRep: CanonicalUintString
	parentDepositIndex: string
	sourceNodeId: string
	proof: ForkedCarryDepositProofSnapshot
	resultingCarryRoot: Hash
	resultingNullifierRoot: Hash
	amountToWithdrawAttoRep: CanonicalUintString
	burnAmountAttoRep: CanonicalUintString
	preflightExpectedResult: Hex
}

export type ForkedClaimCheckpointSnapshot = Pick<ForkedCarryWithdrawalSnapshot, 'pool' | 'game' | 'sourceGame' | 'claimSourceGame' | 'outcome' | 'parentDepositIndex' | 'sourceNodeId'> & {
	amountAttoRep: CanonicalUintString
	cumulativeAmountAttoRep: CanonicalUintString
	leafIndex: string
	nextSourceGame: Address
	pendingSteps: string
	pendingCommitment: Hash
	baseCommitment: Hash
	transforms: { repBeforeAttoRep: CanonicalUintString; repRemainingAttoRep: CanonicalUintString; consumedBeforeAttoRep: CanonicalUintString }[]
	targetGame: Address
	preparationReason: 'required' | 'shared-ancestor' | 'finishing-parent'
	settlement: ClaimCheckpointSettlement
	finalWithdrawal?: { multicall3: Address; proof: ForkedCarryDepositProofSnapshot; resultingCarryRoot: Hash; resultingNullifierRoot: Hash; preflightExpectedResult: Hex }
}

/** Lightweight canonical identity retained independently of bounded proof work. */
export interface ForkedCarryWithdrawalPresenceSnapshot {
	pool: Address
	game: Address
	sourceGame: Address
	claimSourceGame: Address
	outcome: 0 | 1 | 2
	parentDepositIndex: string
	sourceNodeId: string
}

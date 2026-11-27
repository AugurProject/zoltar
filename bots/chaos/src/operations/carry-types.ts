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
	amountToWithdrawAttoRep: CanonicalUintString
	burnAmountAttoRep: CanonicalUintString
	preflightExpectedResult: Hex
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

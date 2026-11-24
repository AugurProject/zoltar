import type { Address } from '@zoltar/bot-shared/ethereum'
import type { CanonicalUintString } from '../core/units.ts'

/** One owner's capital in one security pool universe, shared by all its questions. */
export interface SecurityPoolCapitalSnapshot {
	admissibleQuestionIds: string[]
	securityPool: Address
	universeId: CanonicalUintString
	capitalLedger: Address
	commitmentIndex: Address
	repToken: Address
	priceFeed: Address
	forkController: Address
	owner: Address
	positionId: CanonicalUintString
	principalAttoRep: CanonicalUintString
	pledgedAttoRep: CanonicalUintString
	commitmentAttoEth: CanonicalUintString
	withdrawableAttoRep: CanonicalUintString
	feesAttoEth: CanonicalUintString
	feesAttoRep: CanonicalUintString
	targetHealthFactorBps: CanonicalUintString
	minimumCommitmentAttoEth: CanonicalUintString
	securityMultiplierBps: CanonicalUintString
	ownerConservativePrice: CanonicalUintString
	ownerLiquidating: boolean
	priceValid: boolean
	priceValidUntil: CanonicalUintString
	forkTime: CanonicalUintString
	frozen: boolean
	importing: boolean
	exported: boolean
	retirementPending: boolean
	retirementReady: boolean
}

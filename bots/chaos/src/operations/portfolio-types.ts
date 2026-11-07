import type { Address } from '@zoltar/bot-shared/ethereum'
import type { CanonicalUintString } from '../core/units.ts'

/** One owner's capital in one portfolio universe, shared by all its questions. */
export interface PortfolioCapitalSnapshot {
	admissibleQuestionIds: string[]
	portfolio: Address
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
	priceValid: boolean
	priceValidUntil: CanonicalUintString
	forkTime: CanonicalUintString
	frozen: boolean
	importing: boolean
	exported: boolean
	retirementPending: boolean
	retirementReady: boolean
}

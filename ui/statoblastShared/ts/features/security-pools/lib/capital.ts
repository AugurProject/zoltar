import { capital } from '../../../copy/securityPoolTransactions.js'
import { depositLiquidating } from '../../../copy/securityPoolCapital.js'
import type { SecurityPoolCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPool'

const ceilDivide = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor

export function requiredSecurityPoolCollateral(snapshot: Pick<SecurityPoolCapitalSnapshot, 'ownerConservativePrice' | 'securityMultiplierBps' | 'ownerAccount'>, commitment: bigint, proofPrice?: bigint, targetHealthFactorBps?: bigint) {
	const price = proofPrice !== undefined && proofPrice > snapshot.ownerConservativePrice ? proofPrice : snapshot.ownerConservativePrice
	const health = targetHealthFactorBps ?? (snapshot.ownerAccount.targetHealthFactorBps || 10_000n)
	const value = ceilDivide(commitment * price, 10n ** 18n)
	const backing = ceilDivide(value * snapshot.securityMultiplierBps, 10_000n)
	return ceilDivide(backing * health, 10_000n)
}

/** Reverse the contract's nested upward rounding, preserving the exact maximum. */
export function maximumSecurityPoolCommitment(snapshot: Pick<SecurityPoolCapitalSnapshot, 'ownerConservativePrice' | 'securityMultiplierBps' | 'ownerPrincipalAttoRep'>, health: bigint | undefined, proofPrice?: bigint) {
	const price = proofPrice !== undefined && proofPrice > snapshot.ownerConservativePrice ? proofPrice : snapshot.ownerConservativePrice
	if (health === undefined || health < 10_000n || health >= 1n << 256n || price <= 0n || snapshot.securityMultiplierBps <= 0n) return undefined
	const backing = (snapshot.ownerPrincipalAttoRep * 10_000n) / health
	const value = (backing * 10_000n) / snapshot.securityMultiplierBps
	const capacity = (value * 10n ** 18n) / price
	return capacity < 1n << 256n ? capacity : (1n << 256n) - 1n
}

export function capitalHealthReason(snapshot: SecurityPoolCapitalSnapshot, health: bigint | undefined, additionalRep = 0n) {
	if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return 'This universe is closed to health changes.'
	if (health === undefined || health < 10_000n) return 'Choose a health target of at least 100%.'
	if (health >= 1n << 256n) return 'This health target is too large.'
	const saved = snapshot.ownerAccount.targetHealthFactorBps || 10_000n
	if (health <= saved || snapshot.ownerCommitmentAttoEth === 0n) return undefined
	if (!snapshot.priceValid) return 'A new accepted REP price is required before raising your target.'
	const pledged = snapshot.positions.find(position => position.commitment > 0n)?.rep ?? 0n
	if (pledged + additionalRep < requiredSecurityPoolCollateral(snapshot, snapshot.ownerCommitmentAttoEth, undefined, health)) return 'Add REP or complete a commitment reduction before raising your target.'
	return undefined
}

/** Collateral a position's REP backs when the fresh liquidation price shows it underwater. */
export function coveredUnderwaterCommitment(snapshot: Pick<SecurityPoolCapitalSnapshot, 'priceValid' | 'liquidationPrice' | 'securityMultiplierBps'>, position: Pick<SecurityPoolCapitalSnapshot['positions'][number], 'rep' | 'commitment' | 'maxHealthyPrice'>) {
	if (!snapshot.priceValid || snapshot.liquidationPrice === 0n || position.maxHealthyPrice >= snapshot.liquidationPrice) return undefined
	// Matches the commitment index's rounding: the REP-backed amount rounds down.
	const covered = (((position.rep * 10_000n) / snapshot.securityMultiplierBps) * 10n ** 18n) / snapshot.liquidationPrice
	return covered < position.commitment ? covered : undefined
}

export function capitalRetirementReason(snapshot: SecurityPoolCapitalSnapshot, id: bigint, remaining: bigint | undefined) {
	if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return 'This universe is closed to commitment reductions.'
	const position = snapshot.positions.find(item => item.id === id && item.commitment > 0n)
	if (position === undefined) return 'Position is no longer live.'
	if (remaining === undefined || remaining < 0n) return 'Enter the commitment to keep, or zero to release it all.'
	if (position.batch !== 0n) return remaining === position.remainingCommitment ? undefined : 'A reduction is already in queue.'
	if (remaining >= position.commitment) return 'Choose a smaller remaining commitment.'
	if (remaining !== 0n && (remaining < snapshot.economics.minimumCommitmentAttoEth || position.commitment - remaining < snapshot.economics.minimumCommitmentAttoEth)) return 'The remaining commitment and reduction must each meet the security pool minimum.'
	return undefined
}

export function capitalAuthorizationReason(snapshot: SecurityPoolCapitalSnapshot, commitment: bigint | undefined, proofPrice?: bigint) {
	if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return 'This universe is closed to new commitments.'
	if (!snapshot.priceValid) return 'A new accepted REP price is required.'
	if (commitment === undefined || commitment === 0n) return 'Enter a positive commitment amount.'
	if (commitment < snapshot.economics.minimumCommitmentAttoEth) return 'Commitment is below this security pool’s minimum.'
	const active = snapshot.positions.find(position => position.commitment > 0n)
	if (active !== undefined && active.batch !== 0n) return 'Your commitment is locked until the reduction is released.'
	if (active !== undefined && commitment < active.commitment) return 'Use Reduce commitment to lower an existing commitment.'
	const totalCommitment = snapshot.totalCommitmentAttoEth - snapshot.ownerCommitmentAttoEth + commitment
	if (proofPrice === undefined && (totalCommitment > snapshot.oracleExposureLimitAttoEth || snapshot.demandAttoEth > snapshot.oracleExposureLimitAttoEth)) return capital.priceForLargerCommitment
	if (snapshot.ownerPrincipalAttoRep < requiredSecurityPoolCollateral(snapshot, commitment, proofPrice)) return 'Collateral is below your saved health target.'
	return undefined
}

export function capitalPositionPhase(batch: bigint, currentBatch: bigint) {
	if (batch === 0n) return 'active'
	return batch === currentBatch ? 'current' : 'next'
}

export function capitalWithdrawalReason(snapshot: SecurityPoolCapitalSnapshot, amount: bigint | undefined) {
	if (amount === undefined || amount === 0n) return 'Enter a positive amount.'
	if (amount <= snapshot.withdrawableAttoRep) return undefined
	if (snapshot.ownerCommitmentAttoEth > 0n) {
		if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return 'Pledged REP cannot be withdrawn during fork preparation.'
		if (!snapshot.priceValid) return 'A new accepted REP price is required before withdrawing pledged REP.'
	}
	return 'Amount exceeds withdrawable REP. Reduce commitment to release more pledged REP.'
}

/** Matches the ledger rule even while the accepted price is stale. */
export function capitalDepositReason(snapshot: Pick<SecurityPoolCapitalSnapshot, 'ownerAccount' | 'positions' | 'liquidationPrice'>) {
	const position = snapshot.positions.find(position => position.id === snapshot.ownerAccount.positionId)
	return position !== undefined && position.commitment > 0n && position.maxHealthyPrice < snapshot.liquidationPrice ? depositLiquidating : undefined
}

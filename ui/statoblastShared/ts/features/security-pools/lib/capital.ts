import { capital, newPriceRequired } from '../../../copy/securityPoolTransactions.js'
import * as copy from '../../../copy/securityPoolCapital.js'
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
	if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return copy.healthChangesClosed
	if (health === undefined || health < 10_000n) return copy.healthTargetMinimum
	if (health >= 1n << 256n) return copy.healthTargetTooLarge
	const saved = snapshot.ownerAccount.targetHealthFactorBps || 10_000n
	if (health <= saved || snapshot.ownerCommitmentAttoEth === 0n) return undefined
	if (!snapshot.priceValid) return copy.healthNeedsCurrentPrice
	const pledged = snapshot.positions.find(position => position.commitment > 0n)?.rep ?? 0n
	if (pledged + additionalRep < requiredSecurityPoolCollateral(snapshot, snapshot.ownerCommitmentAttoEth, undefined, health)) return copy.healthNeedsMoreRep
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
	if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return capital.reductionsClosed
	const position = snapshot.positions.find(item => item.id === id && item.commitment > 0n)
	if (position === undefined) return copy.positionInactive
	if (remaining === undefined || remaining < 0n) return copy.remainingCommitmentRequired
	if (position.batch !== 0n) return remaining === position.remainingCommitment ? undefined : copy.retirementRequested
	if (remaining >= position.commitment) return copy.smallerRemainingCommitmentRequired
	if (remaining !== 0n && (remaining < snapshot.economics.minimumCommitmentAttoEth || position.commitment - remaining < snapshot.economics.minimumCommitmentAttoEth)) return copy.reductionBelowMinimum
	return undefined
}

export function capitalAuthorizationReason(snapshot: SecurityPoolCapitalSnapshot, commitment: bigint | undefined, proofPrice?: bigint) {
	if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return capital.newCommitmentsClosed
	if (!snapshot.priceValid) return newPriceRequired
	if (commitment === undefined || commitment === 0n) return copy.positiveCommitmentRequired
	if (commitment < snapshot.economics.minimumCommitmentAttoEth) return copy.commitmentBelowMinimum
	const active = snapshot.positions.find(position => position.commitment > 0n)
	if (active !== undefined && active.batch !== 0n) return copy.queuedCommitmentLock
	if (active !== undefined && commitment < active.commitment) return copy.useReduceCommitment
	const totalCommitment = snapshot.totalCommitmentAttoEth - snapshot.ownerCommitmentAttoEth + commitment
	if (proofPrice === undefined && (totalCommitment > snapshot.oracleExposureLimitAttoEth || snapshot.demandAttoEth > snapshot.oracleExposureLimitAttoEth)) return capital.priceForLargerCommitment
	if (snapshot.ownerPrincipalAttoRep < requiredSecurityPoolCollateral(snapshot, commitment, proofPrice)) return copy.commitmentBelowHealthTarget
	return undefined
}

export function capitalPositionPhase(batch: bigint, currentBatch: bigint) {
	if (batch === 0n) return 'active'
	return batch === currentBatch ? 'current' : 'next'
}

export function capitalWithdrawalReason(snapshot: SecurityPoolCapitalSnapshot, amount: bigint | undefined) {
	if (amount === undefined || amount === 0n) return capital.positiveAmountRequired
	if (amount <= snapshot.withdrawableAttoRep) return undefined
	if (snapshot.ownerCommitmentAttoEth > 0n) {
		if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return copy.forkPreventsWithdrawal
		if (!snapshot.priceValid) return copy.withdrawalNeedsCurrentPrice
	}
	return copy.amountAboveWithdrawable
}

/** Matches the ledger rule even while the accepted price is stale. */
export function capitalDepositReason(snapshot: Pick<SecurityPoolCapitalSnapshot, 'ownerAccount' | 'positions' | 'liquidationPrice'>) {
	const position = snapshot.positions.find(position => position.id === snapshot.ownerAccount.positionId)
	return position !== undefined && position.commitment > 0n && position.maxHealthyPrice < snapshot.liquidationPrice ? copy.depositLiquidating : undefined
}

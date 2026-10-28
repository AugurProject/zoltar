import type { PortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'

const ceilDivide = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor

export function requiredPortfolioCollateral(snapshot: Pick<PortfolioCapitalSnapshot, 'ownerConservativePrice' | 'securityMultiplierBps' | 'ownerAccount'>, commitment: bigint, proofPrice?: bigint, targetHealthFactorBps?: bigint) {
	const price = proofPrice !== undefined && proofPrice > snapshot.ownerConservativePrice ? proofPrice : snapshot.ownerConservativePrice
	const health = targetHealthFactorBps ?? (snapshot.ownerAccount.targetHealthFactorBps || 10_000n)
	const value = ceilDivide(commitment * price, 10n ** 18n)
	const backing = ceilDivide(value * snapshot.securityMultiplierBps, 10_000n)
	return ceilDivide(backing * health, 10_000n)
}

/** Reverse the contract's nested upward rounding, preserving the exact maximum. */
export function maximumPortfolioCommitment(snapshot: Pick<PortfolioCapitalSnapshot, 'ownerConservativePrice' | 'securityMultiplierBps' | 'ownerPrincipalAttoRep'>, health: bigint | undefined, proofPrice?: bigint) {
	const price = proofPrice !== undefined && proofPrice > snapshot.ownerConservativePrice ? proofPrice : snapshot.ownerConservativePrice
	if (health === undefined || health < 10_000n || health >= 1n << 256n || price <= 0n || snapshot.securityMultiplierBps <= 0n) return undefined
	const backing = (snapshot.ownerPrincipalAttoRep * 10_000n) / health
	const value = (backing * 10_000n) / snapshot.securityMultiplierBps
	const capacity = (value * 10n ** 18n) / price
	return capacity < 1n << 256n ? capacity : (1n << 256n) - 1n
}

export function capitalHealthReason(snapshot: PortfolioCapitalSnapshot, health: bigint | undefined, additionalRep = 0n) {
	if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return 'This universe is closed to health changes.'
	if (health === undefined || health < 10_000n) return 'Choose a health target of at least 100%.'
	if (health >= 1n << 256n) return 'This health target is too large.'
	const saved = snapshot.ownerAccount.targetHealthFactorBps || 10_000n
	if (health <= saved || snapshot.ownerCommitmentAttoEth === 0n) return undefined
	if (!snapshot.priceValid) return 'Refresh the shared REP price before raising your target.'
	const pledged = snapshot.positions.find(position => position.commitment > 0n)?.rep ?? 0n
	if (pledged + additionalRep < requiredPortfolioCollateral(snapshot, snapshot.ownerCommitmentAttoEth, undefined, health)) return 'Add REP or complete a commitment reduction before raising your target.'
	return undefined
}

export function capitalCancelRetirementReason(snapshot: PortfolioCapitalSnapshot, id: bigint) {
	if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return 'This universe is closed to new commitments.'
	const position = snapshot.positions.find(item => item.id === id && item.commitment > 0n)
	if (position === undefined) return 'Position is no longer live.'
	if (position.batch === 0n) return 'Position is active.'
	if (!snapshot.priceValid) return 'Refresh the shared REP price before cancelling retirement.'
	if (position.rep < requiredPortfolioCollateral(snapshot, position.commitment)) return 'Restore your saved health target before cancelling retirement.'
	return undefined
}

export function capitalRetirementReason(snapshot: PortfolioCapitalSnapshot, id: bigint, remaining: bigint | undefined) {
	if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return 'This universe is closed to retirement requests.'
	const position = snapshot.positions.find(item => item.id === id && item.commitment > 0n)
	if (position === undefined) return 'Position is no longer live.'
	if (position.batch !== 0n) return 'Retirement already requested.'
	if (remaining === undefined || remaining < 0n) return 'Enter the commitment to keep, or zero for full retirement.'
	if (remaining >= position.commitment) return 'Choose a smaller remaining commitment.'
	if (remaining !== 0n && (remaining < snapshot.economics.minimumCommitmentAttoEth || position.commitment - remaining < snapshot.economics.minimumCommitmentAttoEth)) return 'The remaining commitment and reduction must each meet the pool minimum.'
	return undefined
}

export function requiredPortfolioExecutionReserve(snapshot: Pick<PortfolioCapitalSnapshot, 'economics'>, commitment: bigint) {
	return ceilDivide(commitment, snapshot.economics.minimumCommitmentAttoEth) * snapshot.economics.minimumExecutionReserveAttoEth
}

export function capitalAuthorizationReason(snapshot: PortfolioCapitalSnapshot, commitment: bigint | undefined, proofPrice?: bigint) {
	if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return 'This universe is closed to new commitments.'
	if (!snapshot.priceValid) return 'Refresh the shared REP price first.'
	if (commitment === undefined || commitment === 0n) return 'Enter a positive commitment amount.'
	if (commitment < snapshot.economics.minimumCommitmentAttoEth) return 'Commitment is below this pool’s minimum.'
	const active = snapshot.positions.find(position => position.commitment > 0n)
	if (active !== undefined && active.batch !== 0n) return 'Cancel retirement before changing your commitment.'
	if (active !== undefined && commitment < active.commitment) return 'Request retirement before reducing an existing commitment.'
	const totalCommitment = snapshot.totalCommitmentAttoEth - snapshot.ownerCommitmentAttoEth + commitment
	if (proofPrice === undefined && (totalCommitment > snapshot.oracleExposureLimitAttoEth || snapshot.demandAttoEth > snapshot.oracleExposureLimitAttoEth)) return 'Request a price report funded for this larger commitment.'
	if (snapshot.ownerPrincipalAttoRep < requiredPortfolioCollateral(snapshot, commitment, proofPrice)) return 'Collateral is below your saved health target.'
	if (snapshot.ownerAccount.executionReserveAttoEth + (active?.executionReserveAttoEth ?? 0n) < requiredPortfolioExecutionReserve(snapshot, commitment)) return 'Fund the execution reserve first.'
	return undefined
}

export function capitalPositionPhase(batch: bigint, currentBatch: bigint) {
	if (batch === 0n) return 'active'
	return batch === currentBatch ? 'current' : 'next'
}

export function capitalWithdrawalReason(snapshot: PortfolioCapitalSnapshot, amount: bigint | undefined) {
	if (amount === undefined || amount === 0n) return 'Enter a positive amount.'
	if (amount <= snapshot.withdrawableAttoRep) return undefined
	if (snapshot.ownerCommitmentAttoEth > 0n) {
		if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return 'Committed principal cannot be withdrawn during fork preparation.'
		if (!snapshot.priceValid) return 'Refresh the shared REP price before withdrawing committed principal.'
	}
	return 'Amount exceeds your withdrawable REP. Retire commitment to release more principal.'
}

export function capitalExecutionWithdrawalReason(snapshot: PortfolioCapitalSnapshot, amount: bigint | undefined) {
	if (snapshot.exported) return 'The reserve follows your fork choice.'
	if (amount === undefined || amount === 0n) return 'Enter a positive amount.'
	if (snapshot.importing && snapshot.ownerAccount.positionId !== 0n) return 'Wait for child preparation to finish before withdrawing the reserve.'
	if (amount <= snapshot.withdrawableExecutionReserveAttoEth) return undefined
	if (snapshot.forkTime !== 0n && snapshot.timestamp < snapshot.forkChoiceDeadline) return 'Assigned reserve becomes withdrawable after the fork-choice deadline.'
	return 'Amount exceeds your withdrawable execution reserve.'
}

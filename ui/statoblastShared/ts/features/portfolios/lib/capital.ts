import type { PortfolioCapitalSnapshot } from '@zoltar/statoblast-shared/statoblast/securityPoolPortfolio'

const ceilDivide = (value: bigint, divisor: bigint) => (value + divisor - 1n) / divisor

export function requiredPortfolioCollateral(snapshot: Pick<PortfolioCapitalSnapshot, 'acceptedPrice' | 'securityMultiplierBps' | 'ownerAccount'>, commitment: bigint) {
	const health = snapshot.ownerAccount.targetHealthFactorBps || 10_000n
	const value = ceilDivide(commitment * snapshot.acceptedPrice, 10n ** 18n)
	const backing = ceilDivide(value * snapshot.securityMultiplierBps, 10_000n)
	return ceilDivide(backing * health, 10_000n)
}

export function requiredPortfolioExecutionReserve(snapshot: Pick<PortfolioCapitalSnapshot, 'economics'>, commitment: bigint) {
	return ceilDivide(commitment, snapshot.economics.minimumCommitmentAttoEth) * snapshot.economics.minimumExecutionReserveAttoEth
}

export function capitalAuthorizationReason(snapshot: PortfolioCapitalSnapshot, commitment: bigint | undefined) {
	if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing || snapshot.exported) return 'This universe is closed to new commitments.'
	if (!snapshot.priceValid) return 'Refresh the shared REP price first.'
	if (commitment === undefined || commitment === 0n) return 'Enter a positive commitment amount.'
	if (commitment < snapshot.economics.minimumCommitmentAttoEth) return 'Commitment is below this pool’s minimum.'
	const active = snapshot.positions.find(position => position.commitment > 0n)
	if (active !== undefined && active.batch !== 0n) return 'Cancel retirement before changing your commitment.'
	if (active !== undefined && commitment < active.commitment) return 'Request retirement before reducing an existing commitment.'
	if (snapshot.ownerPrincipalAttoRep < requiredPortfolioCollateral(snapshot, commitment)) return 'Collateral is below your saved health target.'
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

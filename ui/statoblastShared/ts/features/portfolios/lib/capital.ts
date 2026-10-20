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

export function capitalAuthorizationReason(snapshot: PortfolioCapitalSnapshot, rep: bigint | undefined, commitment: bigint | undefined) {
	if (snapshot.forkTime > 0n || snapshot.frozen || snapshot.importing) return 'This universe is closed to new commitments.'
	if (!snapshot.priceValid) return 'Refresh the shared REP price first.'
	if (rep === undefined || rep === 0n || commitment === undefined || commitment === 0n) return 'Enter positive collateral and commitment amounts.'
	if (commitment < snapshot.economics.minimumCommitmentAttoEth) return 'Commitment is below this pool’s minimum.'
	const active = snapshot.positions.find(position => position.batch === 0n && position.commitment > 0n)
	if (active !== undefined && commitment < active.commitment) return 'Request retirement before reducing an existing commitment.'
	if (rep > snapshot.withdrawableAttoRep + (active?.rep ?? 0n)) return 'Insufficient free REP for this commitment.'
	if (rep < requiredPortfolioCollateral(snapshot, commitment)) return 'Collateral is below your saved health target.'
	if (snapshot.ownerAccount.executionReserveAttoEth + (active?.executionReserveAttoEth ?? 0n) < requiredPortfolioExecutionReserve(snapshot, commitment)) return 'Fund the execution reserve first.'
	return undefined
}

export function capitalPositionPhase(batch: bigint, currentBatch: bigint) {
	if (batch === 0n) return 'active'
	return batch === currentBatch ? 'current' : 'next'
}

import type { Address } from '@zoltar/core-shared/evm/ethereum'

export type CoverageOfferPosition = {
	vault: Address
	enabled: boolean
	maximumObligationAttoEth: bigint
	minimumHealthFactorBps: bigint
	obligationUnits: bigint
	poolHeldAttoRep: bigint
	disputeStakeAttoRep: bigint
}

export function coverageObligation(collateral: bigint, units: bigint, totalUnits: bigint) {
	if (units < 0n || units > totalUnits) throw new Error('Invalid obligation units')
	return units === 0n ? 0n : (collateral * units + totalUnits - 1n) / totalUnits
}

export function coverageMintUnits(collateral: bigint, totalUnits: bigint, addedCollateral: bigint) {
	if (addedCollateral <= 0n) throw new Error('Mint amount must be positive')
	if (totalUnits === 0n && collateral === 0n) return addedCollateral
	if (totalUnits <= 0n || collateral <= 0n) throw new Error('Collateral epoch is exhausted')
	return (addedCollateral * totalUnits + collateral - 1n) / collateral
}

export function maximumCoveredObligation(offer: CoverageOfferPosition, price: bigint, multiplierBps: bigint) {
	if (!offer.enabled || price <= 0n || offer.minimumHealthFactorBps < 10_000n || multiplierBps < 10_000n) return 0n
	const migration = 10_000n + (multiplierBps - 10_000n) / 2n
	const migrationMultiplier = migration < 10_500n ? 10_500n : migration
	// Invert each separately rounded on-chain backing check in reverse order.
	const associated = ((((offer.poolHeldAttoRep + offer.disputeStakeAttoRep) * 10_000n) / offer.minimumHealthFactorBps) * 10_000n) / multiplierBps
	const liquid = (((offer.poolHeldAttoRep * 10_000n) / offer.minimumHealthFactorBps) * 10_000n) / migrationMultiplier
	const backingLimit = ((associated < liquid ? associated : liquid) * 10n ** 18n) / price
	return backingLimit < offer.maximumObligationAttoEth ? backingLimit : offer.maximumObligationAttoEth
}

/** Untrusted route suggestion. The contract checks live authorization, rounding and backing atomically. */
export function allocateCoverage(offers: readonly CoverageOfferPosition[], collateral: bigint, totalUnits: bigint, amount: bigint, price: bigint, multiplierBps: bigint) {
	const newUnits = coverageMintUnits(collateral, totalUnits, amount)
	const nextUnits = totalUnits + newUnits
	const nextCollateral = collateral + amount
	const candidates = offers
		.map(offer => ({
			vault: offer.vault,
			budget: (maximumCoveredObligation(offer, price, multiplierBps) * nextUnits) / nextCollateral - offer.obligationUnits,
		}))
		.filter(offer => offer.budget > 0n)
	candidates.sort((a, b) => (a.budget > b.budget ? -1 : a.budget < b.budget ? 1 : a.vault.toLowerCase().localeCompare(b.vault.toLowerCase())))
	const selected = candidates.slice(0, 64).sort((a, b) => a.vault.toLowerCase().localeCompare(b.vault.toLowerCase()))
	const allocations: { vault: Address; collateralAttoEth: bigint }[] = []
	let cumulative = 0n
	let assigned = 0n
	const seen = new Set<string>()
	for (const candidate of selected) {
		if (seen.has(candidate.vault.toLowerCase())) throw new Error('Duplicate coverage vault')
		seen.add(candidate.vault.toLowerCase())
		const upper = ((assigned + candidate.budget + 1n) * amount + newUnits - 1n) / newUnits - 1n
		const next = upper < amount ? upper : amount
		const cumulativeUnits = (newUnits * next) / amount
		if (next <= cumulative || cumulativeUnits <= assigned) continue
		allocations.push({ vault: candidate.vault, collateralAttoEth: next - cumulative })
		cumulative = next
		assigned = cumulativeUnits
		if (cumulative === amount) return allocations
	}
	throw new Error('Insufficient authorized coverage for this mint')
}

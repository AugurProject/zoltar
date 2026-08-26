import type { PoolSnapshot } from './types.ts'

const PRECISION = 10n ** 18n

const value = (input: string) => BigInt(input)

function ceilDivide(numerator: bigint, denominator: bigint) {
	return denominator === 0n ? undefined : (numerator + denominator - 1n) / denominator
}

export function sharesToProjectedEth(pool: PoolSnapshot, attoShares: bigint) {
	const supply = value(pool.shareTokenSupplyAttoShares)
	return attoShares === 0n || supply === 0n ? 0n : (attoShares * value(pool.projectedSettlementCollateralAttoEth)) / supply
}

export function projectedEthToShares(pool: PoolSnapshot, attoEth: bigint) {
	const supply = value(pool.shareTokenSupplyAttoShares)
	const collateral = value(pool.projectedSettlementCollateralAttoEth)
	if (attoEth === 0n) return 0n
	if (supply === 0n) return collateral === 0n ? attoEth * PRECISION : 0n
	return collateral === 0n ? 0n : (attoEth * supply) / collateral
}

function unassignedPositionHealthy(pool: PoolSnapshot, nextSettlementCollateral: bigint) {
	const capacity = value(pool.unassignedCapacityOwnershipAttoRep)
	if (capacity === 0n) return true
	const totalCapacity = value(pool.totalCapacityOwnershipAttoRep)
	if (totalCapacity === 0n) return false
	const grossOpenInterest = ceilDivide(nextSettlementCollateral * capacity, totalCapacity)
	if (grossOpenInterest === undefined) return false
	const badDebt = value(pool.unassignedBadDebtAttoEth)
	const openInterest = grossOpenInterest > badDebt ? grossOpenInterest - badDebt : 0n
	if (openInterest === 0n) return true
	const price = value(pool.lastRepPerEthPrice)
	const multiplier = value(pool.statoblastSecurityMultiplierBps)
	if (price === 0n || multiplier < 10_000n) return false
	const baseRequired = ceilDivide(openInterest * price, PRECISION)
	if (baseRequired === undefined) return false
	const associatedRequired = ceilDivide(baseRequired * multiplier, 10_000n)
	let freeMultiplier = 10_000n + (multiplier - 10_000n) / 2n
	if (freeMultiplier < 10_500n) freeMultiplier = 10_500n
	const freeRequired = ceilDivide(baseRequired * freeMultiplier, 10_000n)
	const backing = value(pool.unassignedRepBackingAttoRep)
	return associatedRequired !== undefined && freeRequired !== undefined && backing >= associatedRequired && backing >= freeRequired
}

export function canCreateCompleteSet(pool: PoolSnapshot, spend: bigint) {
	if (spend === 0n || projectedEthToShares(pool, spend) === 0n) return false
	const nextCollateral = value(pool.projectedSettlementCollateralAttoEth) + spend
	return nextCollateral <= value(pool.currentMintingCapacityAttoEth) && unassignedPositionHealthy(pool, nextCollateral)
}

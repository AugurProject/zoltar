import type { PoolSnapshot } from './types.ts'

const value = (input: string) => BigInt(input)

export function sharesToProjectedEth(pool: PoolSnapshot, attoShares: bigint) {
	const supply = value(pool.shareTokenSupplyAttoShares)
	return attoShares === 0n || supply === 0n ? 0n : (attoShares * value(pool.projectedSettlementCollateralAttoEth)) / supply
}

export function projectedEthToShares(pool: PoolSnapshot, attoEth: bigint) {
	const supply = value(pool.shareTokenSupplyAttoShares)
	const collateral = value(pool.projectedSettlementCollateralAttoEth)
	if (attoEth === 0n) return 0n
	if (supply === 0n) return collateral === 0n ? attoEth : 0n
	return collateral === 0n ? 0n : (attoEth * supply) / collateral
}

export function canCreateCompleteSet(pool: PoolSnapshot, spend: bigint) {
	if (spend === 0n || projectedEthToShares(pool, spend) === 0n) return false
	const nextCollateral = value(pool.projectedSettlementCollateralAttoEth) + spend
	if (pool.escalationGame !== '0x0000000000000000000000000000000000000000') return false
	return nextCollateral <= value(pool.currentMintingCapacityAttoEth) && nextCollateral <= value(pool.totalUnderwritingLimitAttoEth)
}

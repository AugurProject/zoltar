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

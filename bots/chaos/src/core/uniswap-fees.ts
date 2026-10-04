const mod256 = (value: bigint) => BigInt.asUintN(256, value)

/** Matches V3's modular fee-growth accounting, including fees not yet poked. */
export function collectableUniswapFees(liquidity: bigint, owed: bigint, lastInside: bigint, global: bigint, lowerOutside: bigint, upperOutside: bigint, tick: number, lower: number, upper: number) {
	const below = tick >= lower ? lowerOutside : mod256(global - lowerOutside)
	const above = tick < upper ? upperOutside : mod256(global - upperOutside)
	const inside = mod256(global - below - above)
	return BigInt.asUintN(128, owed + (mod256(inside - lastInside) * liquidity) / (1n << 128n))
}

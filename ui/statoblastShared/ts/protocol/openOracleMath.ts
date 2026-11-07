export const OPEN_ORACLE_PRICE_UNITS = 30

export function getOpenOracleDisputeSwapTokenKey({ currentAmount1, currentAmount2, newAmount1, newAmount2 }: { currentAmount1: bigint; currentAmount2: bigint; newAmount1: bigint; newAmount2: bigint }): 'token1' | 'token2' {
	return newAmount2 * currentAmount1 > currentAmount2 * newAmount1 ? 'token2' : 'token1'
}

import { collateralUnit } from '../src/collateral.ts'
import { exactUnit } from './format.ts'

const atomic = (value: unknown): bigint | undefined => {
	if (typeof value !== 'string' && typeof value !== 'bigint') return undefined
	return /^\d+$/.test(String(value)) ? BigInt(value) : undefined
}

/** annualFeeBps is a linear yearly percentage, with 100 basis points per percent. */
export const annualFeeText = (value: unknown): string => {
	const fee = atomic(value)
	return fee === undefined ? 'Unavailable' : exactUnit(fee, 2, '%')
}

export const poolSummaryMetrics = (state: Readonly<Record<string, unknown>>, _nativeSymbol = 'ETH'): ReadonlyArray<readonly [string, string]> => {
	const collateral = collateralUnit(state)
	const display = (key: string, decimals: number, unit: string) => {
		const value = atomic(state[key])
		return value === undefined ? 'Unavailable' : exactUnit(value, decimals, unit)
	}
	return [
		['Question settlement value', display('questionSettlementAttoEth', collateral.decimals, collateral.symbol)],
		['Average value per share', display('averageValueAttoEthPerShare', collateral.decimals, collateral.symbol)],
		['Outcome share supply', display('shareTokenSupplyAttoShares', collateral.decimals, 'shares')],
		['Security multiplier', display('securityMultiplierBps', 4, '×')],
	]
}

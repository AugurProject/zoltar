import { collateralUnit } from '../src/collateral.ts'
import { roundedOpenInterestFeePerYear } from '@zoltar/statoblast-shared/statoblast/retentionRate'
import { exactUnit } from './format.ts'

const atomic = (value: unknown): bigint | undefined => {
	if (typeof value !== 'string' && typeof value !== 'bigint') return undefined
	return /^\d+$/.test(String(value)) ? BigInt(value) : undefined
}

// Shares Statoblast's annual fee math: compound the per-second retention
// over a 365-day year, then round the complementary fee to six decimals.
export const annualFeeMillionths = (value: unknown): string | undefined => roundedOpenInterestFeePerYear(atomic(value), 6)?.toString()

export const annualFeeText = (value: unknown): string => {
	const fee = annualFeeMillionths(value)
	return fee === undefined ? 'Unavailable' : exactUnit(fee, 6, '%')
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
		['Question escalation multiplier', display('securityMultiplierBps', 4, '×')],
	]
}

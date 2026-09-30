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

export const poolSummaryMetrics = (state: Readonly<Record<string, unknown>>): ReadonlyArray<readonly [string, string]> => {
	const used = atomic(state['settlementCollateralAttoEth'])
	const capacity = atomic(state['currentMintingCapacityAttoEth'])
	const backing = atomic(state['totalPoolHeldAttoRep'])
	const ownership = atomic(state['totalUnderwritingLimitAttoEth'])
	const multiplier = atomic(state['securityMultiplierBps'])
	const display = (value: bigint | undefined, decimals: number, unit: string) => (value === undefined ? 'Unavailable' : exactUnit(value, decimals, unit))
	return [
		['Annual open-interest fee', annualFeeText(state['currentRetentionRate'])],
		['Open interest', display(used, 18, 'ETH')],
		['Minting capacity', display(capacity, 18, 'ETH')],
		['Capacity used', display(used === undefined || capacity === undefined || capacity === 0n ? undefined : (used * 10_000n) / capacity, 2, '%')],
		['Pool-held REP', display(backing, 18, 'REP')],
		['REP per committed ETH', display(backing === undefined || ownership === undefined || ownership === 0n ? undefined : (backing * 10_000n) / ownership, 4, 'REP/ETH')],
		['Security multiplier', display(multiplier, 4, '×')],
	]
}

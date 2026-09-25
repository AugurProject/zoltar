import { formatUnits } from '@zoltar/core-shared/evm/ethereum'
import { exactUnit } from './format.ts'

const atomic = (value: unknown): bigint | undefined => {
	if (typeof value !== 'string' && typeof value !== 'bigint') return undefined
	return /^\d+$/.test(String(value)) ? BigInt(value) : undefined
}

// Matches Statoblast's retentionRate.ts: compound the per-second retention
// over a 365-day year, then display the complementary fee to six decimals.
export const annualFeeMillionths = (value: unknown): string | undefined => {
	const retention = atomic(value)
	if (retention === undefined) return undefined
	const rate = Number.parseFloat(formatUnits(retention, 18))
	const fee = Math.max(0, Math.min(100, (1 - Math.pow(rate, 31_536_000)) * 100))
	return Math.round(fee * 1e6).toString()
}

export const annualFeeText = (value: unknown): string => {
	const fee = annualFeeMillionths(value)
	return fee === undefined ? 'Unavailable' : exactUnit(fee, 6, '%')
}

export const poolSummaryMetrics = (state: Readonly<Record<string, unknown>>): ReadonlyArray<readonly [string, string]> => {
	const used = atomic(state['settlementCollateralAttoEth'])
	const capacity = atomic(state['currentMintingCapacityAttoEth'])
	const backing = atomic(state['totalPoolHeldAttoRep'])
	const ownership = atomic(state['totalCapacityOwnershipAttoRep'])
	const multiplier = atomic(state['securityMultiplierBps'])
	const display = (value: bigint | undefined, decimals: number, unit: string) => (value === undefined ? 'Unavailable' : exactUnit(value, decimals, unit))
	return [
		['Annual open-interest fee', annualFeeText(state['currentRetentionRate'])],
		['Open interest', display(used, 18, 'ETH')],
		['Obligation units', display(atomic(state['totalObligationUnits']), 0, '')],
		['Written-off units', display(atomic(state['writtenOffObligationUnits']), 0, '')],
		['Unassigned units', display(atomic(state['unassignedObligationUnits']), 0, '')],
		['Minting capacity', display(capacity, 18, 'ETH')],
		['Capacity used', display(used === undefined || capacity === undefined || capacity === 0n ? undefined : (used * 10_000n) / capacity, 2, '%')],
		['Pool-held REP', display(backing, 18, 'REP')],
		['REP per capacity', display(backing === undefined || ownership === undefined || ownership === 0n ? undefined : (backing * 10_000n) / ownership, 4, '×')],
		['Security multiplier', display(multiplier, 4, '×')],
	]
}

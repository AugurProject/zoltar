import type { ListedSecurityPool } from '../../../types/contracts.js'
import { roundedOpenInterestFeePerYear, linearOpenInterestFeePerYearBigint, openInterestFeePerYearBigint, previewLinearFeeCheckpoint } from '@zoltar/statoblast-shared/statoblast/retentionRate'
import { formatScaledPercentage } from '@zoltar/ui-core-shared/lib/formatters.js'

const DISPLAY_PERCENT_FRACTION_DIGITS = 6

export function formatOpenInterestFeePerYearPercent(retentionRate: bigint | undefined) {
	const feePercent = roundedOpenInterestFeePerYear(retentionRate, DISPLAY_PERCENT_FRACTION_DIGITS)
	if (feePercent === undefined) return '—'
	return formatScaledPercentage(feePercent, DISPLAY_PERCENT_FRACTION_DIGITS)
}

export function getPoolAnnualFeePercent(pool: Pick<ListedSecurityPool, 'currentRetentionRate' | 'feeAccrualState' | 'settlementCollateralAttoEth'>, currentTimestamp: bigint | undefined) {
	const state = pool.feeAccrualState
	if (state?.linearFee === undefined) return openInterestFeePerYearBigint(pool.currentRetentionRate)
	if (currentTimestamp === undefined) return undefined
	if (currentTimestamp >= state.feeEndTimestamp || currentTimestamp >= state.linearFee.endTime) return 0n
	// The central snapshot already applies its paused clock. Its checkpoint is logical,
	// while the stream deadline is on the native calendar. Never extrapolate between them.
	if (state.centralSettlement) return linearOpenInterestFeePerYearBigint(state.linearFee.rateAttoEthPerSecond, pool.settlementCollateralAttoEth)
	const projected = previewLinearFeeCheckpoint({ linearFee: state.linearFee, currentTimestamp, feeEndTimestamp: state.feeEndTimestamp, lastUpdatedFeeAccumulator: state.lastUpdatedFeeAccumulator, settlementCollateralAttoEth: pool.settlementCollateralAttoEth })
	return projected === undefined ? undefined : linearOpenInterestFeePerYearBigint(state.linearFee.rateAttoEthPerSecond, projected.settlementCollateralAfterFeesAttoEth)
}

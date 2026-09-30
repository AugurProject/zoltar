import { roundedOpenInterestFeePerYear } from '@zoltar/statoblast-shared/statoblast/retentionRate'
import { formatScaledPercentage } from '@zoltar/ui-core-shared/lib/formatters.js'

const DISPLAY_PERCENT_FRACTION_DIGITS = 6

export function formatOpenInterestFeePerYearPercent(retentionRate: bigint | undefined) {
	const feePercent = roundedOpenInterestFeePerYear(retentionRate, DISPLAY_PERCENT_FRACTION_DIGITS)
	if (feePercent === undefined) return '—'
	return formatScaledPercentage(feePercent, DISPLAY_PERCENT_FRACTION_DIGITS)
}

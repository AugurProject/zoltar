import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'

/** Rounds half-up to the displayed precision instead of truncating, so exact amounts do not render one digit short. */
export function formatRoundedUnits(value: bigint, decimals = 18, maximumFractionDigits = 4) {
	if (maximumFractionDigits >= decimals) return formatTrimmedUnits(value, decimals, maximumFractionDigits)
	const step = 10n ** BigInt(decimals - maximumFractionDigits)
	const magnitude = value < 0n ? -value : value
	const rounded = ((magnitude + step / 2n) / step) * step
	return formatTrimmedUnits(value < 0n ? -rounded : rounded, decimals, maximumFractionDigits)
}

/** Formats two ETH amounts as `first / second ETH`, e.g. minted against maximum capacity or total against fee-eligible limits. */
export function formatEthAmountPair(firstAttoEth: bigint, secondAttoEth: bigint) {
	return `${formatTrimmedUnits(firstAttoEth)} / ${formatTrimmedUnits(secondAttoEth)} ETH`
}

import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'

/**
 * Rounds half-up to the displayed precision instead of truncating, so exact amounts do not render one digit short.
 * Every Trading display amount uses this; only limits a user types against (wallet balances, maximum inputs, and
 * minimum-received guarantees) truncate with `formatTrimmedUnits` so the displayed amount is always accepted.
 */
export function formatRoundedUnits(value: bigint, decimals = 18, maximumFractionDigits = 4) {
	if (maximumFractionDigits >= decimals) return formatTrimmedUnits(value, decimals, maximumFractionDigits)
	const step = 10n ** BigInt(decimals - maximumFractionDigits)
	const magnitude = value < 0n ? -value : value
	const rounded = ((magnitude + step / 2n) / step) * step
	return formatTrimmedUnits(value < 0n ? -rounded : rounded, decimals, maximumFractionDigits)
}

/** Formats two ETH amounts as `first / second ETH`, e.g. minted against maximum capacity or total against fee-eligible limits. Both round the same way, so their order is preserved. */
export function formatEthAmountPair(firstAttoEth: bigint, secondAttoEth: bigint) {
	return `${formatRoundedUnits(firstAttoEth)} / ${formatRoundedUnits(secondAttoEth)} ETH`
}

import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'

/** Rounds half-up to the displayed precision instead of truncating, so exact amounts do not render one digit short. */
export function formatRoundedUnits(value: bigint, decimals = 18, maximumFractionDigits = 4) {
	if (maximumFractionDigits >= decimals) return formatTrimmedUnits(value, decimals, maximumFractionDigits)
	const step = 10n ** BigInt(decimals - maximumFractionDigits)
	const magnitude = value < 0n ? -value : value
	const rounded = ((magnitude + step / 2n) / step) * step
	return formatTrimmedUnits(value < 0n ? -rounded : rounded, decimals, maximumFractionDigits)
}

export function formatCapacityOwnership(totalAttoRep: bigint, feeEligibleAttoRep: bigint) {
	return `${formatTrimmedUnits(totalAttoRep)} / ${formatTrimmedUnits(feeEligibleAttoRep)} REP`
}

export function formatMintingCapacity(mintedAttoEth: bigint, maximumAttoEth: bigint) {
	return `${formatTrimmedUnits(mintedAttoEth)} / ${formatTrimmedUnits(maximumAttoEth)} ETH`
}

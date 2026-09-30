import { formatScaledPercentage } from '@zoltar/ui-core-shared/lib/formatters.js'

const PRICE_PRECISION = 1_000_000_000_000_000_000n
const PRICE_PRECISION_DECIMALS = 18
const SECONDS_PER_YEAR = 31_536_000n
const DISPLAY_PERCENT_FRACTION_DIGITS = 6

// Matches SecurityPoolUtils.calculateRetentionRate(0, 0), the on-chain
// initial retention for public origin-pool deployments.
export const ORIGIN_POOL_INITIAL_RETENTION_RATE = 999_999_996_848_000_000n

/** Fixed-point exponentiation by squaring with floor division, mirroring the contract's `rpow`. */
export function rpow(value: bigint, exponent: bigint, baseUnit: bigint) {
	let result = exponent % 2n !== 0n ? value : baseUnit
	let squaredValue = value
	for (let remainingExponent = exponent / 2n; remainingExponent !== 0n; remainingExponent /= 2n) {
		squaredValue = (squaredValue * squaredValue) / baseUnit
		if (remainingExponent % 2n !== 0n) result = (result * squaredValue) / baseUnit
	}
	return result
}

/** Annual open interest fee as a percentage with 18 decimals, compounded from the per-second retention rate. */
export function openInterestFeePerYearBigint(retentionRate: bigint | undefined): bigint | undefined {
	if (retentionRate === undefined) return undefined
	if (retentionRate <= 0n) return 100n * PRICE_PRECISION
	const annualRetention = rpow(retentionRate, SECONDS_PER_YEAR, PRICE_PRECISION)
	if (annualRetention >= PRICE_PRECISION) return 0n
	return (PRICE_PRECISION - annualRetention) * 100n
}

export function formatOpenInterestFeePerYearPercent(retentionRate: bigint | undefined) {
	const feePercent = openInterestFeePerYearBigint(retentionRate)
	if (feePercent === undefined) return '—'
	const step = 10n ** BigInt(PRICE_PRECISION_DECIMALS - DISPLAY_PERCENT_FRACTION_DIGITS)
	return formatScaledPercentage((feePercent + step / 2n) / step, DISPLAY_PERCENT_FRACTION_DIGITS)
}

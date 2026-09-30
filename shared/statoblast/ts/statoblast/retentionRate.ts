const RETENTION_RATE_PRECISION = 10n ** 18n
const SECONDS_PER_YEAR = 31_536_000n

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
	if (retentionRate <= 0n) return 100n * RETENTION_RATE_PRECISION
	const annualRetention = rpow(retentionRate, SECONDS_PER_YEAR, RETENTION_RATE_PRECISION)
	if (annualRetention >= RETENTION_RATE_PRECISION) return 0n
	return (RETENTION_RATE_PRECISION - annualRetention) * 100n
}

/** Annual open interest fee percentage rounded half up to `fractionDigits` decimals, as a scaled integer. */
export function roundedOpenInterestFeePerYear(retentionRate: bigint | undefined, fractionDigits: number): bigint | undefined {
	const feePercent = openInterestFeePerYearBigint(retentionRate)
	if (feePercent === undefined) return undefined
	const step = 10n ** BigInt(18 - fractionDigits)
	return (feePercent + step / 2n) / step
}

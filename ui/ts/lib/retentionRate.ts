const PRICE_PRECISION = 1_000_000_000_000_000_000n
const SECONDS_PER_YEAR = 31_536_000n

// Matches SecurityPoolUtils.calculateRetentionRate(0, 0), the on-chain
// initial retention for public origin-pool deployments.
export const ORIGIN_POOL_INITIAL_RETENTION_RATE = 999_999_996_848_000_000n

function formatPercent(value: number) {
	return `${value.toLocaleString(undefined, { maximumFractionDigits: 6 })}%`
}

export function formatOpenInterestFeePerYearPercent(retentionRate: bigint | undefined) {
	if (retentionRate === undefined) return '—'
	if (retentionRate <= 0n) return '100%'

	const retentionRateAsNumber = Number(retentionRate) / Number(PRICE_PRECISION)
	if (!Number.isFinite(retentionRateAsNumber) || retentionRateAsNumber <= 0) return '100%'

	const annualRetention = Math.pow(retentionRateAsNumber, Number(SECONDS_PER_YEAR))
	const annualFeePercent = Math.max(0, Math.min(100, (1 - annualRetention) * 100))
	return formatPercent(annualFeePercent)
}

export function openInterestFeePerYearBigint(retentionRate: bigint | undefined): bigint | undefined {
	if (retentionRate === undefined) return undefined
	if (retentionRate <= 0n) return 100n * PRICE_PRECISION

	const retentionRateAsNumber = Number(retentionRate) / Number(PRICE_PRECISION)
	if (!Number.isFinite(retentionRateAsNumber) || retentionRateAsNumber <= 0) return 100n * PRICE_PRECISION

	const annualRetention = Math.pow(retentionRateAsNumber, Number(SECONDS_PER_YEAR))
	const annualFeePercent = Math.max(0, Math.min(100, (1 - annualRetention) * 100))
	return BigInt(Math.round(annualFeePercent * Number(PRICE_PRECISION)))
}

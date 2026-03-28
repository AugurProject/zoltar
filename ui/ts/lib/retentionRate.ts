const PRICE_PRECISION = 1_000_000_000_000_000_000n
const SECONDS_PER_YEAR = 31_536_000n

function formatPercent(value: number) {
	return `${ value.toLocaleString(undefined, { maximumFractionDigits: 6 }) }%`
}

export function formatOpenInterestFeePerYearPercent(retentionRate: bigint | undefined) {
	if (retentionRate === undefined) return 'Unavailable'
	if (retentionRate <= 0n) return '100%'

	const retentionRateAsNumber = Number(retentionRate) / Number(PRICE_PRECISION)
	if (!Number.isFinite(retentionRateAsNumber) || retentionRateAsNumber <= 0) return '100%'

	const annualRetention = Math.pow(retentionRateAsNumber, Number(SECONDS_PER_YEAR))
	const annualFeePercent = Math.max(0, Math.min(100, (1 - annualRetention) * 100))
	return formatPercent(annualFeePercent)
}

export function parseOpenInterestFeePerYearPercentInput(value: string, label: string) {
	const trimmed = value.trim()
	if (trimmed === '') throw new Error(`${ label } is required`)

	const normalized = trimmed.endsWith('%') ? trimmed.slice(0, -1).trim() : trimmed
	const annualFeePercent = Number(normalized)
	if (!Number.isFinite(annualFeePercent) || annualFeePercent < 0 || annualFeePercent > 100) {
		throw new Error(`${ label } must be between 0 and 100`)
	}

	const annualRetention = 1 - annualFeePercent / 100
	if (annualRetention <= 0) return 0n

	const perSecondRetention = Math.pow(annualRetention, 1 / Number(SECONDS_PER_YEAR))
	return BigInt(Math.round(perSecondRetention * Number(PRICE_PRECISION)))
}

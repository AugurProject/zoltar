import { formatRoundedCurrencyBalance } from './formatters.js'

const VISUAL_RATIO_SCALE = 1_000_000n

export function clampVisualRatio(value: number | undefined) {
	if (value === undefined || Number.isNaN(value) || !Number.isFinite(value)) return 0
	if (value < 0) return 0
	if (value > 1) return 1
	return value
}

export function getVisualRatio({ value, maxValue }: { value: bigint | undefined; maxValue: bigint | undefined }) {
	if (value === undefined || maxValue === undefined || maxValue <= 0n) return undefined
	if (value <= 0n) return 0
	if (value >= maxValue) return 1

	const scaledRatio = (value * VISUAL_RATIO_SCALE) / maxValue
	return Number(scaledRatio) / Number(VISUAL_RATIO_SCALE)
}

function formatCollateralizationPercentLabel(value: bigint | undefined, decimals: number = 0) {
	if (value === undefined) return 'Unavailable'
	return `${formatRoundedCurrencyBalance(value, 18, decimals)}%`
}

export function formatCollateralizationCompactPercentLabel(value: bigint | undefined, decimals: number = 0, unavailable = '—') {
	if (value === undefined) return unavailable
	return formatCollateralizationPercentLabel(value, decimals)
}

export function getToneRatioThreshold({ ratio, warningThreshold = 0.4, successThreshold = 0.75 }: { ratio: number | undefined; warningThreshold?: number; successThreshold?: number }) {
	if (ratio === undefined) return 'muted'
	if (ratio >= successThreshold) return 'success'
	if (ratio >= warningThreshold) return 'warning'
	return 'danger'
}

export function getCollateralizationVisualPercent({ collateralizationPercent, targetCollateralizationPercent }: { collateralizationPercent: bigint | undefined; targetCollateralizationPercent: bigint | undefined }) {
	const ratio = getVisualRatio({ value: collateralizationPercent, maxValue: targetCollateralizationPercent })
	return ratio === undefined ? undefined : clampVisualRatio(ratio) * 100
}

export function takeTopRankedItems<TItem extends { value?: bigint }>({ items, limit }: { items: readonly TItem[]; limit: number }) {
	return [...items]
		.sort((left, right) => {
			const leftValue = left.value ?? 0n
			const rightValue = right.value ?? 0n
			if (leftValue === rightValue) return 0
			return leftValue > rightValue ? -1 : 1
		})
		.slice(0, limit)
}

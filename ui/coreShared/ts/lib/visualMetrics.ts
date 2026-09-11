import { bigintToSafeNumber } from '@zoltar/core-shared/evm/ethereum'

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
	return bigintToSafeNumber(scaledRatio, 'Visual ratio') / 1_000_000
}

export function getToneRatioThreshold({ ratio, warningThreshold = 0.4, successThreshold = 0.75 }: { ratio: number | undefined; warningThreshold?: number; successThreshold?: number }) {
	if (ratio === undefined) return 'muted'
	if (ratio >= successThreshold) return 'success'
	if (ratio >= warningThreshold) return 'warning'
	return 'danger'
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

import type { CollateralizationCircleProps } from '../types/components.js'
import { formatCollateralizationCompactPercentLabel, getCollateralizationVisualPercent, getToneRatioThreshold } from '../lib/visualMetrics.js'

export function CollateralizationCircle({ collateralizationPercent, className = '', label = 'Collateralization', size = 'medium', successThreshold = 1, targetCollateralizationPercent, tone, warningThreshold = 0.65 }: CollateralizationCircleProps) {
	const toneRatio = collateralizationPercent === undefined || targetCollateralizationPercent === undefined || targetCollateralizationPercent <= 0n ? undefined : Number(collateralizationPercent) / Number(targetCollateralizationPercent)
	const resolvedTone =
		tone ??
		getToneRatioThreshold({
			ratio: toneRatio,
			successThreshold,
			warningThreshold,
		})
	const collateralizationVisualPercent = getCollateralizationVisualPercent({
		collateralizationPercent,
		targetCollateralizationPercent,
	})
	const displayValue = formatCollateralizationCompactPercentLabel(collateralizationPercent)
	const collateralizationCircleRadius = 46 * 0.8
	const circumference = 2 * Math.PI * collateralizationCircleRadius
	const clampedCollateralizationVisualPercent = collateralizationVisualPercent === undefined ? 0 : Math.max(0, Math.min(100, collateralizationVisualPercent))
	const strokeDashoffset = circumference - circumference * (clampedCollateralizationVisualPercent / 100)

	return (
		<div className={['collateralization-gauge', `collateralization-gauge-size-${size}`, resolvedTone === undefined ? '' : `tone-${resolvedTone}`, className].filter(Boolean).join(' ').trim()}>
			<span className='collateralization-gauge-ring'>
				<svg className='collateralization-gauge-svg' viewBox='0 0 100 100' aria-hidden='true'>
					<circle className='collateralization-gauge-track' cx='50' cy='50' r={collateralizationCircleRadius} />
					<circle className='collateralization-gauge-progress' cx='50' cy='50' r={collateralizationCircleRadius} strokeDasharray={`${circumference}`} strokeDashoffset={`${strokeDashoffset}`} />
				</svg>
			</span>
			<strong className='collateralization-gauge-value'>{displayValue}</strong>
			<span className='collateralization-gauge-label'>{label}</span>
		</div>
	)
}

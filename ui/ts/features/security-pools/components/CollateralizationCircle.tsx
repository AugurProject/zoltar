import * as pricingCopy from '../../../copy/pricing.js'
import type { CollateralizationCircleProps } from '../../types.js'
import { formatCollateralizationCompactPercentLabel, getCollateralizationVisualPercent, getToneRatioThreshold, getVisualRatio } from '../../../lib/visualMetrics.js'

const MAX_RING_COLLATERALIZATION_PERCENT = 999n * 10n ** 18n

function getOverflowStatus(collateralizationPercent: bigint | undefined, targetCollateralizationPercent: bigint | undefined) {
	if (collateralizationPercent === undefined || targetCollateralizationPercent === undefined) return pricingCopy.aboveDisplayRange
	if (collateralizationPercent > targetCollateralizationPercent) return pricingCopy.aboveTarget
	if (collateralizationPercent < targetCollateralizationPercent) return pricingCopy.belowTarget
	return pricingCopy.atTarget
}

export function CollateralizationCircle({ collateralizationPercent, className = '', label = pricingCopy.collateralizationLabel, size = 'medium', successThreshold = 1, targetCollateralizationPercent, tone, warningThreshold = 0.65 }: CollateralizationCircleProps) {
	const toneRatio = getVisualRatio({ value: collateralizationPercent, maxValue: targetCollateralizationPercent })
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
	const displayValueFitsInRing = collateralizationPercent === undefined || collateralizationPercent <= MAX_RING_COLLATERALIZATION_PERCENT
	const ringDisplayValue = displayValueFitsInRing ? displayValue : pricingCopy.aboveRingRange
	const targetDisplayValue = formatCollateralizationCompactPercentLabel(targetCollateralizationPercent)
	const exactValueTitle = collateralizationPercent === undefined ? pricingCopy.formatValueUnavailable(label) : pricingCopy.formatCollateralizationWithTarget(label, displayValue, targetDisplayValue)
	const overflowStatus = getOverflowStatus(collateralizationPercent, targetCollateralizationPercent)

	return (
		<div className={['collateralization-gauge', `collateralization-gauge-size-${size}`, resolvedTone === undefined ? '' : `tone-${resolvedTone}`, className].filter(Boolean).join(' ').trim()} title={exactValueTitle}>
			<span className='collateralization-gauge-ring'>
				<svg className='collateralization-gauge-svg' viewBox='0 0 100 100' aria-hidden='true'>
					<circle className='collateralization-gauge-track' cx='50' cy='50' r={collateralizationCircleRadius} />
					<circle className='collateralization-gauge-progress' cx='50' cy='50' r={collateralizationCircleRadius} strokeDasharray={`${circumference}`} strokeDashoffset={`${strokeDashoffset}`} />
				</svg>
			</span>
			<strong className='collateralization-gauge-value'>{ringDisplayValue}</strong>
			<span className='collateralization-gauge-copy'>
				<span className='collateralization-gauge-label'>{label}</span>
				{displayValueFitsInRing ? undefined : (
					<>
						<strong className='collateralization-gauge-status'>{overflowStatus}</strong>
						<span className='collateralization-gauge-exact'>{displayValue}</span>
					</>
				)}
				<span className='collateralization-gauge-target'>{pricingCopy.formatTargetValue(targetDisplayValue)}</span>
			</span>
		</div>
	)
}

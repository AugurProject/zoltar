import type { ProgressMeterProps } from '../types/components.js'
import { clampVisualRatio, getVisualRatio } from '../lib/visualMetrics.js'

export function ProgressMeter({ className = '', detail, label, maxValue, secondaryValue, tone = 'default', value, valueText }: ProgressMeterProps) {
	const ratio = clampVisualRatio(getVisualRatio({ value, maxValue }))

	return (
		<div className={['progress-meter', `tone-${tone}`, className].filter(Boolean).join(' ')}>
			<div className='progress-meter-header'>
				<span className='progress-meter-label'>{label}</span>
				<strong className='progress-meter-value'>{valueText}</strong>
			</div>
			<div className='progress-meter-track' aria-hidden='true'>
				<div className='progress-meter-fill' style={{ width: `${(ratio * 100).toFixed(2)}%` }} />
			</div>
			{secondaryValue === undefined && detail === undefined ? undefined : (
				<div className='progress-meter-footer'>
					{secondaryValue === undefined ? undefined : <span className='progress-meter-secondary'>{secondaryValue}</span>}
					{detail === undefined ? undefined : <span className='progress-meter-detail'>{detail}</span>}
				</div>
			)}
		</div>
	)
}

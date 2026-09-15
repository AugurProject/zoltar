import type { ComponentChildren } from 'preact'
import { LoadingAwareText } from './LoadingText.js'

type MetricFieldProps = {
	children: ComponentChildren
	className?: string | undefined
	label: ComponentChildren
	loading?: boolean | undefined
	valueClassName?: string | undefined
	valueTagName?: 'span' | 'strong' | undefined
}

export function MetricField({ children, className = '', label, loading = false, valueClassName = '', valueTagName = 'strong' }: MetricFieldProps) {
	const ValueTag = valueTagName
	const resolvedValueClassName = ['metric-field-value', valueClassName].filter(value => value !== '').join(' ')

	return (
		<div className={className === '' ? undefined : className}>
			<span className='metric-label'>{label}</span>
			<ValueTag className={resolvedValueClassName}>
				<LoadingAwareText loading={loading}>{children}</LoadingAwareText>
			</ValueTag>
		</div>
	)
}

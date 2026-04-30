import type { ComponentChildren } from 'preact'

type MetricFieldProps = {
	children: ComponentChildren
	className?: string | undefined
	label: ComponentChildren
	valueClassName?: string | undefined
	valueTagName?: 'span' | 'strong' | undefined
}

export function MetricField({ children, className = '', label, valueClassName = '', valueTagName = 'strong' }: MetricFieldProps) {
	const ValueTag = valueTagName
	const resolvedValueClassName = ['metric-field-value', valueClassName].filter(value => value !== '').join(' ')

	return (
		<div className={className === '' ? undefined : className}>
			<span className='metric-label'>{label}</span>
			<ValueTag className={resolvedValueClassName}>{children}</ValueTag>
		</div>
	)
}

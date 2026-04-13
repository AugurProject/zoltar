import type { ComponentChildren } from 'preact'

type MetricFieldProps = {
	children: ComponentChildren
	className?: string | undefined
	label: ComponentChildren
	valueClassName?: string | undefined
}

export function MetricField({ children, className = '', label, valueClassName = '' }: MetricFieldProps) {
	return (
		<div className={className === '' ? undefined : className}>
			<span className='metric-label'>{label}</span>
			<strong className={valueClassName === '' ? undefined : valueClassName}>{children}</strong>
		</div>
	)
}

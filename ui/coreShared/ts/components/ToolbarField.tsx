import type { ComponentChildren } from 'preact'

type ToolbarFieldProps = {
	children: ComponentChildren
	className?: string
	hideLabel?: boolean
	label: ComponentChildren
}

/** Compact caption-plus-value pair for the application toolbar, such as the selected universe. */
export function ToolbarField({ children, className = '', hideLabel = false, label }: ToolbarFieldProps) {
	return (
		<div className={`toolbar-field ${className}`.trim()}>
			<span className={hideLabel ? 'toolbar-field-label visually-hidden' : 'toolbar-field-label'}>{label}</span>
			<span className='toolbar-field-value'>{children}</span>
		</div>
	)
}

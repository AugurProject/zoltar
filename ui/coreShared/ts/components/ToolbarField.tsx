import type { ComponentChildren } from 'preact'

type ToolbarFieldProps = {
	children: ComponentChildren
	className?: string
	label: ComponentChildren
}

/** Compact caption-plus-value pair for the application toolbar, such as the selected universe. */
export function ToolbarField({ children, className = '', label }: ToolbarFieldProps) {
	return (
		<div className={`toolbar-field ${className}`.trim()}>
			<span className='toolbar-field-label'>{label}</span>
			<span className='toolbar-field-value'>{children}</span>
		</div>
	)
}

import type { ComponentChildren } from 'preact'

type ReadOnlyDetailAccordionProps = {
	children: ComponentChildren
	defaultOpen?: boolean
	onToggle?: (open: boolean) => void
	title: string
}

export function ReadOnlyDetailAccordion({ children, defaultOpen = false, onToggle, title }: ReadOnlyDetailAccordionProps) {
	return (
		<details className='read-only-detail-accordion' open={defaultOpen} onToggle={event => onToggle?.(event.currentTarget.open)}>
			<summary>{title}</summary>
			<div className='read-only-detail-accordion-content'>{children}</div>
		</details>
	)
}

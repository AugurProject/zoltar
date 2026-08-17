import type { ComponentChildren } from 'preact'

type ReadOnlyDetailAccordionProps = {
	children: ComponentChildren
	defaultOpen?: boolean
	title: string
}

export function ReadOnlyDetailAccordion({ children, defaultOpen = false, title }: ReadOnlyDetailAccordionProps) {
	return (
		<details className='read-only-detail-accordion' open={defaultOpen}>
			<summary>{title}</summary>
			<div className='read-only-detail-accordion-content'>{children}</div>
		</details>
	)
}

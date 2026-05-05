import type { ComponentChildren } from 'preact'
import { SectionBlock } from './SectionBlock.js'

type WorkflowSubsectionProps = {
	badge?: ComponentChildren
	children: ComponentChildren
	className?: string
	title?: ComponentChildren
}

export function WorkflowSubsection({ badge, children, className = '', title }: WorkflowSubsectionProps) {
	return (
		<SectionBlock badge={badge} className={`workflow-subsection ${className}`.trim()} headingLevel={4} title={title} variant='embedded'>
			{children}
		</SectionBlock>
	)
}

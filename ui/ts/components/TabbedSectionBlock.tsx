import { SectionBlock } from './SectionBlock.js'
import type { TabbedSectionBlockProps } from '../types/components.js'

export function TabbedSectionBlock({ children, className = '', description, density = 'compact', tabs, title }: TabbedSectionBlockProps) {
	return (
		<SectionBlock actions={tabs} className={className} density={density} description={description} title={title}>
			{children}
		</SectionBlock>
	)
}

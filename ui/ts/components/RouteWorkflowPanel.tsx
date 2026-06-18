import type { RouteWorkflowPanelProps } from '../types/components.js'
import { SectionBlock } from './SectionBlock.js'

export function RouteWorkflowPanel({ children, className = '', description, showHeader = true, title }: RouteWorkflowPanelProps) {
	return (
		<SectionBlock className={['panel', 'market-panel', className].filter(Boolean).join(' ')} description={showHeader ? description : undefined} headingLevel={2} title={showHeader ? title : undefined}>
			<div className='workflow-stack route-workflow-stack'>{children}</div>
		</SectionBlock>
	)
}

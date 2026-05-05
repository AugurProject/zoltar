import type { ComponentChildren } from 'preact'
import { DataGrid } from './DataGrid.js'
import { SectionBlock } from './SectionBlock.js'

type LatestActionSectionRow = {
	label: string
	value: ComponentChildren
}

type LatestActionSectionProps = {
	badge?: ComponentChildren
	embedInCard?: boolean
	rows: LatestActionSectionRow[]
	title: string
}

export function LatestActionSection({ badge, embedInCard = false, rows, title }: LatestActionSectionProps) {
	const content = (
		<DataGrid className='latest-action-grid'>
			{rows.map((row, index) => (
				<div key={`${row.label}:${index.toString()}`}>
					<p className='detail'>{row.label}</p>
					<strong>{row.value}</strong>
				</div>
			))}
		</DataGrid>
	)

	return (
		<SectionBlock title={title} badge={badge} className={embedInCard ? 'embedded-latest-action' : 'latest-action-section'}>
			{content}
		</SectionBlock>
	)
}

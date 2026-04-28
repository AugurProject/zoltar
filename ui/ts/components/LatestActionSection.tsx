import type { ComponentChildren } from 'preact'
import { EntityCard } from './EntityCard.js'
import { WorkflowSubsection } from './WorkflowSubsection.js'

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
	const content = rows.map((row, index) => (
		<p key={`${row.label}:${index.toString()}`} className='detail'>
			{row.label}: {row.value}
		</p>
	))

	if (embedInCard) {
		return (
			<WorkflowSubsection title={title} badge={badge}>
				{content}
			</WorkflowSubsection>
		)
	}

	return (
		<EntityCard title={title} badge={badge}>
			{content}
		</EntityCard>
	)
}

import type { ReadinessBlocker } from '../types/components.js'

type RequirementsChecklistProps = {
	items: ReadinessBlocker[]
}

export function RequirementsChecklist({ items }: RequirementsChecklistProps) {
	const blockedItems = items.filter(item => !item.resolved)
	if (blockedItems.length === 0) return null

	return (
		<ul className='requirements-checklist'>
			{blockedItems.map(item => (
				<li key={item.key} className='blocked'>
					<strong>Blocked:</strong> {item.label}
					{item.detail === undefined ? undefined : <span> {item.detail}</span>}
				</li>
			))}
		</ul>
	)
}

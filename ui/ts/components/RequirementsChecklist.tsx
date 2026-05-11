import type { ReadinessBlocker } from '../types/components.js'

type RequirementsChecklistProps = {
	items: ReadinessBlocker[]
}

export function RequirementsChecklist({ items }: RequirementsChecklistProps) {
	return (
		<ul className='requirements-checklist'>
			{items.map(item => (
				<li key={item.key} className={item.resolved ? 'resolved' : 'blocked'}>
					<strong>{item.resolved ? 'Ready:' : 'Blocked:'}</strong> {item.label}
					{item.detail === undefined ? undefined : <span> {item.detail}</span>}
				</li>
			))}
		</ul>
	)
}

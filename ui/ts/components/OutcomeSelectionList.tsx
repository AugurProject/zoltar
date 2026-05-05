import type { OutcomeSelectionListProps } from '../types/components.js'

export function OutcomeSelectionList({ className = '', emptyMessage, items }: OutcomeSelectionListProps) {
	if (items.length === 0) {
		return emptyMessage === undefined ? undefined : <p className='detail'>{emptyMessage}</p>
	}

	return (
		<div className={['migration-outcome-list', className].filter(Boolean).join(' ')}>
			{items.map(item => (
				<button key={item.key} aria-pressed={item.selected} className={`migration-outcome-row ${item.selected ? 'active' : ''}`} disabled={item.disabled} onClick={item.onSelect} type='button'>
					<span className='migration-outcome-copy'>
						<span className='migration-outcome-label'>{item.label}</span>
						{item.details === undefined ? undefined : <span className='migration-outcome-metrics'>{item.details}</span>}
					</span>
				</button>
			))}
		</div>
	)
}

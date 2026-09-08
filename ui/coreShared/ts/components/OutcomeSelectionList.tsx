import type { OutcomeSelectionListProps } from '../types/components.js'

export function OutcomeSelectionList({ className = '', emptyMessage, items }: OutcomeSelectionListProps) {
	if (items.length === 0) return emptyMessage === undefined ? undefined : <p className='detail'>{emptyMessage}</p>

	return (
		<div className={['migration-outcome-list', className].filter(Boolean).join(' ')}>
			{items.map(item => (
				<div className={`migration-outcome-row ${item.selected ? 'active' : ''}`} key={item.key}>
					<button aria-pressed={item.selected} className='migration-outcome-select' disabled={item.disabled} onClick={item.onSelect} type='button'>
						<div className='migration-outcome-copy'>
							<span className='migration-outcome-label'>{item.label}</span>
							{item.details === undefined ? undefined : <div className='migration-outcome-metrics'>{item.details}</div>}
						</div>
					</button>
					{item.actions === undefined ? undefined : <div className='migration-outcome-actions'>{item.actions}</div>}
				</div>
			))}
		</div>
	)
}

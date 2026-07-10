import type { RankedBarListProps } from '../types/components.js'
import { clampVisualRatio, getVisualRatio, takeTopRankedItems } from '../lib/visualMetrics.js'
import { UI_STRING_NOTHING_TO_SHOW } from '../lib/uiStrings.js'

export function RankedBarList({ className = '', emptyMessage = UI_STRING_NOTHING_TO_SHOW, items }: RankedBarListProps) {
	if (items.length === 0) return <p className={['ranked-bar-list-empty', className].filter(Boolean).join(' ')}>{emptyMessage}</p>

	const rankedItems = takeTopRankedItems({ items, limit: items.length })
	const maxValue = rankedItems.reduce<bigint | undefined>((currentMax, item) => {
		if (item.value === undefined) return currentMax
		if (currentMax === undefined || item.value > currentMax) return item.value
		return currentMax
	}, undefined)

	return (
		<div className={['ranked-bar-list', className].filter(Boolean).join(' ')}>
			{rankedItems.map(item => (
				<div className={['ranked-bar-item', `tone-${item.tone ?? 'default'}`].join(' ')} key={item.key}>
					<div className='ranked-bar-item-header'>
						<span className='ranked-bar-item-label'>{item.label}</span>
						<strong className='ranked-bar-item-value'>{item.valueText}</strong>
					</div>
					<div className='ranked-bar-item-track' aria-hidden='true'>
						<div className='ranked-bar-item-fill' style={{ width: `${(clampVisualRatio(getVisualRatio({ value: item.value, maxValue })) * 100).toFixed(2)}%` }} />
					</div>
					{item.detail === undefined ? undefined : <p className='ranked-bar-item-detail'>{item.detail}</p>}
				</div>
			))}
		</div>
	)
}

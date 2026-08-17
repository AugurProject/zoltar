import type { OutcomeChipRowProps } from '../../types.js'

export function OutcomeChipRow({ className = '', items }: OutcomeChipRowProps) {
	return (
		<div className={['outcome-chip-row', className].filter(Boolean).join(' ')}>
			{items.map(item => (
				<span className={['outcome-chip', `tone-${item.tone ?? 'default'}`].join(' ')} key={item.key}>
					{item.label}
				</span>
			))}
		</div>
	)
}

import type { ViewTabsProps } from '../types/components.js'

export function ViewTabs<TValue extends string>({ ariaLabel, className = '', onChange, options, orientation = 'horizontal', size = 'default', value, variant = 'subroute' }: ViewTabsProps<TValue>) {
	return (
		<div className={`view-tabs ${variant} ${className}`.trim()} data-orientation={orientation} data-size={size} role='tablist' aria-label={ariaLabel}>
			{options.map(option => {
				const active = option.value === value
				return (
					<button
						key={option.value}
						className={`view-tab ${active ? 'active' : ''}`.trim()}
						type='button'
						role='tab'
						aria-selected={active}
						tabIndex={active ? 0 : -1}
						disabled={option.disabled}
						title={option.reason}
						onClick={() => {
							if (option.disabled) return
							onChange(option.value)
						}}
					>
						{option.label}
					</button>
				)
			})}
		</div>
	)
}

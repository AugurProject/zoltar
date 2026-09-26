import { ViewTabs } from '../../components/ViewTabs.js'
import type { ViewTabOption } from '../../types/components.js'

type RouteSubNavigationProps<TValue extends string> = {
	ariaLabel: string
	onChange: (value: TValue) => void
	options: ViewTabOption<TValue>[]
	value: TValue
}

/**
 * Views of the current section as a compact segmented control above the route content. It wraps instead of
 * scrolling sideways, so every view stays reachable on narrow screens without a second tab bar.
 */
export function RouteSubNavigation<TValue extends string>({ ariaLabel, onChange, options, value }: RouteSubNavigationProps<TValue>) {
	const unavailableOptions = options.filter(option => option.disabled === true && option.reason !== undefined)
	return (
		<div className='route-subnav-region'>
			<nav className='route-subnav-shell' aria-label={ariaLabel} role='navigation'>
				<ViewTabs ariaLabel={ariaLabel} className='route-subtab-nav' semantics='navigation' size='compact' value={value} variant='segmented' onChange={onChange} options={options} />
			</nav>
			{unavailableOptions.length === 0 ? undefined : (
				<div className='route-subnav-unavailable'>
					{unavailableOptions.map(option => (
						<p className='detail' key={option.value}>
							<strong>{option.label}:</strong> {option.reason}
						</p>
					))}
				</div>
			)}
		</div>
	)
}

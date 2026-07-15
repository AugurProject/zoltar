import { ViewTabs } from '../../components/ViewTabs.js'
import type { ViewTabOption } from '../../types/components.js'

type RouteSubNavigationProps<TValue extends string> = {
	ariaLabel: string
	onChange: (value: TValue) => void
	options: ViewTabOption<TValue>[]
	value: TValue
}

export function RouteSubNavigation<TValue extends string>({ ariaLabel, onChange, options, value }: RouteSubNavigationProps<TValue>) {
	return (
		<nav className='route-subnav-shell' aria-label={ariaLabel} role='navigation'>
			<ViewTabs ariaLabel={ariaLabel} className='route-subtab-nav' semantics='navigation' size='compact' value={value} variant='subroute' onChange={onChange} options={options} />
		</nav>
	)
}

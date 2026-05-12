import { ViewTabs } from './ViewTabs.js'
import type { ViewTabOption } from '../types/components.js'

type RouteSubNavigationProps<TValue extends string> = {
	ariaLabel: string
	onChange: (value: TValue) => void
	options: ViewTabOption<TValue>[]
	value: TValue
}

export function RouteSubNavigation<TValue extends string>({ ariaLabel, onChange, options, value }: RouteSubNavigationProps<TValue>) {
	return (
		<div className='route-subnav-shell'>
			<ViewTabs ariaLabel={ariaLabel} className='route-subtab-nav' size='compact' value={value} variant='subroute' onChange={onChange} options={options} />
		</div>
	)
}

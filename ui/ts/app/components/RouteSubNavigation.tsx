import { ViewTabs } from '../../components/ViewTabs.js'
import type { ViewTabOption } from '../../types/components.js'
import { useRef } from 'preact/hooks'
import * as appCopy from '../../copy/app.js'

type RouteSubNavigationProps<TValue extends string> = {
	ariaLabel: string
	onChange: (value: TValue) => void
	options: ViewTabOption<TValue>[]
	value: TValue
}

export function RouteSubNavigation<TValue extends string>({ ariaLabel, onChange, options, value }: RouteSubNavigationProps<TValue>) {
	const navigationRef = useRef<HTMLElement>(null)
	const scrollOptions = (direction: -1 | 1) => {
		const tabStrip = navigationRef.current?.querySelector<HTMLElement>('.route-subtab-nav')
		if (tabStrip === undefined || tabStrip === null) return
		const behavior = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
		tabStrip.scrollBy({ behavior, left: direction * Math.max(160, tabStrip.clientWidth * 0.7) })
	}
	return (
		<nav ref={navigationRef} className='route-subnav-shell' aria-label={ariaLabel} role='navigation'>
			<button className='quiet route-subnav-overflow-control route-subnav-overflow-start' type='button' aria-label={appCopy.formatShowEarlierNavigationItems(ariaLabel)} onClick={() => scrollOptions(-1)}>
				<span aria-hidden='true'>‹</span>
			</button>
			<ViewTabs ariaLabel={ariaLabel} className='route-subtab-nav' semantics='navigation' size='compact' value={value} variant='subroute' onChange={onChange} options={options} />
			<button className='quiet route-subnav-overflow-control route-subnav-overflow-end' type='button' aria-label={appCopy.formatShowLaterNavigationItems(ariaLabel)} onClick={() => scrollOptions(1)}>
				<span aria-hidden='true'>›</span>
			</button>
		</nav>
	)
}

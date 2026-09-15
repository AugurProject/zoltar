import { ViewTabs } from '../../components/ViewTabs.js'
import type { ViewTabOption } from '../../types/components.js'
import { useCallback, useRef, useState } from 'preact/hooks'
import * as appCopy from '../../copy/app.js'

type RouteSubNavigationProps<TValue extends string> = {
	ariaLabel: string
	onChange: (value: TValue) => void
	options: ViewTabOption<TValue>[]
	value: TValue
}

export function RouteSubNavigation<TValue extends string>({ ariaLabel, onChange, options, value }: RouteSubNavigationProps<TValue>) {
	const navigationRef = useRef<HTMLElement>(null)
	const [overflowEdges, setOverflowEdges] = useState({ end: false, start: false })
	const unavailableOptions = options.filter(option => option.disabled === true && option.reason !== undefined)
	const onOverflowEdgesChange = useCallback((nextOverflowEdges: { end: boolean; start: boolean }) => {
		const activeElement = document.activeElement
		const focusBoundaryTab = (edge: 'end' | 'start') => {
			const tabElements = navigationRef.current?.querySelectorAll<HTMLElement>('.route-subtab-nav .view-tab:not(:disabled)')
			const tabs = tabElements === undefined ? [] : Array.from(tabElements)
			const boundaryTab = edge === 'start' ? tabs[0] : tabs[tabs.length - 1]
			boundaryTab?.focus()
		}
		if (!nextOverflowEdges.start && activeElement?.classList.contains('route-subnav-overflow-start')) focusBoundaryTab('start')
		if (!nextOverflowEdges.end && activeElement?.classList.contains('route-subnav-overflow-end')) focusBoundaryTab('end')
		setOverflowEdges(nextOverflowEdges)
	}, [])
	const scrollOptions = (direction: -1 | 1) => {
		const tabStrip = navigationRef.current?.querySelector<HTMLElement>('.route-subtab-nav')
		if (tabStrip === undefined || tabStrip === null) return
		const behavior = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'
		tabStrip.scrollBy({ behavior, left: direction * Math.max(160, tabStrip.clientWidth * 0.7) })
	}
	return (
		<div className='route-subnav-region'>
			<nav ref={navigationRef} className={`route-subnav-shell ${overflowEdges.start ? 'has-overflow-start' : ''} ${overflowEdges.end ? 'has-overflow-end' : ''}`.trim()} aria-label={ariaLabel} role='navigation'>
				{overflowEdges.start ? (
					<button className='quiet route-subnav-overflow-control route-subnav-overflow-start' type='button' aria-label={appCopy.formatShowEarlierNavigationItems(ariaLabel)} onClick={() => scrollOptions(-1)}>
						<span aria-hidden='true'>‹</span>
					</button>
				) : undefined}
				<ViewTabs ariaLabel={ariaLabel} className='route-subtab-nav' semantics='navigation' size='compact' value={value} variant='subroute' onChange={onChange} onOverflowEdgesChange={onOverflowEdgesChange} options={options} />
				{overflowEdges.end ? (
					<button className='quiet route-subnav-overflow-control route-subnav-overflow-end' type='button' aria-label={appCopy.formatShowLaterNavigationItems(ariaLabel)} onClick={() => scrollOptions(1)}>
						<span aria-hidden='true'>›</span>
					</button>
				) : undefined}
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

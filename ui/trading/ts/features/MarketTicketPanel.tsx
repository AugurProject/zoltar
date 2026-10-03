import type { ComponentChildren } from 'preact'
import { marketsCopy } from '../copy/markets.js'

/** Always visible: a sticky side column on desktop and an in-page section on narrow screens. */
export function MarketTicketPanel({ children }: { children: ComponentChildren }) {
	return (
		<div className='market-ticket'>
			<aside className='market-ticket__panel' aria-label={marketsCopy.ticket}>
				{children}
			</aside>
		</div>
	)
}

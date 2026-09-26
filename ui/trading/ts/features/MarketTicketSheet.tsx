import type { ComponentChildren } from 'preact'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { useModalFocusIsolation } from '@zoltar/ui-core-shared/hooks/useModalFocusIsolation.js'
import { marketsCopy } from '../copy/markets.js'
import type { TicketSide } from '../lib/ticketSide.js'

/** Below this width the ticket leaves the side column and becomes a bottom sheet. Keep in sync with app.css. */
const COMPACT_TICKET_QUERY = '(max-width: 56.25rem)'

function useMediaQuery(query: string) {
	const [matches, setMatches] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia(query).matches)
	useEffect(() => {
		if (typeof window.matchMedia !== 'function') return
		const list = window.matchMedia(query)
		const update = () => setMatches(list.matches)
		update()
		list.addEventListener('change', update)
		return () => list.removeEventListener('change', update)
	}, [query])
	return matches
}

export type TicketQuickPick = Readonly<{ yesPercent: number; noPercent: number; pick(side: TicketSide): void }>

/**
 * The market ticket. On wide screens it is a sticky side column; on narrow screens it collapses into a bottom bar
 * whose buttons expand it into a modal bottom sheet, so the reading column stays first in document order.
 */
export function MarketTicketSheet({ children, viewLabel, quickPick, openRequested, onOpenRequestHandled }: { children: ComponentChildren; viewLabel: string; quickPick: TicketQuickPick | undefined; openRequested: boolean; onOpenRequestHandled(): void }) {
	const compact = useMediaQuery(COMPACT_TICKET_QUERY)
	const [open, setOpen] = useState(false)
	const sheet = compact && open
	const dialogRef = useRef<HTMLElement>(null)
	const closeRef = useRef<HTMLButtonElement>(null)
	const barRef = useRef<HTMLDivElement>(null)
	const headingId = useId()
	useEffect(() => {
		if (!openRequested) return
		if (compact) setOpen(true)
		onOpenRequestHandled()
	}, [compact, openRequested, onOpenRequestHandled])
	useModalFocusIsolation({ dialogRef, initialFocusRef: closeRef, isOpen: sheet, onClose: () => setOpen(false), getReturnFocusTarget: () => barRef.current?.querySelector('button') ?? null })
	const openWith = (side: TicketSide | undefined) => {
		if (side !== undefined) quickPick?.pick(side)
		setOpen(true)
	}
	return (
		<>
			<div
				className={`market-ticket ${sheet ? 'modal-backdrop market-ticket--sheet' : ''}`.trim()}
				onClick={event => {
					if (sheet && event.target === event.currentTarget) setOpen(false)
				}}
			>
				<aside ref={dialogRef} className='market-ticket__panel' hidden={compact && !open} role={sheet ? 'dialog' : undefined} aria-modal={sheet ? 'true' : undefined} aria-labelledby={sheet ? headingId : undefined} aria-label={sheet ? undefined : marketsCopy.ticket}>
					{sheet ? (
						<div className='market-ticket__sheet-header'>
							<h2 id={headingId}>{marketsCopy.ticket}</h2>
							<button ref={closeRef} type='button' className='secondary' onClick={() => setOpen(false)}>
								{marketsCopy.closeTicket}
							</button>
						</div>
					) : undefined}
					{children}
				</aside>
			</div>
			{compact && !open ? (
				<div ref={barRef} className='market-ticket-bar'>
					{quickPick === undefined ? (
						<button type='button' className='primary' onClick={() => openWith(undefined)}>
							{marketsCopy.openTicket(viewLabel)}
						</button>
					) : (
						<>
							<button type='button' className='outcome-button outcome-button--yes' aria-label={marketsCopy.buyOutcomeAt(marketsCopy.yes, quickPick.yesPercent)} onClick={() => openWith('YES')}>
								{marketsCopy.buyOutcome(marketsCopy.outcomeOdds(marketsCopy.yes, quickPick.yesPercent))}
							</button>
							<button type='button' className='outcome-button outcome-button--no' aria-label={marketsCopy.buyOutcomeAt(marketsCopy.no, quickPick.noPercent)} onClick={() => openWith('NO')}>
								{marketsCopy.buyOutcome(marketsCopy.outcomeOdds(marketsCopy.no, quickPick.noPercent))}
							</button>
						</>
					)}
				</div>
			) : undefined}
		</>
	)
}

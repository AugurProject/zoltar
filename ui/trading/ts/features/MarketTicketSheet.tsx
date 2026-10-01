import type { ComponentChildren } from 'preact'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import { useModalFocusIsolation } from '@zoltar/ui-core-shared/hooks/useModalFocusIsolation.js'
import { marketsCopy } from '../copy/markets.js'
import type { TicketSelection, TicketSide } from '../lib/routeState.js'

/** Below this width the ticket leaves the side column and becomes a bottom sheet. Keep in sync with app.css. */
const COMPACT_TICKET_QUERY = '(max-width: 64rem)'

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

/** The market's transaction progress for the collapsed bar; `settled` marks a finished result rather than one in flight. */
export type TicketActivity = Readonly<{ text: string; settled: boolean }>

/** One-tap ticket entries for the collapsed bar: buy either outcome, and sell `sellSide` when the account holds it. */
export type TicketQuickPick = Readonly<{ yesPercent: number; noPercent: number; sellSide: TicketSide | undefined; pick(selection: TicketSelection): void }>

/**
 * The market ticket. On wide screens it is a sticky side column; on narrow screens it collapses into a bottom bar
 * whose buttons expand it into a modal bottom sheet, so the reading column stays first in document order. While the
 * market's transaction runs, `activity` replaces the bar's entries with its progress; a settled result stays there
 * until the sheet is opened on it once, then the entries return.
 */
export function MarketTicketSheet({ children, viewLabel, quickPick, activity, openRequested, onOpenRequestHandled }: { children: ComponentChildren; viewLabel: string; quickPick: TicketQuickPick | undefined; activity?: TicketActivity | undefined; openRequested: boolean; onOpenRequestHandled(): void }) {
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
	// The settled result the user has already opened the sheet on; a new transaction in flight clears it.
	const [seenResult, setSeenResult] = useState<string>()
	const pendingActivity = activity !== undefined && !activity.settled
	useEffect(() => {
		if (pendingActivity) setSeenResult(undefined)
	}, [pendingActivity])
	const openWith = (selection: TicketSelection | undefined) => {
		if (selection !== undefined) quickPick?.pick(selection)
		if (activity?.settled === true) setSeenResult(activity.text)
		setOpen(true)
	}
	const barActivity = activity === undefined || (activity.settled && seenResult === activity.text) ? undefined : activity
	let barEntries: ComponentChildren
	if (barActivity !== undefined)
		barEntries = (
			<button type='button' className='secondary market-ticket-bar__activity' onClick={() => openWith(undefined)}>
				{barActivity.text}
			</button>
		)
	else if (quickPick === undefined)
		barEntries = (
			<button type='button' className='primary' onClick={() => openWith(undefined)}>
				{marketsCopy.openTicket(viewLabel)}
			</button>
		)
	else {
		const { sellSide } = quickPick
		barEntries = (
			<>
				<button type='button' className='outcome-button outcome-button--yes' aria-label={marketsCopy.buyOutcomeAt(marketsCopy.yes, quickPick.yesPercent)} onClick={() => openWith({ mode: 'entry', side: 'YES' })}>
					{marketsCopy.buyOutcome(marketsCopy.outcomeOdds(marketsCopy.yes, quickPick.yesPercent))}
				</button>
				<button type='button' className='outcome-button outcome-button--no' aria-label={marketsCopy.buyOutcomeAt(marketsCopy.no, quickPick.noPercent)} onClick={() => openWith({ mode: 'entry', side: 'NO' })}>
					{marketsCopy.buyOutcome(marketsCopy.outcomeOdds(marketsCopy.no, quickPick.noPercent))}
				</button>
				{sellSide === undefined ? undefined : (
					<button type='button' className='secondary' onClick={() => openWith({ mode: 'exit', side: sellSide })}>
						{marketsCopy.sellOutcome(sellSide === 'YES' ? marketsCopy.yes : marketsCopy.no)}
					</button>
				)}
			</>
		)
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
					{barEntries}
					{/* Present while the bar is, so progress changes are announced even though the sheet's own status is hidden. */}
					<p className='visually-hidden' role='status'>
						{activity?.text ?? ''}
					</p>
				</div>
			) : undefined}
		</>
	)
}

import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { fireEvent } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { MarketTicketSheet } from '../../features/MarketTicketSheet.js'
import type { TicketSide } from '../../lib/ticketSide.js'

function stubViewport(compact: boolean) {
	const original = window.matchMedia
	Reflect.set(window, 'matchMedia', (query: string) => ({ matches: compact, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
	return () => Reflect.set(window, 'matchMedia', original)
}

function buttonNamed(container: ParentNode, name: string) {
	const match = Array.from(container.querySelectorAll('button')).find(candidate => (candidate.getAttribute('aria-label') ?? candidate.textContent) === name)
	if (match === undefined) throw new Error(`Missing button ${name}`)
	return match
}

function renderSheet(picks: TicketSide[], openRequested = false) {
	return renderIntoDocument(
		<main>
			<p>Reading column</p>
			<MarketTicketSheet viewLabel='Trade' quickPick={{ yesPercent: 62, noPercent: 38, pick: side => picks.push(side) }} openRequested={openRequested} onOpenRequestHandled={() => undefined}>
				<input aria-label='Amount' />
			</MarketTicketSheet>
		</main>,
	)
}

test('on narrow screens the ticket collapses to a bottom bar whose outcome buttons open a modal sheet on that side', async () => {
	const dom = installDomEnvironment()
	const restoreViewport = stubViewport(true)
	const picks: TicketSide[] = []
	const rendered = await renderSheet(picks)
	try {
		const panel = rendered.container.querySelector('.market-ticket__panel')
		expect(panel?.hasAttribute('hidden')).toBe(true)
		expect(panel?.getAttribute('role')).toBeNull()
		expect(buttonNamed(rendered.container, 'Buy YES at a conditional 62%').textContent).toBe('Buy YES 62%')
		await act(() => buttonNamed(rendered.container, 'Buy NO at a conditional 38%').click())
		expect(picks).toEqual(['NO'])
		expect(panel?.hasAttribute('hidden')).toBe(false)
		expect(panel?.getAttribute('role')).toBe('dialog')
		expect(panel?.getAttribute('aria-modal')).toBe('true')
		const headingId = panel?.getAttribute('aria-labelledby') ?? ''
		expect(document.getElementById(headingId)?.textContent).toBe('Trade ticket')
		expect(rendered.container.querySelector('.market-ticket-bar')).toBeNull()
		expect(document.activeElement?.textContent).toBe('Close ticket')
		// The reading column behind the sheet is inert while it is open.
		expect(rendered.container.querySelector('main > p')?.hasAttribute('inert')).toBe(true)
		await act(() => fireEvent.keyDown(document, { key: 'Escape' }))
		expect(panel?.hasAttribute('hidden')).toBe(true)
		expect(rendered.container.querySelector('.market-ticket-bar')).not.toBeNull()
		expect(rendered.container.querySelector('main > p')?.hasAttribute('inert')).toBe(false)
	} finally {
		await rendered.cleanup()
		restoreViewport()
		dom.cleanup()
	}
})

test('a side chosen on a market card opens the sheet on arrival', async () => {
	const dom = installDomEnvironment()
	const restoreViewport = stubViewport(true)
	const rendered = await renderSheet([], true)
	try {
		expect(rendered.container.querySelector('.market-ticket__panel')?.getAttribute('role')).toBe('dialog')
	} finally {
		await rendered.cleanup()
		restoreViewport()
		dom.cleanup()
	}
})

test('on wide screens the ticket is an always-visible labelled column without dialog semantics or a bottom bar', async () => {
	const dom = installDomEnvironment()
	const restoreViewport = stubViewport(false)
	const rendered = await renderSheet([], true)
	try {
		const panel = rendered.container.querySelector('.market-ticket__panel')
		expect(panel?.hasAttribute('hidden')).toBe(false)
		expect(panel?.getAttribute('role')).toBeNull()
		expect(panel?.getAttribute('aria-label')).toBe('Trade ticket')
		expect(rendered.container.querySelector('.market-ticket-bar')).toBeNull()
	} finally {
		await rendered.cleanup()
		restoreViewport()
		dom.cleanup()
	}
})

import { expect, test } from 'bun:test'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { MarketTicketPanel } from '../../features/MarketTicketPanel.js'

function stubViewport(compact: boolean) {
	const original = window.matchMedia
	Reflect.set(window, 'matchMedia', (query: string) => ({ matches: compact, media: query, addEventListener: () => undefined, removeEventListener: () => undefined }))
	return () => Reflect.set(window, 'matchMedia', original)
}

function renderPanel() {
	return renderIntoDocument(
		<main>
			<p>Reading column</p>
			<MarketTicketPanel>
				<input aria-label='Amount' />
				<p role='status'>Waiting for Buy Yes to confirm…</p>
			</MarketTicketPanel>
		</main>,
	)
}

test('on narrow screens the workflow stays visible in the page without a launcher or dialog', async () => {
	const dom = installDomEnvironment()
	const restoreViewport = stubViewport(true)
	const rendered = await renderPanel()
	try {
		const panel = rendered.container.querySelector('.market-ticket__panel')
		expect(panel?.hasAttribute('hidden')).toBe(false)
		expect(panel?.getAttribute('role')).toBeNull()
		expect(panel?.getAttribute('aria-modal')).toBeNull()
		expect(rendered.container.querySelector('.market-ticket-bar')).toBeNull()
		expect(rendered.container.querySelector('main > p')?.hasAttribute('inert')).toBe(false)
	} finally {
		await rendered.cleanup()
		restoreViewport()
		dom.cleanup()
	}
})

test('on wide screens the ticket is an always-visible labelled column without dialog semantics or a bottom bar', async () => {
	const dom = installDomEnvironment()
	const restoreViewport = stubViewport(false)
	const rendered = await renderPanel()
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

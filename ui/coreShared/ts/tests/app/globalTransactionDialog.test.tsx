/// <reference types='bun-types' />

import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { GlobalTransactionDialog } from '../../app/components/GlobalTransactionDialog.js'
import { installDomTestLifecycle } from '../testUtils/domTestLifecycle.js'
import { fireEvent, within } from '../testUtils/queries.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

const hash = '0x1111111111111111111111111111111111111111111111111111111111111111'

async function nextFrame() {
	await act(async () => {
		await new Promise(resolve => requestAnimationFrame(resolve))
	})
}

describe('GlobalTransactionDialog', () => {
	const { trackRendered } = installDomTestLifecycle()

	test('shows the wallet prompt as a compact status so the user knows the wallet is waiting for them', async () => {
		const rendered = await renderIntoDocument(<GlobalTransactionDialog transaction={{ detail: 'Confirm the transaction in your wallet.', dismissKey: 'transaction-request-1', title: 'Creating question', tone: 'awaiting-wallet' }} />)
		trackRendered(rendered)
		const panel = rendered.container.querySelector('.global-transaction-dialog')
		expect(panel?.classList.contains('global-transaction-dialog-compact')).toBe(true)
		expect(panel?.textContent).toContain('Awaiting wallet')
		expect(panel?.textContent).toContain('Confirm the transaction in your wallet.')
		expect(within(rendered.container).getByRole('status').textContent).toContain('Creating question')
	})

	test('keeps the browser simulation preparation quiet', async () => {
		const rendered = await renderIntoDocument(<GlobalTransactionDialog transaction={{ detail: 'Submitting in browser simulation.', dismissKey: 'transaction-request-1', title: 'Creating question', tone: 'preparing' }} />)
		trackRendered(rendered)
		expect(rendered.container.querySelector('.global-transaction-dialog')).toBeNull()
	})

	test('keeps instructions visible in the compact panel instead of inside the collapsed details', async () => {
		const detail = 'Not confirmed yet; still checking. Speed it up or cancel it in your wallet instead of sending it again.'
		const rendered = await renderIntoDocument(<GlobalTransactionDialog transaction={{ detail, hash, rows: [{ label: 'Pool', value: 'Pool A' }], title: 'Depositing REP', tone: 'pending' }} />)
		trackRendered(rendered)
		const panel = rendered.container.querySelector('.global-transaction-dialog')
		const visibleDetail = panel?.querySelector('.global-transaction-notice-detail')
		expect(visibleDetail?.textContent).toBe(detail)
		expect(visibleDetail?.closest('details')).toBeNull()
		expect(panel?.querySelector('details')?.textContent).toContain('Pool A')
	})

	test('is a labelled region with a single live region, and Escape dismisses it and returns focus', async () => {
		const initiating = document.createElement('button')
		initiating.textContent = 'Create question'
		document.body.appendChild(initiating)
		const rendered = await renderIntoDocument(<GlobalTransactionDialog transaction={{ hash, title: 'Question created', tone: 'success' }} />)
		trackRendered(rendered)
		try {
			const queries = within(rendered.container)
			expect(queries.queryByRole('dialog')).toBeNull()
			// A named section is a region landmark; only the notice inside announces changes.
			const region = rendered.container.querySelector('section.global-transaction-dialog')
			if (region === null) throw new Error('Missing transaction status')
			expect(region.getAttribute('role')).toBeNull()
			expect(document.getElementById(region.getAttribute('aria-labelledby') ?? '')?.textContent).toBe('Transaction status')
			expect(region.querySelectorAll('[aria-live]')).toHaveLength(1)

			initiating.focus()
			const dismiss = queries.getByRole('button', { name: 'Dismiss' })
			await act(() => dismiss.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true, relatedTarget: initiating })))
			dismiss.focus()
			await act(() => fireEvent.keyDown(dismiss, { key: 'Escape' }))
			expect(rendered.container.querySelector('.global-transaction-dialog')).toBeNull()
			expect(document.activeElement).toBe(initiating)
		} finally {
			initiating.remove()
		}
	})

	test('brings only the focused initiating action above the panel and never scrolls to unrelated buttons', async () => {
		const unrelated = document.createElement('button')
		unrelated.className = 'tx-action-button'
		const initiating = document.createElement('button')
		initiating.className = 'tx-action-button'
		document.body.append(unrelated, initiating)
		const scrolled: { element: string; options: unknown }[] = []
		unrelated.scrollIntoView = options => scrolled.push({ element: 'unrelated', options })
		initiating.scrollIntoView = options => scrolled.push({ element: 'initiating', options })
		const covered = () => new window.DOMRect(0, window.innerHeight - 120, 200, 40)
		unrelated.getBoundingClientRect = covered
		initiating.getBoundingClientRect = covered
		try {
			const rendered = await renderIntoDocument(<GlobalTransactionDialog transaction={{ hash, title: 'Depositing REP', tone: 'pending' }} />)
			trackRendered(rendered)
			const panel = rendered.container.querySelector<HTMLElement>('.global-transaction-dialog')
			if (panel === null) throw new Error('Missing transaction status')
			panel.getBoundingClientRect = () => new window.DOMRect(0, window.innerHeight - 200, 390, 180)
			await nextFrame()
			expect(scrolled).toEqual([])

			initiating.focus()
			await act(() => rendered.unmount())
			const again = await renderIntoDocument(<GlobalTransactionDialog transaction={{ hash, title: 'Depositing REP', tone: 'pending' }} />)
			trackRendered(again)
			const nextPanel = again.container.querySelector<HTMLElement>('.global-transaction-dialog')
			if (nextPanel === null) throw new Error('Missing transaction status')
			nextPanel.getBoundingClientRect = () => new window.DOMRect(0, window.innerHeight - 200, 390, 180)
			await nextFrame()
			expect(scrolled).toEqual([{ element: 'initiating', options: { block: 'nearest' } }])
			expect(document.documentElement.style.getPropertyValue('--transaction-status-inset')).toBe('200px')
		} finally {
			unrelated.remove()
			initiating.remove()
		}
	})
})

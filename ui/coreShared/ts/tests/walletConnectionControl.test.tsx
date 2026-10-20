/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { render } from 'preact'
import { act } from 'preact/test-utils'
import { WalletConnectionControl } from '../components/WalletConnectionControl.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { fireEvent, within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('WalletConnectionControl', () => {
	const { trackRendered } = installDomTestLifecycle()

	test('explains a disabled connect action through its accessible description', async () => {
		const rendered = await renderIntoDocument(<WalletConnectionControl disabled disabledReason='Deployment registry unavailable. Retry loading it first.' label='Connect wallet' onClick={() => undefined} />)
		trackRendered(rendered)
		const button = within(rendered.container).getByRole('button', { name: 'Connect wallet' })
		const reason = within(rendered.container).getByRole('note')
		expect(reason.textContent).toBe('Deployment registry unavailable. Retry loading it first.')
		expect(button.getAttribute('aria-describedby')).toBe(reason.id)
	})

	test('keeps keyboard focus on Connect while its wallet request is pending', async () => {
		let clicks = 0
		const control = (pending: boolean) => <WalletConnectionControl pending={pending} pendingLabel='Connecting…' label='Connect wallet' onClick={() => (clicks += 1)} />
		const rendered = await renderIntoDocument(control(false))
		trackRendered(rendered)
		const button = rendered.container.querySelector('button')
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a button')
		await act(() => button.focus())
		await act(() => render(control(true), rendered.container))
		expect(document.activeElement).toBe(button)
		expect(button.disabled).toBe(false)
		expect(button.getAttribute('aria-disabled')).toBe('true')
		expect(button.getAttribute('aria-busy')).toBe('true')
		await act(() => fireEvent.click(button))
		expect(clicks).toBe(0)
		await act(() => render(control(false), rendered.container))
		expect(button.hasAttribute('aria-disabled')).toBe(false)
		await act(() => fireEvent.click(button))
		expect(clicks).toBe(1)
	})

	test('renders only the button while it is available or pending', async () => {
		const rendered = await renderIntoDocument(
			<>
				<WalletConnectionControl disabledReason='Unused reason' label='Connect wallet' onClick={() => undefined} />
				<WalletConnectionControl disabled pending pendingLabel='Connecting…' disabledReason='Unused reason' label='Connect wallet' onClick={() => undefined} />
			</>,
		)
		trackRendered(rendered)
		expect(rendered.container.querySelector('[role="note"]')).toBeNull()
		for (const button of rendered.container.querySelectorAll('button')) expect(button.hasAttribute('aria-describedby')).toBe(false)
	})
})

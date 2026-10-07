/// <reference types="bun-types" />

import { describe, expect, test } from 'bun:test'
import { WalletConnectionControl } from '../components/WalletConnectionControl.js'
import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { within } from './testUtils/queries.js'
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

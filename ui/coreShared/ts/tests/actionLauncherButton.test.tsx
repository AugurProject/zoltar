/// <reference types='bun-types' />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { ActionLauncherButton } from '../components/ActionLauncherButton.js'
import { within } from './testUtils/queries.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('ActionLauncherButton', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('associates its visible disabled reason with the action', async () => {
		const renderedComponent = await renderIntoDocument(
			<>
				<p id='action-context'>Current fork</p>
				<ActionLauncherButton availability={{ disabled: true, reason: 'Select a question first.' }} describedBy='action-context' idleLabel='Start fork' onClick={() => undefined} pendingLabel='Starting fork' showDisabledReason />
			</>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Start fork' })
		const reason = documentQueries.getByRole('note', { name: 'Start fork details' })
		const descriptionIds = button.getAttribute('aria-describedby')?.split(' ') ?? []

		expect(reason.textContent).toContain('Select a question first.')
		expect(descriptionIds).toContain('action-context')
		expect(reason.id).not.toBe('')
		expect(descriptionIds).toContain(reason.id)
		expect(button.getAttribute('title')).toBeNull()
		expect(button.getAttribute('aria-busy')).toBe('false')
	})

	test('shows the disabled reason by default and shares pending presentation with transaction actions', async () => {
		const renderedComponent = await renderIntoDocument(<ActionLauncherButton availability={{ disabled: true, reason: 'Connect a wallet first.' }} idleLabel='Open dialog' onClick={() => undefined} pending pendingLabel='Opening…' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Opening…' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a button')
		expect(button.disabled).toBe(true)
		expect(button.getAttribute('aria-busy')).toBe('true')
		expect(button.querySelector('.tx-action-label-placeholder[data-label="Open dialog"]')).not.toBeNull()
		expect(button.querySelector('.tx-action-label-placeholder[data-label="Opening…"]')).not.toBeNull()
		expect(button.querySelector('.spinner')).not.toBeNull()
		expect(documentQueries.getByRole('note', { name: 'Open dialog details' }).textContent).toContain('Connect a wallet first.')
	})

	test('renders no feedback slot while the action is available', async () => {
		const renderedComponent = await renderIntoDocument(<ActionLauncherButton idleLabel='Deposit REP' pendingLabel='Depositing' onClick={() => undefined} availability={{ disabled: false, reason: undefined }} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(document.body.querySelector('.tx-action-feedback')).toBeNull()
	})

	test('hides the disabled reason when explicitly disabled', async () => {
		const renderedComponent = await renderIntoDocument(<ActionLauncherButton availability={{ disabled: true, reason: 'Connect a wallet first.' }} idleLabel='Open dialog' onClick={() => undefined} pendingLabel='Opening…' showDisabledReason={false} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('note')).toBeNull()
		expect(documentQueries.queryByText('Connect a wallet first.')).toBeNull()
	})
})

/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { ActionLauncherButton } from '../components/ActionLauncherButton.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { within } from './testUtils/queries.js'

describe('ActionLauncherButton', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let restoreDomEnvironment: (() => void) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
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
		const reason = documentQueries.getByText('Select a question first.', { selector: 'p' })
		const descriptionIds = button.getAttribute('aria-describedby')?.split(' ') ?? []

		expect(descriptionIds).toContain('action-context')
		expect(reason.id).not.toBe('')
		expect(descriptionIds).toContain(reason.id)
	})
})

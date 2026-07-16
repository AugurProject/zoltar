/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { within } from './testUtils/queries'
import { ActionLauncherCard } from '../components/ActionLauncherCard.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('ActionLauncherCard', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
	})

	test('renders ready and blocked readiness using the standard card shell classes', async () => {
		const renderedComponent = await renderIntoDocument(
			<div>
				<ActionLauncherCard action={{ actionLabel: 'Ready Action', description: 'Ready details.', key: 'ready', onAction: () => undefined, readiness: 'ready', title: 'Ready Action' }} />
				<ActionLauncherCard action={{ actionLabel: 'Blocked Action', blocker: 'Blocked.', description: 'Blocked details.', key: 'blocked', readiness: 'blocked', title: 'Blocked Action' }} />
			</div>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect((documentQueries.getByRole('heading', { name: 'Ready Action' }) as HTMLElement).closest('.warning-surface')).toBeNull()
		expect((documentQueries.getByRole('heading', { name: 'Ready Action' }) as HTMLElement).closest('.action-launcher-card.ready')).not.toBeNull()
		expect((documentQueries.getByRole('heading', { name: 'Blocked Action' }) as HTMLElement).closest('.warning-surface')).toBeNull()
		expect((documentQueries.getByRole('heading', { name: 'Blocked Action' }) as HTMLElement).closest('.action-launcher-card.blocked')).not.toBeNull()
		expect(document.body.querySelectorAll('.warning-surface.action-launcher-card')).toHaveLength(0)
	})

	test('omits filler copy when an action does not need a description', async () => {
		const renderedComponent = await renderIntoDocument(<ActionLauncherCard action={{ actionLabel: 'Deposit REP', key: 'deposit', onAction: () => undefined, readiness: 'ready', title: 'Deposit REP' }} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const card = within(document.body).getByRole('heading', { name: 'Deposit REP' }).closest('.action-launcher-card')
		if (!(card instanceof HTMLElement)) throw new Error('Expected an action launcher card')
		expect(card.querySelector('.action-launcher-card-copy .detail')).toBeNull()
	})

	test('disables a launcher when blocker text is present even if an action handler exists', async () => {
		const renderedComponent = await renderIntoDocument(
			<ActionLauncherCard
				action={{
					actionLabel: 'Blocked Ready Action',
					blocker: 'Connect your wallet.',
					description: 'Blocked details.',
					key: 'blocked-ready',
					onAction: () => undefined,
					readiness: 'ready',
					title: 'Blocked Ready Action',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Blocked Ready Action' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a launcher button')
		expect(button.disabled).toBe(true)
		expect(documentQueries.getByText('Connect your wallet.')).not.toBeNull()
	})

	test('disables a blocked launcher even when a handler exists and no blocker text is set', async () => {
		let actionCalls = 0
		const renderedComponent = await renderIntoDocument(
			<ActionLauncherCard
				action={{
					actionLabel: 'Blocked Without Copy',
					description: 'Blocked details.',
					key: 'blocked-without-copy',
					onAction: () => {
						actionCalls += 1
					},
					readiness: 'blocked',
					title: 'Blocked Without Copy',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Blocked Without Copy' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a launcher button')
		expect(button.disabled).toBe(true)
		button.click()
		expect(actionCalls).toBe(0)
	})
})

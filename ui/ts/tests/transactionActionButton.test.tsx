/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { TransactionActionButton, TransactionActionButtonLockProvider } from '../components/TransactionActionButton.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { TRANSACTION_ACTION_LOCK_REASON } from '../lib/transactionTray.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { GlobalTransactionPresentationProvider } from '../components/GlobalTransactionPresentationContext.js'

describe('TransactionActionButton', () => {
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

	test('renders pending button text while the action is in flight', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionPresentationProvider transaction={{ title: 'Submitting transaction', tone: 'pending' }}>
				<TransactionActionButton idleLabel='Submit' onClick={() => undefined} pending pendingLabel='Submitting...' />
			</GlobalTransactionPresentationProvider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: 'Submitting...' })).not.toBeNull()
		expect(document.body.querySelector('.spinner')).not.toBeNull()
		expect(documentQueries.queryByRole('status')).toBeNull()
	})

	test('renders the disabled reason when requested', async () => {
		const renderedComponent = await renderIntoDocument(
			h(TransactionActionButton, {
				availability: {
					disabled: true,
					reason: 'Connect a wallet before submitting.',
				},
				idleLabel: 'Submit',
				onClick: () => undefined,
				pendingLabel: 'Submitting...',
				showDisabledReason: true,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: 'Submit' })).not.toBeNull()
		expect(documentQueries.getByText('Connect a wallet before submitting.')).not.toBeNull()
	})

	test('adds a spinner to a loading disabled reason', async () => {
		const renderedComponent = await renderIntoDocument(
			<TransactionActionButton
				availability={{
					disabled: true,
					reason: 'Loading truth auction status…',
				}}
				idleLabel='Submit Bid'
				onClick={() => undefined}
				pendingLabel='Submitting bid…'
				showDisabledReason
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const loadingStatus = within(document.body).getByRole('status')
		expect(loadingStatus.textContent).toContain('Loading truth auction status…')
		expect(loadingStatus.querySelector('.spinner')).not.toBeNull()
	})

	test('calls onClick immediately when enabled', async () => {
		let callCount = 0
		const renderedComponent = await renderIntoDocument(<TransactionActionButton idleLabel='Liquidate Vault' onClick={() => callCount++} pendingLabel='Submitting...' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Liquidate Vault' }))
		})

		expect(callCount).toBe(1)
	})

	test('supports a contextual accessible name while retaining concise visible copy', async () => {
		const renderedComponent = await renderIntoDocument(<TransactionActionButton ariaLabel='Deploy Scalar Outcomes' idleLabel='Deploy' onClick={() => undefined} pendingLabel='Deploying…' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const button = within(document.body).getByRole('button', { name: 'Deploy Scalar Outcomes' })
		expect(button.textContent).toBe('Deploy')
	})

	test('blocks new actions while another transaction is still in flight', async () => {
		let callCount = 0
		const renderedComponent = await renderIntoDocument(
			<TransactionActionButtonLockProvider disabledReason={TRANSACTION_ACTION_LOCK_REASON}>
				<TransactionActionButton idleLabel='Create Pool' onClick={() => callCount++} pendingLabel='Submitting...' />
			</TransactionActionButtonLockProvider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Create Pool' })
		expect((button as HTMLButtonElement).disabled).toBe(true)
		expect(documentQueries.getByText(TRANSACTION_ACTION_LOCK_REASON)).not.toBeNull()

		await act(() => {
			fireEvent.click(button)
		})

		expect(callCount).toBe(0)
	})

	test('keeps a local pending announcement when the global tray only shows a terminal transaction', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionPresentationProvider transaction={{ dismissKey: 'completed-action', title: 'Previous Action Complete', tone: 'success' }}>
				<TransactionActionButton idleLabel='Submit' onClick={() => undefined} pending pendingLabel='Submitting…' />
			</GlobalTransactionPresentationProvider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByRole('status').textContent).toContain('Submitting…')
	})
})

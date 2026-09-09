/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { TransactionActionButton, TransactionActionGroup, TransactionActionButtonLockProvider } from '../components/TransactionActionButton.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { TRANSACTION_ACTION_LOCK_REASON } from '../transactions/transactionTray.js'
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

	test('keeps the feedback region after the initiating button when there is no notice', async () => {
		const rendered = await renderIntoDocument(<TransactionActionButton idleLabel='Submit' pendingLabel='Submitting...' onClick={() => undefined} />)
		cleanupRenderedComponent = rendered.cleanup
		const action = rendered.container.querySelector('.tx-action')
		expect(action?.firstElementChild?.className).toBe('tx-action-row')
		expect(action?.lastElementChild?.className).toBe('tx-action-feedback')
	})

	test('shares a global transaction blocker while keeping both grouped actions disabled', async () => {
		const rendered = await renderIntoDocument(
			<TransactionActionButtonLockProvider disabledReason={TRANSACTION_ACTION_LOCK_REASON}>
				<TransactionActionGroup message={undefined}>
					<TransactionActionButton idleLabel='Approve' pendingLabel='Approving' onClick={() => undefined} />
					<TransactionActionButton idleLabel='Submit' pendingLabel='Submitting' onClick={() => undefined} />
				</TransactionActionGroup>
			</TransactionActionButtonLockProvider>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const notice = within(document.body).getByRole('note')
		expect(notice.textContent).toBe(TRANSACTION_ACTION_LOCK_REASON)
		for (const button of document.querySelectorAll('button')) {
			expect(button.disabled).toBe(true)
			expect(button.getAttribute('aria-describedby')).toBe(notice.id)
		}
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
		const notice = documentQueries.getByRole('note', { name: 'Submit details' })
		expect(notice.textContent).toContain('Connect a wallet before submitting.')
		const button = documentQueries.getByRole('button', { name: 'Submit' })
		const descriptionId = button.getAttribute('aria-describedby')
		expect(descriptionId).not.toBeNull()
		expect(notice.getAttribute('id')).toBe(descriptionId)
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
		const renderedComponent = await renderIntoDocument(<TransactionActionButton ariaLabel='Deploy Scalar Outcomes' idleLabel='Deploy' inlineHint='Confirm the scalar deployment inputs before continuing.' onClick={() => undefined} pendingLabel='Deploying…' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const button = within(document.body).getByRole('button', { name: 'Deploy Scalar Outcomes' })
		const notice = within(document.body).getByRole('note', { name: 'Deploy Scalar Outcomes details' })
		expect(button.textContent).toBe('Deploy')
		expect(notice.textContent).toContain('Confirm the scalar deployment inputs before continuing.')
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

/// <reference types="bun-types" />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { h, render } from 'preact'
import { act } from 'preact/test-utils'
import { GlobalTransactionPresentationProvider } from '../components/GlobalTransactionPresentationContext.js'
import { TransactionActionButton, TransactionActionButtonLockProvider, TransactionActionGroup, TransactionScopeProvider } from '../components/TransactionActionButton.js'
import { fireEvent, within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('TransactionActionButton', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	test('keeps the feedback region after the initiating button when there is no notice', async () => {
		const rendered = await renderIntoDocument(<TransactionActionButton idleLabel='Submit' pendingLabel='Submitting...' onClick={() => undefined} />)
		cleanupRenderedComponent = rendered.cleanup
		const action = rendered.container.querySelector('.tx-action')
		expect(action?.firstElementChild?.className).toBe('tx-action-row')
		expect(action?.lastElementChild?.className).toBe('tx-action-feedback')
	})

	test('shares an open wallet prompt blocker while keeping both grouped actions disabled', async () => {
		const rendered = await renderIntoDocument(
			<TransactionActionButtonLockProvider lock={{ lockedScopes: [], promptOpen: true }}>
				<TransactionActionGroup message={undefined}>
					<TransactionActionButton idleLabel='Approve' pendingLabel='Approving' onClick={() => undefined} />
					<TransactionActionButton idleLabel='Submit' pendingLabel='Submitting' onClick={() => undefined} />
				</TransactionActionGroup>
			</TransactionActionButtonLockProvider>,
		)
		cleanupRenderedComponent = rendered.cleanup
		expect(within(document.body).queryByRole('note')).toBeNull()
		for (const button of document.querySelectorAll('button')) {
			expect(button.disabled).toBe(true)
			expect(button.getAttribute('aria-describedby')).toBeNull()
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
		const notice = documentQueries.getByRole('note')
		expect(notice.textContent).toContain('Connect a wallet before submitting.')
		// A labelled note would replace its text in the button's accessible description.
		expect(notice.hasAttribute('aria-label')).toBe(false)
		const button = documentQueries.getByRole('button', { name: 'Submit' })
		const descriptionId = button.getAttribute('aria-describedby')
		expect(descriptionId).not.toBeNull()
		expect(notice.getAttribute('id')).toBe(descriptionId)
		expect(button.getAttribute('title')).toBeNull()
	})

	test('describes a disabled action by both the inline reason and an external reason element', async () => {
		const renderedComponent = await renderIntoDocument(
			<>
				<p id='external-reason'>Deployment status</p>
				<TransactionActionButton availability={{ disabled: true, reason: 'Deploy the registry first.' }} disabledReasonElementId='external-reason' idleLabel='Deploy' onClick={() => undefined} pendingLabel='Deploying…' />
			</>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Deploy' })
		const notice = documentQueries.getByRole('note')
		expect(notice.hasAttribute('aria-label')).toBe(false)
		expect(button.getAttribute('aria-describedby')?.split(' ')).toEqual(['external-reason', notice.id])
	})

	test('adds a spinner to a loading disabled reason', async () => {
		const renderedComponent = await renderIntoDocument(
			<TransactionActionButton
				availability={{
					disabled: true,
					loading: true,
					reason: 'Loading truth auction status…',
				}}
				idleLabel='Submit bid'
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
		const renderedComponent = await renderIntoDocument(<TransactionActionButton idleLabel='Liquidate vault' onClick={() => callCount++} pendingLabel='Submitting...' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Liquidate vault' }))
		})

		expect(callCount).toBe(1)
	})

	test('supports a contextual accessible name while retaining concise visible copy', async () => {
		const renderedComponent = await renderIntoDocument(<TransactionActionButton ariaLabel='Deploy Scalar Outcomes' idleLabel='Deploy' inlineHint='Confirm the scalar deployment inputs before continuing.' onClick={() => undefined} pendingLabel='Deploying…' />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const button = within(document.body).getByRole('button', { name: 'Deploy Scalar Outcomes' })
		const notice = within(document.body).getByRole('note')
		expect(notice.hasAttribute('aria-label')).toBe(false)
		expect(button.getAttribute('aria-describedby')).toBe(notice.id)
		expect(button.textContent).toBe('Deploy')
		expect(notice.textContent).toContain('Confirm the scalar deployment inputs before continuing.')
	})

	test('blocks new actions while a review or wallet prompt is open', async () => {
		let callCount = 0
		const renderedComponent = await renderIntoDocument(
			<TransactionActionButtonLockProvider lock={{ lockedScopes: [], promptOpen: true }}>
				<TransactionActionButton idleLabel='Create pool' onClick={() => callCount++} pendingLabel='Submitting...' />
			</TransactionActionButtonLockProvider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const button = documentQueries.getByRole('button', { name: 'Create pool' })
		expect((button as HTMLButtonElement).disabled).toBe(true)
		expect(documentQueries.queryByText('Finish the current transaction before starting another transaction.')).toBeNull()

		await act(() => {
			fireEvent.click(button)
		})

		expect(callCount).toBe(0)
	})

	test('locks only actions on the object a pending transaction touches without repeating pending feedback', async () => {
		let unrelatedClicks = 0
		const renderedComponent = await renderIntoDocument(
			<TransactionActionButtonLockProvider lock={{ lockedScopes: [['security-pool:0xa']], promptOpen: false }}>
				<TransactionScopeProvider scope={['security-pool:0xa']}>
					<TransactionActionButton idleLabel='Deposit REP' onClick={() => undefined} pendingLabel='Depositing REP' />
					<TransactionActionButton idleLabel='Depositing now' onClick={() => undefined} pending pendingLabel='Depositing' />
				</TransactionScopeProvider>
				<TransactionScopeProvider scope={['security-pool:0xb']}>
					<TransactionActionButton idleLabel='Deposit other' onClick={() => unrelatedClicks++} pendingLabel='Depositing other' />
				</TransactionScopeProvider>
				<TransactionActionButton idleLabel='Create pool' onClick={() => unrelatedClicks++} pendingLabel='Creating pool' />
				<TransactionActionButton idleLabel='Explicit scope' onClick={() => undefined} pendingLabel='Explicit' scope={['security-pool:0xa']} />
			</TransactionActionButtonLockProvider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const queries = within(document.body)
		const locked = queries.getByRole('button', { name: 'Deposit REP' })
		expect(locked.hasAttribute('disabled')).toBe(true)
		// A locked action names the pending transaction as its reason instead of resting disabled without one.
		const lockReasonId = locked.getAttribute('aria-describedby')
		expect(lockReasonId === null ? undefined : document.getElementById(lockReasonId)?.textContent).toBe('Waiting for a pending transaction on this item.')
		expect(queries.queryByText('Transaction pending.')).toBeNull()
		expect(queries.getByRole('button', { name: 'Explicit scope' }).hasAttribute('disabled')).toBe(true)
		// The initiating action keeps its own pending state instead of the lock reason.
		expect(queries.getByRole('button', { name: 'Depositing' }).getAttribute('aria-busy')).toBe('true')
		await act(() => {
			fireEvent.click(queries.getByRole('button', { name: 'Deposit other' }))
			fireEvent.click(queries.getByRole('button', { name: 'Create pool' }))
		})
		expect(unrelatedClicks).toBe(2)
	})

	test('keeps keyboard focus on the initiating button while its transaction is pending and after it settles', async () => {
		let callCount = 0
		function Harness({ pending, completed }: { pending: boolean; completed: boolean }) {
			return (
				<form onSubmit={event => event.preventDefault()}>
					<TransactionActionButton availability={{ disabled: completed, reason: completed ? 'Already submitted.' : undefined }} idleLabel='Submit' onClick={() => callCount++} pending={pending} pendingLabel='Submitting…' />
				</form>
			)
		}
		const renderedComponent = await renderIntoDocument(<Harness pending={false} completed={false} />)
		cleanupRenderedComponent = renderedComponent.cleanup
		const button = within(document.body).getByRole('button', { name: 'Submit' })
		if (!(button instanceof HTMLButtonElement)) throw new Error('Expected a button')
		await act(() => button.focus())
		await act(() => render(<Harness pending completed={false} />, renderedComponent.container))
		expect(button.disabled).toBe(false)
		expect(button.getAttribute('aria-disabled')).toBe('true')
		expect(document.activeElement).toBe(button)
		await act(() => fireEvent.click(button))
		expect(callCount).toBe(0)
		await act(() => render(<Harness pending={false} completed />, renderedComponent.container))
		expect(document.activeElement).toBe(button)
		expect(button.getAttribute('aria-disabled')).toBe('true')
		await act(() => fireEvent.click(button))
		expect(callCount).toBe(0)
		// Once focus moves on, the unavailable button leaves the tab order again.
		await act(() => button.blur())
		expect(button.disabled).toBe(true)
		expect(button.hasAttribute('aria-disabled')).toBe(false)
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

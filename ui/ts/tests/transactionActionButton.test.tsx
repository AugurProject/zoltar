/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { TransactionActionButton, TransactionActionButtonLockProvider } from '../components/TransactionActionButton.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { getForkAuctionActionSafetyId } from '../lib/actionSafety/ids.js'
import { ActionSafetyProvider } from '../lib/actionSafety/runtime.js'
import { TRANSACTION_ACTION_LOCK_REASON } from '../lib/transactionTray.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

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
			h(TransactionActionButton, {
				idleLabel: 'Submit',
				onClick: () => undefined,
				pending: true,
				pendingLabel: 'Submitting...',
				safetyId: 'deployment.deployNextMissing',
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: 'Submitting...' })).not.toBeNull()
		expect(document.body.querySelector('.spinner')).not.toBeNull()
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
				safetyId: 'deployment.deployNextMissing',
				showDisabledReason: true,
			}),
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('button', { name: 'Submit' })).not.toBeNull()
		expect(documentQueries.getByText('Connect a wallet before submitting.')).not.toBeNull()
	})

	test('opens a safety confirmation for configured high-risk actions before calling onClick', async () => {
		let callCount = 0
		const renderedComponent = await renderIntoDocument(
			<ActionSafetyProvider>
				<TransactionActionButton idleLabel='Liquidate Vault' onClick={() => callCount++} pendingLabel='Submitting...' safetyId='security-pool.queueLiquidation' />
			</ActionSafetyProvider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Liquidate Vault' }))
		})

		expect(callCount).toBe(0)
		expect(documentQueries.getByRole('dialog', { name: 'Review Vault Liquidation' })).not.toBeNull()
		expect(documentQueries.getByText('Liquidation is a destructive operator action. Review the vault, oracle status, and amount carefully.')).not.toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('checkbox'))
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Queue Liquidation' }))
		})

		expect(callCount).toBe(1)
	})

	test('requires confirmation for fork-trigger actions before calling onClick', async () => {
		for (const scenario of [
			{
				confirmLabel: 'Fork Zoltar',
				dialogName: 'Review Zoltar Fork',
				idleLabel: 'Fork Universe',
				safetyId: getForkAuctionActionSafetyId('forkUniverse'),
			},
			{
				confirmLabel: 'Trigger Fork',
				dialogName: 'Trigger Zoltar Fork',
				idleLabel: 'Trigger Pool Fork',
				safetyId: getForkAuctionActionSafetyId('forkWithOwnEscalation'),
			},
			{
				confirmLabel: 'Trigger Fork',
				dialogName: 'Trigger Zoltar Fork',
				idleLabel: 'Trigger Reporting Fork',
				safetyId: 'reporting.triggerZoltarFork' as const,
			},
		] as const) {
			let callCount = 0
			const renderedComponent = await renderIntoDocument(
				<ActionSafetyProvider>
					<TransactionActionButton idleLabel={scenario.idleLabel} onClick={() => callCount++} pendingLabel='Submitting...' safetyId={scenario.safetyId} />
				</ActionSafetyProvider>,
			)

			const documentQueries = within(document.body)
			await act(() => {
				fireEvent.click(documentQueries.getByRole('button', { name: scenario.idleLabel }))
			})

			expect(callCount).toBe(0)
			expect(documentQueries.getByRole('dialog', { name: scenario.dialogName })).not.toBeNull()

			await act(() => {
				fireEvent.click(documentQueries.getByRole('checkbox'))
			})
			await act(() => {
				fireEvent.click(documentQueries.getByRole('button', { name: scenario.confirmLabel }))
			})

			expect(callCount).toBe(1)

			await renderedComponent.cleanup()
			cleanupRenderedComponent = undefined
		}
	})

	test('requires confirmation for auction claims before calling onClick', async () => {
		let callCount = 0
		const renderedComponent = await renderIntoDocument(
			<ActionSafetyProvider>
				<TransactionActionButton idleLabel='Settle Selected Bids' onClick={() => callCount++} pendingLabel='Submitting...' safetyId={getForkAuctionActionSafetyId('claimAuctionProceeds')} />
			</ActionSafetyProvider>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Settle Selected Bids' }))
		})

		expect(callCount).toBe(0)
		expect(documentQueries.getByRole('dialog', { name: 'Review Auction Claim' })).not.toBeNull()
		expect(documentQueries.getByText('Review the selected winning bids before assigning their REP and underwriting load to the bidder vault.')).not.toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('checkbox'))
		})
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Claim Auction Proceeds' }))
		})

		expect(callCount).toBe(1)
	})

	test('blocks new actions while another transaction is still in flight', async () => {
		let callCount = 0
		const renderedComponent = await renderIntoDocument(
			<TransactionActionButtonLockProvider disabledReason={TRANSACTION_ACTION_LOCK_REASON}>
				<TransactionActionButton idleLabel='Create Pool' onClick={() => callCount++} pendingLabel='Submitting...' safetyId='security-pool.createPool' />
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
})

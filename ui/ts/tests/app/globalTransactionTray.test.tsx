/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '../testUtils/queries'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { GlobalTransactionTray } from '../../app/components/GlobalTransactionTray.js'
import { createMarketCreationSuccessPresentation, createSecurityPoolCreationSuccessPresentation, createZoltarForkSuccessPresentation } from '../../features/transactionPresentations.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'

describe('GlobalTransactionTray', () => {
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

	test('does not render when there is no submitted transaction', async () => {
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={undefined} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(renderedComponent.container.textContent).toBe('')
	})

	test('renders a completed transaction notice with detail rows and a link', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionTray
				transaction={{
					detail: 'The new question is now on-chain.',
					hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
					rows: [{ label: 'Question ID', value: '0x0b' }],
					title: 'Question Created',
					tone: 'success',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('status')).not.toBeNull()
		expect(documentQueries.getByText('Question Created')).not.toBeNull()
		expect(documentQueries.getByText('The new question is now on-chain.')).not.toBeNull()
		expect(documentQueries.getByText('Question ID')).not.toBeNull()
		expect(documentQueries.getByText('0x0b')).not.toBeNull()
		expect(documentQueries.getByRole('link', { name: '0x1234000000000000000000000000000000000000000000000000000000000000' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Dismiss' })).not.toBeNull()
	})

	test('keeps semantic object context visible and call data in a technical disclosure after completion', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionTray
				transaction={{
					dismissKey: '0xprepared-price-request',
					hash: '0xprepared-price-request',
					rows: [{ label: 'Security Pool Address', value: '0xpool' }],
					technicalRows: [
						{ label: 'Function', value: 'requestPrice' },
						{ label: 'Arguments', value: '0xpool, 1000000000000000000' },
					],
					title: 'Price Requested',
					tone: 'success',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Security Pool Address')).not.toBeNull()
		expect(documentQueries.getByText('0xpool')).not.toBeNull()
		expect(documentQueries.getByText('Technical details', { selector: 'summary' })).not.toBeNull()
		expect(documentQueries.getByText('Arguments')).not.toBeNull()
	})

	test('renders complete copyable question identifiers across success notices', async () => {
		const questionId = '0x0000000000000000000000000000000000000000000000000000000000000001'
		const presentations = [
			createMarketCreationSuccessPresentation({ createQuestionHash: '0x1001', marketType: 'binary', questionId }),
			createZoltarForkSuccessPresentation({ action: 'forkZoltar', hash: '0x1002', questionId, universeId: 0n }),
			createSecurityPoolCreationSuccessPresentation({ deployPoolHash: '0x1003', questionId, securityMultiplier: 2n, securityPoolAddress: '0x0000000000000000000000000000000000000002', universeId: 0n }),
		]
		const renderedComponent = await renderIntoDocument(
			<>
				{presentations.map(presentation => (
					<GlobalTransactionTray key={presentation.hash} transaction={presentation} />
				))}
			</>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const identifierButtons = within(document.body).getAllByRole('button', { name: `Copy identifier ${questionId}` })
		expect(identifierButtons).toHaveLength(3)
		for (const identifierButton of identifierButtons) expect(identifierButton.textContent).toBe(questionId)
	})

	test('renders a pending transaction with its explanation and hash but no dismiss control', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionTray
				transaction={{
					detail: 'Waiting for confirmation.',
					hash: '0x2234000000000000000000000000000000000000000000000000000000000000',
					title: 'Creating Question',
					tone: 'pending',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Dismiss' })).toBeNull()
		expect(documentQueries.getByText('Pending')).not.toBeNull()
		expect(documentQueries.getByText('Waiting for confirmation.')).not.toBeNull()
		expect(documentQueries.getByRole('link', { name: '0x2234000000000000000000000000000000000000000000000000000000000000' })).not.toBeNull()
	})

	test('renders a concise pending transaction when no extra explanation is needed', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionTray
				transaction={{
					hash: '0x2234000000000000000000000000000000000000000000000000000000000001',
					title: 'Creating Question',
					tone: 'pending',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Creating Question')).not.toBeNull()
		expect(documentQueries.getByText('Pending')).not.toBeNull()
		expect(document.body.querySelector('.global-transaction-notice-detail')).toBeNull()
	})

	test('renders a wallet-awaiting transaction with a spinner and close control', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionTray
				transaction={{
					detail: 'Confirm the transaction in your wallet.',
					dismissKey: 'transaction-request-wallet-close',
					title: 'Creating Question',
					tone: 'awaiting-wallet',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Awaiting Wallet')).not.toBeNull()
		expect(documentQueries.getByText('Confirm the transaction in your wallet.')).not.toBeNull()
		expect(document.body.querySelector('.global-transaction-spinner')).not.toBeNull()
		expect(documentQueries.queryByRole('link')).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Dismiss' })).toBeNull()
		const closeButton = documentQueries.getByRole('button', { name: 'Close transaction status' })
		fireEvent.click(closeButton)
		expect(renderedComponent.container.textContent).toBe('')
	})

	test('shows a terminal failure after the user closes the awaiting-wallet notice', async () => {
		const dismissKey = 'transaction-request-wallet-terminal'
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={{ dismissKey, title: 'Creating Question', tone: 'awaiting-wallet' }} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		fireEvent.click(within(document.body).getByRole('button', { name: 'Close transaction status' }))
		expect(renderedComponent.container.textContent).toBe('')

		await act(() => {
			render(<GlobalTransactionTray transaction={{ detail: 'Action canceled in wallet.', dismissKey, title: 'Creating Question', tone: 'error' }} />, renderedComponent.container)
		})

		expect(within(document.body).getByText('Failed')).not.toBeNull()
		expect(within(document.body).getByText('Action canceled in wallet.')).not.toBeNull()
	})

	test('renders a simulation transaction as preparing without wallet copy', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionTray
				transaction={{
					detail: 'Submitting in browser simulation. No wallet confirmation is required.',
					dismissKey: 'transaction-request-1',
					title: 'Creating Question',
					tone: 'preparing',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Preparing')).not.toBeNull()
		expect(documentQueries.getByText('Submitting in browser simulation. No wallet confirmation is required.')).not.toBeNull()
		expect(documentQueries.queryByText('Awaiting Wallet')).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Dismiss' })).toBeNull()
	})

	test('renders a failed pre-submit transaction with the failure reason and dismiss control', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionTray
				transaction={{
					detail: 'Action canceled in wallet.',
					dismissKey: 'transaction-request-2',
					title: 'Creating Question',
					tone: 'error',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Failed')).not.toBeNull()
		expect(documentQueries.getByText('Action canceled in wallet.')).not.toBeNull()
		expect(documentQueries.queryByRole('link')).toBeNull()
		const dismissButton = documentQueries.getByRole('button', { name: 'Dismiss' })
		expect(dismissButton.parentElement?.classList.contains('global-transaction-actions')).toBe(true)
	})

	test('renders a failed submitted transaction with both the failure reason and hash link', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionTray
				transaction={{
					detail: 'Transaction reverted',
					dismissKey: '0x4234000000000000000000000000000000000000000000000000000000000000',
					hash: '0x4234000000000000000000000000000000000000000000000000000000000000',
					title: 'Creating Question',
					tone: 'error',
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Failed')).not.toBeNull()
		expect(documentQueries.getByText('Transaction reverted')).not.toBeNull()
		expect(documentQueries.getByRole('link', { name: '0x4234000000000000000000000000000000000000000000000000000000000000' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Dismiss' })).not.toBeNull()
	})

	test('keeps a dismissed completed transaction hidden when remounted with the same dismiss key', async () => {
		const transaction = {
			detail: 'Refresh the UI if this card does not update automatically.',
			dismissKey: 'tray-remount-dismiss-key',
			hash: '0x3234000000000000000000000000000000000000000000000000000000000000' as const,
			title: 'Refresh Needed',
			tone: 'warning' as const,
		}
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={transaction} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Dismiss' }))
		})
		expect(renderedComponent.container.textContent).toBe('')

		await act(() => {
			renderedComponent.unmount()
		})

		const rerenderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={transaction} />)
		cleanupRenderedComponent = rerenderedComponent.cleanup
		expect(rerenderedComponent.container.textContent).toBe('')
	})

	test('keeps a pending transaction visible when remounted with the same hash', async () => {
		const transaction = {
			detail: 'Waiting for confirmation.',
			hash: '0x5234000000000000000000000000000000000000000000000000000000000000' as const,
			title: 'Creating Question',
			tone: 'pending' as const,
		}
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={transaction} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		expect(within(document.body).getByText('Pending')).not.toBeNull()
		expect(within(document.body).getByRole('link', { name: transaction.hash })).not.toBeNull()

		await act(() => {
			renderedComponent.unmount()
		})

		const rerenderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={transaction} />)
		cleanupRenderedComponent = rerenderedComponent.cleanup
		expect(within(document.body).getByText('Pending')).not.toBeNull()
		expect(within(document.body).getByRole('link', { name: transaction.hash })).not.toBeNull()
	})

	test('shows terminal success after the user closes a pending transaction', async () => {
		const hash = '0x6234000000000000000000000000000000000000000000000000000000000000' as const
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={{ hash, title: 'Creating Question', tone: 'pending' }} />)
		cleanupRenderedComponent = renderedComponent.cleanup

		fireEvent.click(within(document.body).getByRole('button', { name: 'Close transaction status' }))
		expect(renderedComponent.container.textContent).toBe('')

		await act(() => {
			render(<GlobalTransactionTray transaction={{ hash, title: 'Question Created', tone: 'success' }} />, renderedComponent.container)
		})

		expect(within(document.body).getByText('Confirmed')).not.toBeNull()
		expect(within(document.body).getByText('Question Created')).not.toBeNull()
	})
})

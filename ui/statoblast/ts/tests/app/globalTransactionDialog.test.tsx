/// <reference types='bun-types' />

import { signal } from '@preact/signals'
import type { GlobalTransactionPresentation } from '@zoltar/ui-core-shared/types/components.js'
import { TransactionStepsModal } from '@zoltar/ui-core-shared/components/TransactionStepsModal.js'
import { beforeEach, describe, expect, jest, test } from 'bun:test'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createInjectedBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import { MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { GlobalTransactionDialog } from '@zoltar/ui-core-shared/app/components/GlobalTransactionDialog.js'
import { OperationModal } from '@zoltar/ui-core-shared/components/OperationModal.js'
import { GlobalTransactionPresentationProvider } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { TransactionStepsActions } from '@zoltar/ui-core-shared/components/TransactionStepsContent.js'
import { createMarketCreationSuccessPresentation, createMarketCreationTransactionIntent } from '@zoltar/ui-statoblast-shared/features/reportingTransactionPresentations.js'
import { createSecurityPoolCreationWarningPresentation } from '@zoltar/ui-statoblast-shared/features/transactionPresentations.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { createInitialTransactionTrayState, markTransactionFailed, markTransactionPresented, markTransactionRequested, markTransactionSubmitted } from '@zoltar/ui-core-shared/transactions/transactionTray.js'
import { createTransactionStepController, transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'

describe('GlobalTransactionDialog', () => {
	let restoreRouting: (() => void) | undefined
	const { trackRendered } = installDomTestLifecycle({
		afterTest: () => {
			restoreRouting?.()
			restoreRouting = undefined
		},
	})

	beforeEach(() => {
		restoreRouting = installTestRouting()
	})

	test.each([MAINNET_NETWORK_PROFILE, SEPOLIA_NETWORK_PROFILE])('links the full hash to the active explorer: $id', async profile => {
		const restore = installActiveEnvironmentForTesting(createInjectedBackend({ profile }))
		const hash = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef12'
		try {
			const rendered = await renderIntoDocument(<GlobalTransactionDialog transaction={{ hash, title: 'Price requested', tone: 'success' }} />)
			trackRendered(rendered)
			const link = within(document.body).getByRole('link', { name: `View transaction ${hash} on explorer (opens in a new tab)` })
			expect(link.getAttribute('href')).toBe(`${profile.transactionExplorerBaseUrl}${hash}`)
			expect(link.getAttribute('target')).toBe('_blank')
			expect(link.getAttribute('rel')).toContain('noreferrer')
			expect(link.textContent).toContain(hash)
			expect(link.querySelector('.address-value-abbreviated')).toBeNull()
		} finally {
			restore()
		}
	})

	test('keeps the reporting amount and source review then shows one shared success panel', async () => {
		const hash = '0x3333333333333333333333333333333333333333333333333333333333333333'
		const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
		const controller = createTransactionStepController()
		controller.setPlan([{ title: 'Report No · 2 REP', description: undefined, contractAddress: undefined, spender: undefined, amount: '2 REP', paidFrom: 'Wallet REP' }])
		const review = controller.review()
		function Harness() {
			return (
				<GlobalTransactionPresentationProvider transaction={presentation.value}>
					<TransactionStepsModal contextKey='reporting-merge' />
					<GlobalTransactionDialog transaction={presentation.value} />
				</GlobalTransactionPresentationProvider>
			)
		}
		const rendered = await renderIntoDocument(<Harness />)
		trackRendered(rendered)
		try {
			const queries = within(document.body)
			const reviewDialog = within(queries.getByRole('dialog', { name: 'Report No · 2 REP' }))
			expect(reviewDialog.getByText('Amount')).not.toBeNull()
			expect(reviewDialog.getByText('2 REP')).not.toBeNull()
			expect(reviewDialog.getByText('Paid from')).not.toBeNull()
			expect(reviewDialog.getByText('Wallet REP')).not.toBeNull()
			expect(reviewDialog.getAllByRole('button', { name: 'Report No · 2 REP' })).toHaveLength(1)
			await act(() => fireEvent.click(reviewDialog.getByRole('button', { name: 'Report No · 2 REP' })))
			await review
			await act(() => {
				controller.submitted(hash)
				presentation.value = { title: 'Reporting No · 2 REP', tone: 'pending', hash }
			})
			await act(() => {
				controller.receipt(hash, 'success')
				presentation.value = { title: 'Reported No · 2 REP', tone: 'success', hash }
			})
			expect(queries.queryByRole('dialog', { name: 'Report No · 2 REP' })).toBeNull()
			const success = within(queries.getByRole('dialog', { name: 'Transaction status' }))
			expect(success.getByText('Reported No · 2 REP')).not.toBeNull()
			expect(queries.getAllByRole('dialog')).toHaveLength(1)
			expect(document.querySelector('.transaction-success-panel')).toBeNull()
			await act(() => fireEvent.click(success.getByRole('button', { name: 'Dismiss' })))
			expect(queries.queryByRole('dialog')).toBeNull()
		} finally {
			transactionSteps.value?.cancel()
		}
	})

	test('shows a nonblocking pending status and modal confirmed and failed statuses', async () => {
		const hash = '0xabcd000000000000000000000000000000000000000000000000000000000001'
		const pending = { hash, title: 'Requesting Price', tone: 'pending' as const, rows: [{ label: 'Security pool address', value: '0x0000000000000000000000000000000000000002' }] }
		const renderedComponent = await renderIntoDocument(
			<>
				<button type='button'>Request price</button>
				<GlobalTransactionDialog transaction={pending} />
			</>,
		)
		trackRendered(renderedComponent)
		const queries = within(document.body)
		const dialog = queries.getByRole('status', { name: 'Transaction status' })
		expect(dialog.hasAttribute('aria-modal')).toBe(false)
		expect(within(dialog).getByRole('status').textContent).toContain('Requesting Price')
		expect(within(dialog).getByRole('button', { name: 'Hide' }).classList.contains('secondary')).toBe(true)
		expect(queries.getByRole('button', { name: 'Request price' }).closest('[inert]')).toBeNull()
		await act(() => {
			render(<GlobalTransactionDialog transaction={{ ...pending, title: 'Price requested', tone: 'success' }} />, renderedComponent.container)
		})
		expect(
			within(queries.getByRole('dialog', { name: 'Transaction status' }))
				.getByRole('button', { name: 'Dismiss' })
				.classList.contains('secondary'),
		).toBe(true)
		await act(() => {
			render(<GlobalTransactionDialog transaction={{ ...pending, detail: 'nonce too low', title: 'Price request failed', tone: 'error' }} />, renderedComponent.container)
		})
		const failedDialog = queries.getByRole('dialog', { name: 'Transaction status' })
		expect(failedDialog.querySelector('.global-transaction-notice-recovery')?.textContent).toBe('nonce too low')
		expect(within(failedDialog).getByText('nonce too low').closest('details')).toBeNull()
		expect(within(failedDialog).getByRole('alert').textContent).toContain('nonce too low')
		expect(failedDialog.querySelector('details')?.open).toBe(false)
	})

	test.each(['Action canceled in wallet.', "The pool's oracle price expired. Request a new price in price oracle, then retry.", 'Transaction reverted; checking details…'])('shows the failure reason before expanding details: %s', async detail => {
		const rendered = await renderIntoDocument(<GlobalTransactionDialog transaction={{ dismissKey: `visible-failure-${detail}`, title: 'Price request failed', tone: 'error', detail, technicalRows: [{ label: 'Function', value: 'requestPrice' }] }} />)
		trackRendered(rendered)
		const panel = within(document.body).getByRole('dialog', { name: 'Transaction status' })
		expect(within(panel).getByText(detail).closest('details')).toBeNull()
		expect(panel.querySelector('details')?.open).toBe(false)
		expect(panel.querySelector('summary')?.textContent).toBe('Transaction details')
	})

	test('explains a missing failure reason without an empty disclosure', async () => {
		const rendered = await renderIntoDocument(<GlobalTransactionDialog transaction={{ dismissKey: 'unknown-failure-reason', title: 'Price request failed', tone: 'error' }} />)
		trackRendered(rendered)
		const panel = within(document.body).getByRole('dialog', { name: 'Transaction status' })
		expect(within(panel).getByText('No failure reason was returned.')).not.toBeNull()
		expect(panel.querySelector('details')).toBeNull()
	})

	test('keeps confirmed status and its hash until explicitly dismissed, even after a minute', async () => {
		const hash = '0xabcde0000000000000000000000000000000000000000000000000000000001'
		const success = { hash, title: 'Price requested', tone: 'success' as const }
		jest.useFakeTimers()
		try {
			const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={success} />)
			trackRendered(renderedComponent)
			const queries = within(document.body)
			await act(() => {
				jest.advanceTimersByTime(60000)
			})
			const panel = queries.getByRole('dialog', { name: 'Transaction status' })
			expect(within(panel).getByText(hash)).not.toBeNull()
			await act(() => fireEvent.click(within(panel).getByRole('button', { name: 'Dismiss' })))
			expect(queries.queryByRole('dialog', { name: 'Transaction status' })).toBeNull()
			await act(() => render(<GlobalTransactionDialog transaction={{ ...success, detail: 'nonce too low', tone: 'error' }} />, renderedComponent.container))
			await act(() => {
				jest.advanceTimersByTime(60000)
			})
			expect(queries.getByRole('dialog', { name: 'Transaction status' })).not.toBeNull()
		} finally {
			jest.useRealTimers()
		}
	})

	test('keeps the failed transaction hash in the shared dialog only', async () => {
		const controller = createTransactionStepController()
		controller.setPlan([{ title: 'Request price', description: 'Fund the report.', contractAddress: undefined, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }])
		const review = controller.review()
		transactionSteps.value?.confirm()
		await review
		const hash = '0x1111111111111111111111111111111111111111111111111111111111111112'
		controller.submitted(hash)
		controller.receipt(hash, 'reverted')
		controller.failed('Transaction reverted')
		const presentation = { hash, title: 'Price request', tone: 'error' as const, detail: 'Transaction reverted' }
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionPresentationProvider transaction={presentation}>
				<TransactionStepsActions contextKey='failed-hash' />
				<GlobalTransactionDialog transaction={presentation} />
			</GlobalTransactionPresentationProvider>,
		)
		trackRendered(renderedComponent)
		try {
			const status = within(document.body).getByRole('dialog', { name: 'Transaction status' })
			expect(status.textContent).toContain('Price request')
			expect(within(status).getByText(hash)).not.toBeNull()
			expect(document.querySelector('.transaction-step-hash a')).toBeNull()
			await act(() => fireEvent.click(within(status).getByRole('button', { name: 'Dismiss' })))
			expect(document.querySelector('.transaction-step-hash a')).toBeNull()
		} finally {
			transactionSteps.value?.cancel()
		}
	})

	test('shows intermediate pending and confirmed receipts in the shared transaction dialog', async () => {
		const hash = '0xbccd000000000000000000000000000000000000000000000000000000000001'
		const controller = createTransactionStepController()
		const step = { description: undefined, contractAddress: undefined, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }
		controller.setPlan([
			{ ...step, title: 'Wrap ETH into WETH' },
			{ ...step, title: 'Request price' },
		])
		const firstReview = controller.review(0)
		await act(() => transactionSteps.value?.confirmStep(0))
		await firstReview
		const pending = { hash, title: 'Wrapping ETH', tone: 'pending' as const, rows: [{ label: 'Security pool address', value: '0x0000000000000000000000000000000000000002' }] }
		const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={pending} />)
		trackRendered(renderedComponent)
		await act(() => controller.submitted(hash))
		expect(within(document.body).getByRole('status', { name: 'Transaction status' }).textContent).toContain('Wrap ETH into WETH')
		expect(within(document.body).getByRole('status', { name: 'Transaction status' }).textContent).toContain('Pending')
		await act(() => controller.receipt(hash, 'success'))
		const secondReview = controller.review(1).catch(() => undefined)
		await act(() => undefined)
		expect(within(document.body).getByRole('dialog', { name: 'Transaction status' }).textContent).toContain('Wrapped ETH into WETH')
		expect(within(document.body).getByRole('dialog', { name: 'Transaction status' }).textContent).toContain('Confirmed')
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Dismiss' })))
		await act(() => render(<GlobalTransactionDialog transaction={{ ...pending, title: 'ETH wrapped', tone: 'success' }} />, renderedComponent.container))
		expect(within(document.body).queryByRole('dialog', { name: 'Transaction status' })).toBeNull()
		await act(() => render(<GlobalTransactionDialog transaction={{ ...pending, detail: 'Refresh failed after confirmation.', title: 'Wrap completed', tone: 'warning' }} />, renderedComponent.container))
		expect(within(within(document.body).getByRole('dialog', { name: 'Transaction status' })).getByText('Refresh failed after confirmation.')).not.toBeNull()
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Dismiss' })))
		controller.skipped()
		transactionSteps.value?.cancel()
		await secondReview
	})

	test('keeps the failed page action available while status is visible', async () => {
		const renderedComponent = await renderIntoDocument(
			<>
				<button type='button'>Create question</button>
				<GlobalTransactionDialog transaction={{ dismissKey: 'page-action-failure', title: 'Question creation failed', tone: 'error' }} />
			</>,
		)
		trackRendered(renderedComponent)
		const status = within(document.body).getByRole('dialog', { name: 'Transaction status' })
		expect(status.hasAttribute('aria-modal')).toBe(false)
		expect(within(document.body).getByRole('button', { name: 'Create question' }).closest('[inert]')).toBeNull()
		await act(() => fireEvent.click(within(status).getByRole('button', { name: 'Dismiss' })))
		expect(within(document.body).queryByRole('dialog', { name: 'Transaction status' })).toBeNull()
	})

	test('keeps form focus, Escape, and status dismissal accessible together', async () => {
		let closed = false
		const status = { dismissKey: 'form-and-status-failure', title: 'Price request failed', tone: 'error' as const }
		const renderedComponent = await renderIntoDocument(
			<>
				<OperationModal
					isOpen
					title='Request New Price'
					onClose={() => {
						closed = true
					}}
				>
					<input aria-label='Price' />
					<button type='button'>Request price</button>
				</OperationModal>
				<GlobalTransactionDialog transaction={status} />
			</>,
		)
		trackRendered(renderedComponent)
		const queries = within(document.body)
		const form = queries.getByRole('dialog', { name: 'Request New Price' })
		const dismiss = within(queries.getByRole('dialog', { name: 'Transaction status' })).getByRole('button', { name: 'Dismiss' })
		expect(form.contains(document.activeElement)).toBe(true)
		const request = within(form).getByRole('button', { name: 'Request price' })
		request.focus()
		await act(() => fireEvent.keyDown(request, { key: 'Tab' }))
		expect(document.activeElement).toBe(dismiss)
		await act(() => fireEvent.keyDown(dismiss, { key: 'Escape' }))
		expect(closed).toBe(true)
		await act(() => fireEvent.click(dismiss))
		expect(queries.queryByRole('dialog', { name: 'Transaction status' })).toBeNull()
	})

	test('focuses a form opened while nonblocking status remains visible', async () => {
		const status = { dismissKey: 'status-before-form', title: 'Question creation failed', tone: 'error' as const }
		const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={status} />)
		trackRendered(renderedComponent)
		await act(() => {
			render(
				<>
					<OperationModal isOpen title='Request New Price' onClose={() => undefined}>
						<input aria-label='Price' />
					</OperationModal>
					<GlobalTransactionDialog transaction={status} />
				</>,
				renderedComponent.container,
			)
		})
		const queries = within(document.body)
		expect(queries.getByRole('dialog', { name: 'Request New Price' }).contains(document.activeElement)).toBe(true)
		expect(queries.getByRole('dialog', { name: 'Transaction status' }).closest('[inert]')).toBeNull()
	})

	test('does not render when there is no submitted transaction', async () => {
		const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={undefined} />)
		trackRendered(renderedComponent)

		expect(renderedComponent.container.textContent).toBe('')
	})

	test('renders a completed transaction notice with detail rows and a link', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionDialog
				transaction={{
					detail: 'The new question is now on-chain.',
					hash: '0x1234000000000000000000000000000000000000000000000000000000000000',
					rows: [{ label: 'Question ID', value: '0x0b' }],
					title: 'Question created',
					tone: 'success',
				}}
			/>,
		)
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('status')).not.toBeNull()
		expect(documentQueries.getByText('Question created')).not.toBeNull()
		expect(documentQueries.getByText('The new question is now on-chain.')).not.toBeNull()
		expect(documentQueries.getByText('Question ID')).not.toBeNull()
		expect(documentQueries.getByText('0x0b')).not.toBeNull()
		expect(documentQueries.getByText('0x1234000000000000000000000000000000000000000000000000000000000000')).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Dismiss' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Dismiss' }).classList.contains('secondary')).toBe(true)
	})

	test('warns when transaction lifecycle state belongs to a different header universe', async () => {
		const intent = createMarketCreationTransactionIntent({ marketType: 'binary', universeId: 7n })
		const requested = markTransactionRequested(createInitialTransactionTrayState(), intent)
		const submitted = markTransactionSubmitted(requested, '0xb234000000000000000000000000000000000000000000000000000000000000')
		const failed = markTransactionFailed(submitted, 'Transaction reverted')
		const success = createMarketCreationSuccessPresentation({ createQuestionHash: '0xb234000000000000000000000000000000000000000000000000000000000000', marketType: 'binary', questionId: '0x01' }, { universeId: 7n })
		const lifecyclePresentations = [submitted.active, failed.active, success]
		if (lifecyclePresentations.some(presentation => presentation === undefined)) throw new Error('Transaction lifecycle presentation should be defined')

		const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog activeUniverseId={7n} transaction={requested.active} />)
		trackRendered(renderedComponent)
		expect(within(document.body).queryByRole('dialog')).toBeNull()
		expect(within(document.body).queryByText('Transaction universe mismatch')).toBeNull()
		await act(() => {
			render(<GlobalTransactionDialog activeUniverseId={8n} transaction={{ ...success, universeId: undefined }} />, renderedComponent.container)
		})
		expect(within(document.body).queryByText('Transaction universe mismatch')).toBeNull()

		for (const presentation of lifecyclePresentations) {
			await act(() => {
				render(<GlobalTransactionDialog activeUniverseId={8n} transaction={presentation} />, renderedComponent.container)
			})
			const documentQueries = within(document.body)
			expect(documentQueries.getByText('Transaction universe mismatch')).not.toBeNull()
			expect(documentQueries.getByText('This transaction belongs to 0x7, while the header shows 0x8.')).not.toBeNull()
			expect(presentation?.rows?.map(row => row.label)).not.toContain('Universe')
		}
	})

	test('keeps the outcome and hash visible while grouping context and call data in a disclosure', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionDialog
				transaction={{
					dismissKey: '0xprepared-price-request',
					hash: '0xprepared-price-request',
					rows: [{ label: 'Security pool address', value: '0xpool' }],
					technicalRows: [
						{ label: 'Function', value: 'requestPrice' },
						{ label: 'Arguments', value: '0xpool, 1000000000000000000' },
					],
					title: 'Price Requested',
					tone: 'success',
				}}
			/>,
		)
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		const details = documentQueries.getByText('Transaction details', { selector: 'summary' }).closest('details')
		if (details === null) throw new Error('Missing transaction details disclosure')
		expect(details.open).toBe(false)
		expect(details.contains(documentQueries.getByText('Security pool address'))).toBe(true)
		expect(details.contains(documentQueries.getByText('0xpool'))).toBe(true)
		expect(details.contains(documentQueries.getByText('Technical details'))).toBe(true)
		expect(details.contains(documentQueries.getByText('Arguments'))).toBe(true)
		expect(details.contains(documentQueries.getByText('0xprepared-price-request'))).toBe(false)
		await act(() => fireEvent.click(documentQueries.getByText('Transaction details', { selector: 'summary' })))
		expect(details.open).toBe(true)
	})

	test('renders complete copyable question identifiers across success notices', async () => {
		const questionId = '0x0000000000000000000000000000000000000000000000000000000000000001'
		const presentations = [
			createMarketCreationSuccessPresentation({ createQuestionHash: '0x1001', marketType: 'binary', questionId }),
			createSecurityPoolCreationWarningPresentation({ deployPoolHash: '0x1002', initialReportPriorityFeeAttoEthPerGas: 10_000_000_000n, questionId, securityPoolAddress: '0x00000000000000000000000000000000000000a1', statoblastSecurityMultiplierBps: 20_000n, universeId: 0n }, 'Pool created with a warning.'),
		]
		const renderedComponent = await renderIntoDocument(
			<>
				{presentations.map(presentation => (
					<GlobalTransactionDialog key={presentation.hash} transaction={presentation} />
				))}
			</>,
		)
		trackRendered(renderedComponent)

		const identifierButtons = within(document.body).getAllByRole('button', { name: `Copy identifier ${questionId}` })
		expect(identifierButtons).toHaveLength(2)
		for (const identifierButton of identifierButtons) expect(identifierButton.textContent).toBe(questionId)
	})

	test('renders a dismissible pending transaction with its explanation and hash', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionDialog
				transaction={{
					detail: 'Waiting for confirmation.',
					dismissKey: 'pending-question-creation',
					hash: '0x2234000000000000000000000000000000000000000000000000000000000000',
					title: 'Creating question',
					tone: 'pending',
				}}
			/>,
		)
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Hide' }) !== null).toBe(true)
		expect(documentQueries.getByRole('status', { name: 'Transaction status' })).not.toBeNull()
		expect(documentQueries.getByText('Pending')).not.toBeNull()
		expect(documentQueries.getByText('Waiting for confirmation.')).not.toBeNull()
		expect(documentQueries.getByText('0x2234000000000000000000000000000000000000000000000000000000000000')).not.toBeNull()
	})

	test('renders a concise pending transaction when no extra explanation is needed', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionDialog
				transaction={{
					hash: '0x2234000000000000000000000000000000000000000000000000000000000001',
					title: 'Creating question',
					tone: 'pending',
				}}
			/>,
		)
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Creating question')).not.toBeNull()
		expect(documentQueries.getByText('Pending')).not.toBeNull()
		expect(document.body.querySelector('.global-transaction-notice-detail')).toBeNull()
	})

	test('keeps a wallet-awaiting request out of the way of app review', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionDialog
				transaction={{
					detail: 'Confirm the transaction in your wallet.',
					dismissKey: 'transaction-request-wallet-close',
					title: 'Creating question',
					tone: 'awaiting-wallet',
				}}
			/>,
		)
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('dialog')).toBeNull()
	})

	test('shows a terminal failure after a wallet-awaiting transaction resolves', async () => {
		const dismissKey = 'transaction-request-wallet-terminal'
		const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={{ dismissKey, title: 'Creating question', tone: 'awaiting-wallet' }} />)
		trackRendered(renderedComponent)

		expect(within(document.body).queryByRole('dialog')).toBeNull()

		await act(() => {
			render(<GlobalTransactionDialog transaction={{ detail: 'Action canceled in wallet.', dismissKey, title: 'Creating question', tone: 'error' }} />, renderedComponent.container)
		})

		expect(within(document.body).getByText('Failed')).not.toBeNull()
		expect(within(document.body).getByText('Action canceled in wallet.')).not.toBeNull()
	})

	test('keeps simulation preparation out of the way of the form', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionDialog
				transaction={{
					detail: 'Submitting in browser simulation. No wallet confirmation is required.',
					dismissKey: 'transaction-request-1',
					title: 'Creating question',
					tone: 'preparing',
				}}
			/>,
		)
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('dialog')).toBeNull()
	})

	test('renders a failed pre-submit transaction with the failure reason and dismiss control', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionDialog
				transaction={{
					detail: 'Action canceled in wallet.',
					dismissKey: 'transaction-request-2',
					title: 'Creating question',
					tone: 'error',
				}}
			/>,
		)
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('alert')).not.toBeNull()
		expect(documentQueries.getByText('Failed')).not.toBeNull()
		expect(documentQueries.getByText('Action canceled in wallet.')).not.toBeNull()
		expect(documentQueries.queryByRole('link')).toBeNull()
		const dismissButton = documentQueries.getByRole('button', { name: 'Dismiss' })
		expect(dismissButton.classList.contains('primary')).toBe(true)
		expect(dismissButton.parentElement?.classList.contains('global-transaction-actions')).toBe(true)
		await act(() => fireEvent.click(dismissButton))
		expect(documentQueries.queryByRole('dialog')).toBeNull()
	})

	test('does not hide a new request-scoped failure after the tray remounts', async () => {
		const transaction = {
			detail: 'Action canceled in wallet.',
			dismissKey: 'transaction-request-remount-collision',
			title: 'Creating question',
			tone: 'error' as const,
		}
		const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={transaction} />)
		trackRendered(renderedComponent)

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Dismiss' }))
		})
		await act(() => {
			renderedComponent.unmount()
		})

		const rerenderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={transaction} />)
		trackRendered(rerenderedComponent)
		expect(within(document.body).getByRole('alert')).not.toBeNull()
		expect(within(document.body).getByText('Action canceled in wallet.')).not.toBeNull()
	})

	test('renders a failed submitted transaction with both the failure reason and hash link', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionDialog
				transaction={{
					detail: 'Transaction reverted',
					dismissKey: '0x4234000000000000000000000000000000000000000000000000000000000000',
					hash: '0x4234000000000000000000000000000000000000000000000000000000000000',
					title: 'Creating question',
					tone: 'error',
				}}
			/>,
		)
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Failed')).not.toBeNull()
		expect(documentQueries.getByText('Transaction reverted')).not.toBeNull()
		expect(documentQueries.getByText('0x4234000000000000000000000000000000000000000000000000000000000000')).not.toBeNull()
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
		const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={transaction} />)
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Dismiss' }))
		})
		expect(renderedComponent.container.textContent).toBe('')

		await act(() => {
			renderedComponent.unmount()
		})

		const rerenderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={transaction} />)
		trackRendered(rerenderedComponent)
		expect(rerenderedComponent.container.textContent).toBe('')
	})

	test('remembers a production-shaped hash-backed completion without hiding a fresh request failure', async () => {
		const intent = {
			action: 'createMarket',
			requiresWalletConfirmation: false,
			source: 'zoltar',
			submittedTitle: 'Creating question',
		}
		const hash = '0xa234000000000000000000000000000000000000000000000000000000000000' as const
		let transactionState = markTransactionRequested(createInitialTransactionTrayState(), intent)
		transactionState = markTransactionSubmitted(transactionState, hash)
		transactionState = markTransactionPresented(transactionState, {
			dismissKey: hash,
			hash,
			title: 'Question created',
			tone: 'success',
		})
		const completedTransaction = transactionState.active
		if (completedTransaction === undefined) throw new Error('Completed transaction should be active')
		expect(completedTransaction.operationKey).toBe('transaction-request-1')

		const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={completedTransaction} />)
		trackRendered(renderedComponent)
		await act(() => {
			fireEvent.click(within(renderedComponent.container).getByRole('button', { name: 'Dismiss' }))
		})
		await renderedComponent.cleanup()

		const remountedCompletion = await renderIntoDocument(<GlobalTransactionDialog transaction={completedTransaction} />)
		expect(remountedCompletion.container.textContent).toBe('')
		await remountedCompletion.cleanup()

		const freshRequestFailure = markTransactionFailed(markTransactionRequested(createInitialTransactionTrayState(), intent), 'Action canceled in wallet.').active
		if (freshRequestFailure === undefined) throw new Error('Fresh request failure should be active')
		expect(freshRequestFailure.operationKey).toBe('transaction-request-1')
		const freshRequestTray = await renderIntoDocument(<GlobalTransactionDialog transaction={freshRequestFailure} />)
		trackRendered(freshRequestTray)
		expect(within(freshRequestTray.container).getByRole('alert')).not.toBeNull()
		expect(within(freshRequestTray.container).getByText('Action canceled in wallet.')).not.toBeNull()
	})

	test('evicts the oldest remembered dismissal after the bounded limit', async () => {
		const createTransaction = (index: number) => ({
			dismissKey: `dismissal-cap-${index.toString()}`,
			title: `Completed transaction ${index.toString()}`,
			tone: 'success' as const,
		})
		const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={createTransaction(0)} />)
		trackRendered(renderedComponent)

		for (let index = 0; index <= 100; index += 1) {
			await act(() => {
				render(<GlobalTransactionDialog transaction={createTransaction(index)} />, renderedComponent.container)
			})
			await act(() => {
				fireEvent.click(within(renderedComponent.container).getByRole('button', { name: 'Dismiss' }))
			})
		}
		await renderedComponent.cleanup()

		const evictedTransaction = await renderIntoDocument(<GlobalTransactionDialog transaction={createTransaction(0)} />)
		expect(within(evictedTransaction.container).getByText('Completed transaction 0')).not.toBeNull()
		await evictedTransaction.cleanup()

		const rememberedTransaction = await renderIntoDocument(<GlobalTransactionDialog transaction={createTransaction(100)} />)
		trackRendered(rememberedTransaction)
		expect(rememberedTransaction.container.textContent).toBe('')
	})

	test('keeps a pending transaction visible when remounted with the same hash', async () => {
		const transaction = {
			detail: 'Waiting for confirmation.',
			hash: '0x5234000000000000000000000000000000000000000000000000000000000000' as const,
			title: 'Creating question',
			tone: 'pending' as const,
		}
		const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={transaction} />)
		trackRendered(renderedComponent)

		expect(within(document.body).getByText('Pending')).not.toBeNull()
		expect(within(document.body).getByText(transaction.hash)).not.toBeNull()

		await act(() => {
			renderedComponent.unmount()
		})

		const rerenderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={transaction} />)
		trackRendered(rerenderedComponent)
		expect(within(document.body).getByText('Pending')).not.toBeNull()
		expect(within(document.body).getByText(transaction.hash)).not.toBeNull()
	})

	test('shows terminal success after a pending transaction resolves', async () => {
		const hash = '0x6234000000000000000000000000000000000000000000000000000000000000' as const
		const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog transaction={{ hash, title: 'Creating question', tone: 'pending' }} />)
		trackRendered(renderedComponent)

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Hide' }))
		})
		expect(within(document.body).queryByText('Pending')).toBeNull()

		await act(() => {
			render(<GlobalTransactionDialog transaction={{ hash, title: 'Question created', tone: 'success' }} />, renderedComponent.container)
		})

		expect(within(document.body).getByText('Confirmed')).not.toBeNull()
		expect(within(document.body).getByText('Question created')).not.toBeNull()
	})

	test('returns a failed transaction to its submission form after navigation', async () => {
		const hash = '0xa234000000000000000000000000000000000000000000000000000000000000' as const
		window.location.hash = '#/zoltar?zoltarView=create'
		const renderedComponent = await renderIntoDocument(<GlobalTransactionDialog routeKey='zoltar:create' transaction={{ hash, title: 'Creating question', tone: 'pending' }} />)
		trackRendered(renderedComponent)

		window.location.hash = '#/security-pools?securityPoolsView=browse'
		await act(() => {
			render(<GlobalTransactionDialog routeKey='security-pools:browse' transaction={{ hash, title: 'Creating question', tone: 'pending' }} />, renderedComponent.container)
		})
		await act(() => {
			render(<GlobalTransactionDialog routeKey='security-pools:browse' transaction={{ detail: 'Transaction reverted', hash, title: 'Creating question', tone: 'error' }} />, renderedComponent.container)
		})

		expect(within(document.body).getByRole('dialog', { name: 'Transaction status' })).not.toBeNull()
		expect(within(document.body).getByText('Transaction reverted')).not.toBeNull()
		expect(within(document.body).queryByRole('button', { name: 'Review and retry' })).toBeNull()
		await act(() => {
			fireEvent.click(within(document.body).getByRole('link', { name: 'Back to form' }))
		})
		expect(window.location.hash).toBe('#/zoltar?zoltarView=create')
		expect(renderedComponent.container.textContent).toContain('Creating question')
	})
})

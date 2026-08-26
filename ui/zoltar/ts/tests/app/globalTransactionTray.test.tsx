/// <reference types='bun-types' />

import { beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { GlobalTransactionTray } from '@zoltar/ui-core-shared/app/components/GlobalTransactionTray.js'
import { createMarketCreationSuccessPresentation, createMarketCreationTransactionIntent, createZoltarForkSuccessPresentation } from '../../features/transactionPresentations.js'
import { installDomTestLifecycle } from '@zoltar/ui-core-shared/tests/testUtils/domTestLifecycle.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { installTestRouting } from '@zoltar/ui-core-shared/tests/testUtils/testRouting.js'
import { createInitialTransactionTrayState, markTransactionFailed, markTransactionPresented, markTransactionRequested, markTransactionSubmitted } from '@zoltar/ui-core-shared/lib/transactionTray.js'

describe('GlobalTransactionTray', () => {
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

	test('does not render when there is no submitted transaction', async () => {
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={undefined} />)
		trackRendered(renderedComponent)

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
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('status')).not.toBeNull()
		expect(documentQueries.getByText('Question Created')).not.toBeNull()
		expect(documentQueries.getByText('The new question is now on-chain.')).not.toBeNull()
		expect(documentQueries.getByText('Question ID')).not.toBeNull()
		expect(documentQueries.getByText('0x0b')).not.toBeNull()
		expect(documentQueries.getByRole('link', { name: '0x1234000000000000000000000000000000000000000000000000000000000000' })).not.toBeNull()
		expect(documentQueries.getByRole('button', { name: 'Dismiss' })).not.toBeNull()
	})

	test('warns when transaction lifecycle state belongs to a different header universe', async () => {
		const intent = createMarketCreationTransactionIntent({ marketType: 'binary', universeId: 7n })
		const requested = markTransactionRequested(createInitialTransactionTrayState(), intent)
		const submitted = markTransactionSubmitted(requested, '0xb234000000000000000000000000000000000000000000000000000000000000')
		const failed = markTransactionFailed(submitted, 'Transaction reverted')
		const success = createMarketCreationSuccessPresentation({ createQuestionHash: '0xb234000000000000000000000000000000000000000000000000000000000000', marketType: 'binary', questionId: '0x01' }, { universeId: 7n })
		const lifecyclePresentations = [requested.active, submitted.active, failed.active, success]
		if (lifecyclePresentations.some(presentation => presentation === undefined)) throw new Error('Transaction lifecycle presentation should be defined')

		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray activeUniverseId={7n} transaction={requested.active} />)
		trackRendered(renderedComponent)
		expect(within(document.body).queryByText('Transaction universe mismatch')).toBeNull()
		await act(() => {
			render(<GlobalTransactionTray activeUniverseId={8n} transaction={{ ...success, universeId: undefined }} />, renderedComponent.container)
		})
		expect(within(document.body).queryByText('Transaction universe mismatch')).toBeNull()

		for (const presentation of lifecyclePresentations) {
			await act(() => {
				render(<GlobalTransactionTray activeUniverseId={8n} transaction={presentation} />, renderedComponent.container)
			})
			const documentQueries = within(document.body)
			expect(documentQueries.getByText('Transaction universe mismatch')).not.toBeNull()
			expect(documentQueries.getByText('This transaction belongs to 0x7, while the header shows 0x8.')).not.toBeNull()
			expect(presentation?.rows?.map(row => row.label)).not.toContain('Universe')
		}
	})

	test('reserves the transaction tray height in the viewport scroll area', async () => {
		const renderedComponent = await renderIntoDocument(
			<main>
				<GlobalTransactionTray transaction={{ dismissKey: 'reserved-space', title: 'Question Created', tone: 'success' }} />
			</main>,
		)
		trackRendered(renderedComponent)

		expect(document.documentElement.style.scrollPaddingBottom).not.toBe('')
		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Dismiss' }))
		})
		expect(document.documentElement.style.scrollPaddingBottom).toBe('')
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
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Security Pool Address')).not.toBeNull()
		expect(documentQueries.getByText('0xpool')).not.toBeNull()
		expect(documentQueries.getByText('Technical details', { selector: 'summary' })).not.toBeNull()
		expect(documentQueries.getByText('Arguments')).not.toBeNull()
	})

	test('renders complete copyable question identifiers across success notices', async () => {
		const questionId = '0x0000000000000000000000000000000000000000000000000000000000000001'
		const presentations = [createMarketCreationSuccessPresentation({ createQuestionHash: '0x1001', marketType: 'binary', questionId }), createZoltarForkSuccessPresentation({ action: 'forkZoltar', hash: '0x1002', questionId, universeId: 0n })]
		const renderedComponent = await renderIntoDocument(
			<>
				{presentations.map(presentation => (
					<GlobalTransactionTray key={presentation.hash} transaction={presentation} />
				))}
			</>,
		)
		trackRendered(renderedComponent)

		const identifierButtons = within(document.body).getAllByRole('button', { name: `Copy identifier ${questionId}` })
		expect(identifierButtons).toHaveLength(2)
		for (const identifierButton of identifierButtons) expect(identifierButton.textContent).toBe(questionId)
	})

	test('renders a pending transaction with its explanation and hash but no dismiss control', async () => {
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionTray
				transaction={{
					detail: 'Waiting for confirmation.',
					dismissKey: 'pending-question-creation',
					hash: '0x2234000000000000000000000000000000000000000000000000000000000000',
					title: 'Creating Question',
					tone: 'pending',
				}}
			/>,
		)
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: 'Dismiss' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Close transaction status' })).toBeNull()
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
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Creating Question')).not.toBeNull()
		expect(documentQueries.getByText('Pending')).not.toBeNull()
		expect(document.body.querySelector('.global-transaction-notice-detail')).toBeNull()
	})

	test('keeps a wallet-awaiting transaction visible with a spinner', async () => {
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
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.getByText('Awaiting Wallet')).not.toBeNull()
		expect(documentQueries.getByText('Confirm the transaction in your wallet.')).not.toBeNull()
		expect(document.body.querySelector('.global-transaction-spinner')).not.toBeNull()
		expect(documentQueries.queryByRole('link')).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Dismiss' })).toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'Close transaction status' })).toBeNull()
	})

	test('shows a terminal failure after a wallet-awaiting transaction resolves', async () => {
		const dismissKey = 'transaction-request-wallet-terminal'
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={{ dismissKey, title: 'Creating Question', tone: 'awaiting-wallet' }} />)
		trackRendered(renderedComponent)

		expect(within(document.body).queryByRole('button', { name: 'Close transaction status' })).toBeNull()

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
		trackRendered(renderedComponent)

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
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('alert')).not.toBeNull()
		expect(documentQueries.getByText('Failed')).not.toBeNull()
		expect(documentQueries.getByText('Action canceled in wallet.')).not.toBeNull()
		expect(documentQueries.queryByRole('link')).toBeNull()
		const dismissButton = documentQueries.getByRole('button', { name: 'Dismiss' })
		expect(dismissButton.parentElement?.classList.contains('global-transaction-actions')).toBe(true)
	})

	test('does not hide a new request-scoped failure after the tray remounts', async () => {
		const transaction = {
			detail: 'Action canceled in wallet.',
			dismissKey: 'transaction-request-remount-collision',
			title: 'Creating Question',
			tone: 'error' as const,
		}
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={transaction} />)
		trackRendered(renderedComponent)

		await act(() => {
			fireEvent.click(within(document.body).getByRole('button', { name: 'Dismiss' }))
		})
		await act(() => {
			renderedComponent.unmount()
		})

		const rerenderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={transaction} />)
		trackRendered(rerenderedComponent)
		expect(within(document.body).getByRole('alert')).not.toBeNull()
		expect(within(document.body).getByText('Action canceled in wallet.')).not.toBeNull()
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
		trackRendered(renderedComponent)

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
		trackRendered(renderedComponent)

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'Dismiss' }))
		})
		expect(renderedComponent.container.textContent).toBe('')

		await act(() => {
			renderedComponent.unmount()
		})

		const rerenderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={transaction} />)
		trackRendered(rerenderedComponent)
		expect(rerenderedComponent.container.textContent).toBe('')
	})

	test('remembers a production-shaped hash-backed completion without hiding a fresh request failure', async () => {
		const intent = {
			action: 'createMarket',
			requiresWalletConfirmation: false,
			source: 'zoltar',
			submittedTitle: 'Creating Question',
		}
		const hash = '0xa234000000000000000000000000000000000000000000000000000000000000' as const
		let transactionState = markTransactionRequested(createInitialTransactionTrayState(), intent)
		transactionState = markTransactionSubmitted(transactionState, hash)
		transactionState = markTransactionPresented(transactionState, {
			dismissKey: hash,
			hash,
			title: 'Question Created',
			tone: 'success',
		})
		const completedTransaction = transactionState.active
		if (completedTransaction === undefined) throw new Error('Completed transaction should be active')
		expect(completedTransaction.operationKey).toBe('transaction-request-1')

		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={completedTransaction} />)
		trackRendered(renderedComponent)
		await act(() => {
			fireEvent.click(within(renderedComponent.container).getByRole('button', { name: 'Dismiss' }))
		})
		await renderedComponent.cleanup()

		const remountedCompletion = await renderIntoDocument(<GlobalTransactionTray transaction={completedTransaction} />)
		expect(remountedCompletion.container.textContent).toBe('')
		await remountedCompletion.cleanup()

		const freshRequestFailure = markTransactionFailed(markTransactionRequested(createInitialTransactionTrayState(), intent), 'Action canceled in wallet.').active
		if (freshRequestFailure === undefined) throw new Error('Fresh request failure should be active')
		expect(freshRequestFailure.operationKey).toBe('transaction-request-1')
		const freshRequestTray = await renderIntoDocument(<GlobalTransactionTray transaction={freshRequestFailure} />)
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
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={createTransaction(0)} />)
		trackRendered(renderedComponent)

		for (let index = 0; index <= 100; index += 1) {
			await act(() => {
				render(<GlobalTransactionTray transaction={createTransaction(index)} />, renderedComponent.container)
			})
			await act(() => {
				fireEvent.click(within(renderedComponent.container).getByRole('button', { name: 'Dismiss' }))
			})
		}
		await renderedComponent.cleanup()

		const evictedTransaction = await renderIntoDocument(<GlobalTransactionTray transaction={createTransaction(0)} />)
		expect(within(evictedTransaction.container).getByText('Completed transaction 0')).not.toBeNull()
		await evictedTransaction.cleanup()

		const rememberedTransaction = await renderIntoDocument(<GlobalTransactionTray transaction={createTransaction(100)} />)
		trackRendered(rememberedTransaction)
		expect(rememberedTransaction.container.textContent).toBe('')
	})

	test('keeps a pending transaction visible when remounted with the same hash', async () => {
		const transaction = {
			detail: 'Waiting for confirmation.',
			hash: '0x5234000000000000000000000000000000000000000000000000000000000000' as const,
			title: 'Creating Question',
			tone: 'pending' as const,
		}
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={transaction} />)
		trackRendered(renderedComponent)

		expect(within(document.body).getByText('Pending')).not.toBeNull()
		expect(within(document.body).getByRole('link', { name: transaction.hash })).not.toBeNull()

		await act(() => {
			renderedComponent.unmount()
		})

		const rerenderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={transaction} />)
		trackRendered(rerenderedComponent)
		expect(within(document.body).getByText('Pending')).not.toBeNull()
		expect(within(document.body).getByRole('link', { name: transaction.hash })).not.toBeNull()
	})

	test('shows terminal success after a pending transaction resolves', async () => {
		const hash = '0x6234000000000000000000000000000000000000000000000000000000000000' as const
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray transaction={{ hash, title: 'Creating Question', tone: 'pending' }} />)
		trackRendered(renderedComponent)

		expect(within(document.body).queryByRole('button', { name: 'Close transaction status' })).toBeNull()

		await act(() => {
			render(<GlobalTransactionTray transaction={{ hash, title: 'Question Created', tone: 'success' }} />, renderedComponent.container)
		})

		expect(within(document.body).getByText('Confirmed')).not.toBeNull()
		expect(within(document.body).getByText('Question Created')).not.toBeNull()
	})

	test('compacts a completed transaction after navigation while keeping details available', async () => {
		const transaction = {
			dismissKey: 'question-created-route-handoff',
			hash: '0x7234000000000000000000000000000000000000000000000000000000000000' as const,
			rows: [{ label: 'Question ID', value: '0x01' }],
			title: 'Question Created',
			tone: 'success' as const,
		}
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray routeKey='zoltar:create' transaction={transaction} />)
		trackRendered(renderedComponent)

		expect(document.body.querySelector('.global-transaction-notice-compact')).toBeNull()

		await act(() => {
			render(<GlobalTransactionTray routeKey='security-pools:create' transaction={transaction} />, renderedComponent.container)
		})

		const compactNotice = document.body.querySelector('.global-transaction-notice-compact')
		expect(compactNotice).not.toBeNull()
		expect(within(document.body).getByText('Question Created')).not.toBeNull()
		expect(within(document.body).getByText('View transaction details', { selector: 'summary' })).not.toBeNull()
		expect(within(document.body).getByText('Question ID')).not.toBeNull()
		expect(within(document.body).queryByRole('button', { name: 'Dismiss' })).toBeNull()
		expect(within(document.body).getByRole('button', { name: 'Close transaction status' })).not.toBeNull()
	})

	test('keeps the submission route as the origin when navigation happens before confirmation', async () => {
		const hash = '0x8234000000000000000000000000000000000000000000000000000000000000' as const
		const renderedComponent = await renderIntoDocument(<GlobalTransactionTray routeKey='zoltar:create' transaction={{ hash, title: 'Creating Question', tone: 'pending' }} />)
		trackRendered(renderedComponent)

		await act(() => {
			render(<GlobalTransactionTray routeKey='zoltar:fork' transaction={{ hash, title: 'Creating Question', tone: 'pending' }} />, renderedComponent.container)
		})
		expect(document.body.querySelector('.global-transaction-notice-compact')).toBeNull()

		await act(() => {
			render(<GlobalTransactionTray routeKey='zoltar:fork' transaction={{ hash, title: 'Question Created', tone: 'success' }} />, renderedComponent.container)
		})

		expect(document.body.querySelector('.global-transaction-notice-compact')).not.toBeNull()
	})

	test('keeps the request route as the origin when the transaction gains a hash after navigation', async () => {
		const operationKey = 'transaction-request-before-navigation'
		const hash = '0x9234000000000000000000000000000000000000000000000000000000000000' as const
		const renderedComponent = await renderIntoDocument(
			<GlobalTransactionTray
				routeKey='zoltar:create'
				transaction={{
					dismissKey: operationKey,
					operationKey,
					title: 'Creating Question',
					tone: 'awaiting-wallet',
				}}
			/>,
		)
		trackRendered(renderedComponent)

		await act(() => {
			render(
				<GlobalTransactionTray
					routeKey='zoltar:fork'
					transaction={{
						dismissKey: operationKey,
						operationKey,
						title: 'Creating Question',
						tone: 'awaiting-wallet',
					}}
				/>,
				renderedComponent.container,
			)
		})

		await act(() => {
			render(
				<GlobalTransactionTray
					routeKey='zoltar:fork'
					transaction={{
						dismissKey: hash,
						hash,
						operationKey,
						title: 'Creating Question',
						tone: 'pending',
					}}
				/>,
				renderedComponent.container,
			)
		})

		await act(() => {
			render(
				<GlobalTransactionTray
					routeKey='zoltar:fork'
					transaction={{
						dismissKey: hash,
						hash,
						operationKey,
						title: 'Question Created',
						tone: 'success',
					}}
				/>,
				renderedComponent.container,
			)
		})

		expect(document.body.querySelector('.global-transaction-notice-compact')).not.toBeNull()
	})
})

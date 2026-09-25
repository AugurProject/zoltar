import { signal } from '@preact/signals'
import type { GlobalTransactionPresentation } from '@zoltar/ui-core-shared/types/components.js'
import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { GlobalTransactionPresentationProvider } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { GlobalTransactionDialog } from '@zoltar/ui-core-shared/app/components/GlobalTransactionDialog.js'
import { afterEach, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { createWalletClient, custom, getAddress, publicActions, type Hash, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { installActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { createReviewedClient } from '@zoltar/ui-statoblast-shared/protocol/reviewedClient.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { RequestPriceModal } from '../../app/transactions/RequestPriceModal.js'
import { TransactionStepsModal, embeddedTransactionSteps } from '@zoltar/ui-core-shared/components/TransactionStepsModal.js'
import { createTransactionStepController, transactionSteps } from '@zoltar/ui-core-shared/transactions/transactionSteps.js'
import type { RequestPriceReview } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolOracleSections.js'

const review: RequestPriceReview = { managerAddress: getAddress('0x0000000000000000000000000000000000000001'), securityPoolAddress: getAddress('0x0000000000000000000000000000000000000002'), universeId: 0n, requestValueAttoEth: 12n }
const props = { review, canRequest: true, pending: false, confirmationGuardMessage: undefined, closeOnSuccessKey: undefined, onClose: () => undefined, fetchPrice: async () => 2n * 10n ** 18n }
const step = { contractAddress: undefined, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 12n, description: 'Fund the report.' }

function inputValue(element: HTMLElement) {
	if (!(element instanceof HTMLInputElement)) throw new Error('Expected price input')
	return element.value
}

async function settle() {
	for (let attempt = 0; attempt < 20; attempt += 1) await act(async () => await new Promise(resolve => setTimeout(resolve, 25)))
}

afterEach(() => {
	transactionSteps.value?.cancel()
	embeddedTransactionSteps.value = undefined
})

test('closes after confirmation and permits a new request when reopened after status dismissal', async () => {
	const dom = installDomEnvironment()
	const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
	const completedHash = signal<string | undefined>(undefined)
	const activeReview = signal<typeof review | undefined>(review)
	const requestAllowed = signal(true)
	const guard = signal<string | undefined>(undefined)
	const hash = '0x3333333333333333333333333333333333333333333333333333333333333333'
	let controller: ReturnType<typeof createTransactionStepController> | undefined
	let closed = false
	let attempts = 0
	function Harness() {
		return (
			<GlobalTransactionPresentationProvider transaction={presentation.value}>
				<RequestPriceModal
					{...props}
					review={activeReview.value}
					canRequest={requestAllowed.value}
					confirmationGuardMessage={guard.value}
					closeOnSuccessKey={completedHash.value}
					onClose={() => {
						closed = true
						activeReview.value = undefined
					}}
					onConfirm={async (_request, signal) => {
						attempts += 1
						controller = createTransactionStepController(signal)
						controller.setPlan([{ ...step, title: 'Request new price' }])
						controller.startWithoutReview(0)
					}}
				/>
				<GlobalTransactionDialog routeKey='security-pools' transaction={presentation.value} />
			</GlobalTransactionPresentationProvider>
		)
	}
	const rendered = await renderIntoDocument(<Harness />)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '3' } }))
		await settle()
		if (controller === undefined) throw new Error('Missing price request controller')
		await act(() => {
			controller?.submitted(hash)
			controller?.receipt(hash, 'success')
			presentation.value = { tone: 'pending', title: 'Requesting new price…', hash, operationKey: 'price-request' }
			requestAllowed.value = false
			guard.value = 'A price request is already pending.'
		})
		await settle()
		const dialogBeforeResult = queries.getByRole('dialog', { name: 'Request new price' })
		const pendingStatus = queries.getByRole('status', { name: 'Transaction status' })
		expect(pendingStatus.textContent).toContain('Pending')
		expect(within(pendingStatus).getByText(hash)).not.toBeNull()
		expect(dialogBeforeResult.textContent).not.toContain(hash)
		expect(within(dialogBeforeResult).getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }).hasAttribute('disabled')).toBe(false)
		await act(() => {
			completedHash.value = hash
			presentation.value = { tone: 'success', title: 'Price requested', hash, operationKey: 'price-request', rows: [{ label: 'Security Pool Address', value: review.securityPoolAddress }] }
		})
		await settle()
		expect(closed).toBe(true)
		expect(queries.getByRole('dialog', { name: 'Transaction status' }).textContent).toContain('Price requested')
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Dismiss' })))
		await act(() => {
			activeReview.value = review
			requestAllowed.value = true
			guard.value = undefined
		})
		await settle()
		expect(activeReview.value).toBe(review)
		expect(queries.getByRole('dialog', { name: 'Request new price' })).not.toBeNull()
		expect(attempts).toBe(2)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('keeps focus inside the price dialog when the request action becomes pending status', async () => {
	const dom = installDomEnvironment()
	const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
	let controller: ReturnType<typeof createTransactionStepController> | undefined
	const hash = '0x4444444444444444444444444444444444444444444444444444444444444444'
	function Harness() {
		return (
			<GlobalTransactionPresentationProvider transaction={presentation.value}>
				<RequestPriceModal
					{...props}
					onConfirm={async (_request, signal) => {
						controller = createTransactionStepController(signal)
						controller.setPlan([{ ...step, title: 'Request new price' }])
						await controller.review()
					}}
				/>
				<GlobalTransactionDialog transaction={presentation.value} />
			</GlobalTransactionPresentationProvider>
		)
	}
	const rendered = await renderIntoDocument(<Harness />)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '3' } }))
		await settle()
		const dialog = queries.getByRole('dialog', { name: 'Request new price' })
		const requestButton = within(dialog).getByRole('button', { name: /^Request new price/ })
		requestButton.focus()
		await act(() => fireEvent.click(requestButton))
		expect(transactionSteps.value?.steps[0]?.phase).toBe('wallet')
		expect(document.activeElement?.classList.contains('transaction-plan-action')).toBe(true)
		await act(() => {
			controller?.submitted(hash)
			presentation.value = { tone: 'pending', title: 'Requesting new price…', hash, operationKey: 'price-request' }
		})
		expect(within(queries.getByRole('status', { name: 'Transaction status' })).getByText('Pending')).not.toBeNull()
		expect(document.activeElement?.classList.contains('transaction-plan-action')).toBe(true)
		expect(dialog.textContent).not.toContain(hash)
		const priceInput = within(dialog).getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' })
		priceInput.focus()
		await act(() => {
			presentation.value = { tone: 'pending', title: 'Still requesting price', hash, operationKey: 'price-request' }
		})
		expect(document.activeElement).toBe(priceInput)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('closes after a confirmed request when refreshed pool state clears the review before success is presented', async () => {
	const dom = installDomEnvironment()
	const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
	const successKey = signal<string | undefined>(undefined)
	const requestAllowed = signal(true)
	const guard = signal<string | undefined>(undefined)
	const open = signal(true)
	const hash = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
	let controller: ReturnType<typeof createTransactionStepController> | undefined
	function Harness() {
		return (
			<GlobalTransactionPresentationProvider transaction={presentation.value}>
				<RequestPriceModal
					{...props}
					review={open.value ? review : undefined}
					canRequest={requestAllowed.value}
					confirmationGuardMessage={guard.value}
					closeOnSuccessKey={successKey.value}
					onClose={() => {
						open.value = false
					}}
					onConfirm={async (_request, signal) => {
						controller = createTransactionStepController(signal)
						controller.setPlan([{ ...step, title: 'Request new price' }])
						controller.startWithoutReview(0)
					}}
				/>
				<GlobalTransactionDialog transaction={presentation.value} />
			</GlobalTransactionPresentationProvider>
		)
	}
	const rendered = await renderIntoDocument(<Harness />)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '3' } }))
		await settle()
		if (controller === undefined) throw new Error('Missing price request controller')
		await act(() => {
			controller?.submitted(hash)
			controller?.receipt(hash, 'success')
			presentation.value = { hash, title: 'Requesting new price…', tone: 'pending' }
			requestAllowed.value = false
			guard.value = 'A pending price report already exists for this pool'
		})
		await settle()
		await act(() => transactionSteps.value?.cancel())
		await act(() => {
			successKey.value = hash
			presentation.value = { hash, title: 'Price requested', tone: 'success' }
		})
		await settle()
		expect(open.value).toBe(false)
		expect(queries.queryByRole('dialog', { name: 'Request new price' })).toBeNull()
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('prepares approval and request actions alongside editable price controls in a single dialog', async () => {
	const dom = installDomEnvironment()
	const prices: Array<bigint | undefined> = []
	let submitted = 0
	const onConfirm = async (request: RequestPriceReview, signal?: AbortSignal) => {
		prices.push(request.proposedRepPerEthPrice)
		const controller = createTransactionStepController(signal)
		controller.setPlan([
			{ ...step, title: 'Approve REP spending', approval: { requiredAmount: 3n, approvedAmount: 0n, tokenSymbol: 'REP', tokenUnits: 0 } },
			{
				...step,
				title: 'Request new price',
				proposedRepPerEthPrice: request.proposedRepPerEthPrice ?? 2n * 10n ** 18n,
				tokenFunding: [
					{ amount: '2 REP', limit: undefined },
					{ amount: '1 WETH', limit: undefined },
				],
			},
		])
		try {
			await controller.review()
			submitted += 1
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes('canceled')) throw error
		}
	}
	const rendered = await renderIntoDocument(
		<>
			<RequestPriceModal {...props} onConfirm={onConfirm} />
			<TransactionStepsModal contextKey='wallet' />
		</>,
	)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		expect(queries.getAllByRole('dialog')).toHaveLength(1)
		expect(queries.getByRole('button', { name: /Approve.*REP/ })).not.toBeNull()
		expect(queries.getByRole('button', { name: /Request new price/ })).not.toBeNull()
		expect(queries.queryByRole('button', { name: 'Review funding and steps' })).toBeNull()
		expect(submitted).toBe(0)
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '' } }))
		expect(queries.queryByRole('button', { name: /Approve.*REP/ })).toBeNull()
		expect(document.querySelector('.transaction-funding')).toBeNull()
		for (const value of ['0', '-1', 'abc', '0.0000000000000000001', (2n ** 256n).toString()]) {
			await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value } }))
			expect(queries.getByText('Enter a positive REP per ETH price with up to 18 decimal places.')).not.toBeNull()
			expect(queries.getByRole('button', { name: /Request new price/ }).hasAttribute('disabled')).toBe(true)
		}
		const priceInput = queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' })
		priceInput.focus()
		await act(() => fireEvent.input(priceInput, { target: { value: '1.25' } }))
		await settle()
		expect(prices).toEqual([2n * 10n ** 18n, 1_250_000_000_000_000_000n])
		expect(document.activeElement).toBe(priceInput)
		expect(queries.getAllByRole('dialog')).toHaveLength(1)
		expect(submitted).toBe(0)
		await act(async () => {
			fireEvent.click(queries.getByRole('button', { name: /Approve.*REP/ }))
			await Promise.resolve()
		})
		expect(submitted).toBe(1)
		expect(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }).hasAttribute('disabled')).toBe(false)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('cancels a late preparation after closing without exposing a transaction dialog or sending', async () => {
	const dom = installDomEnvironment()
	let release = () => undefined
	const delayed = new Promise<void>(resolve => {
		release = resolve
	})
	let submitted = false
	const onConfirm = async (_request: RequestPriceReview, signal?: AbortSignal) => {
		await delayed
		const controller = createTransactionStepController(signal)
		controller.setPlan([{ ...step, title: 'Request new price' }])
		try {
			await controller.review()
			submitted = true
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes('canceled')) throw error
		}
	}
	const rendered = await renderIntoDocument(
		<>
			<RequestPriceModal {...props} onConfirm={onConfirm} />
			<TransactionStepsModal contextKey='wallet' />
		</>,
	)
	try {
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		await act(() =>
			render(
				<>
					<RequestPriceModal {...props} review={undefined} onConfirm={onConfirm} />
					<TransactionStepsModal contextKey='wallet' />
				</>,
				rendered.container,
			),
		)
		await act(async () => {
			release()
			await delayed
		})
		expect(submitted).toBe(false)
		expect(transactionSteps.value).toBeUndefined()
		expect(within(document.body).queryByRole('dialog')).toBeNull()
		expect(embeddedTransactionSteps.value).toBeUndefined()
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('shows preparation failure with retry and keeps manual entry available', async () => {
	const dom = installDomEnvironment()
	let attempts = 0
	const onConfirm = async () => {
		attempts += 1
	}
	const preparationFailure: GlobalTransactionPresentation = { tone: 'error', title: 'Price request failed', detail: 'Uniswap quote unavailable.', operationKey: 'price-request-preparation' }
	const rendered = await renderIntoDocument(
		<GlobalTransactionPresentationProvider transaction={preparationFailure}>
			<RequestPriceModal {...props} onConfirm={onConfirm} />
			<GlobalTransactionDialog transaction={preparationFailure} />
		</GlobalTransactionPresentationProvider>,
	)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		const statusDialog = queries.getByRole('dialog', { name: 'Transaction status' })
		expect(within(statusDialog).getByRole('alert').textContent).toContain('Uniswap quote unavailable.')
		expect(document.querySelector('.price-request-preview .global-transaction-notice')).toBeNull()
		expect(document.querySelector('.price-request-preview')?.textContent).not.toContain('Uniswap quote unavailable.')
		expect(queries.queryByRole('button', { name: 'Review and retry' })).toBeNull()
		expect(attempts).toBe(1)
		const priceInput = queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' })
		expect(inputValue(priceInput)).toBe('2')
		expect(priceInput.hasAttribute('disabled')).toBe(false)
		await act(() => fireEvent.click(within(statusDialog).getByRole('button', { name: 'Dismiss' })))
		expect(queries.queryByRole('dialog', { name: 'Transaction status' })).toBeNull()
		await act(() => fireEvent.click(queries.getByRole('button', { name: /^Request new price/ })))
		await settle()
		expect(attempts).toBe(2)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('allows another price request after a failed transaction step', async () => {
	const dom = installDomEnvironment()
	let attempts = 0
	const prices: bigint[] = []
	const onConfirm = async (request: RequestPriceReview, signal?: AbortSignal) => {
		attempts += 1
		if (request.proposedRepPerEthPrice !== undefined) prices.push(request.proposedRepPerEthPrice)
		const controller = createTransactionStepController(signal)
		controller.setPlan([{ ...step, title: 'Request new price' }])
		controller.startWithoutReview(0)
		controller.failed({ kind: 'error', message: 'nonce too low' })
	}
	const rendered = await renderIntoDocument(<RequestPriceModal {...props} onConfirm={onConfirm} />)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		expect(queries.queryByRole('button', { name: 'Review and retry' })).toBeNull()
		expect(document.querySelector('.price-request-preview .global-transaction-notice')).toBeNull()
		await settle()
		expect(attempts).toBe(1)
		const priceInput = queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' })
		expect(priceInput.hasAttribute('disabled')).toBe(false)
		expect(queries.getByRole('button', { name: /^Request new price/ }).hasAttribute('disabled')).toBe(false)
		expect(inputValue(priceInput)).toBe('2')
		await act(() => fireEvent.input(priceInput, { target: { value: '3' } }))
		await settle()
		expect(attempts).toBe(1)
		await act(() => fireEvent.click(queries.getByRole('button', { name: /^Request new price/ })))
		await settle()
		expect(attempts).toBe(2)
		expect(prices).toEqual([2n * 10n ** 18n, 3n * 10n ** 18n])
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test.each(['dismiss', 'fetch', 'close'] as const)('reports a reverted price request after %s during delayed receipt diagnostics', async action => {
	const dom = installDomEnvironment()
	const restoreEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: review.managerAddress }))
	const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
	const requestAllowed = signal(true)
	const formOpen = signal(true)
	const diagnostic = createDeferred<void>()
	const hashes: Record<typeof action, Hash> = {
		dismiss: '0x4444444444444444444444444444444444444444444444444444444444444444',
		fetch: '0x5555555555555555555555555555555555555555555555555555555555555555',
		close: '0x6666666666666666666666666666666666666666666666666666666666666666',
	}
	const hash = hashes[action]
	const receipt: TransactionReceipt = { blockHash: hash, blockNumber: 1n, cumulativeGasUsed: 21_000n, from: review.managerAddress, gasUsed: 21_000n, logs: [], status: 'reverted', transactionHash: hash, transactionIndex: 0n }
	let attempts = 0
	let quoteReads = 0
	let closed = false
	let submittedSignal: AbortSignal | undefined
	const onConfirm = async (request: RequestPriceReview, reviewSignal?: AbortSignal) => {
		attempts += 1
		if (attempts > 1) return
		submittedSignal = reviewSignal
		const client = createWalletClient({
			account: review.managerAddress,
			chain: MAINNET_NETWORK_PROFILE.chain,
			transport: custom({
				request: async () => {
					throw new Error('Unexpected RPC')
				},
			}),
		}).extend(publicActions)
		const reviewed = createReviewedClient(
			{
				...client,
				estimateGas: async () => 21_000n,
				getTransaction: async () => {
					await diagnostic.promise
					return { hash, from: review.managerAddress, to: review.managerAddress, gas: 22_000n, input: '0x1234', nonce: 0n, value: 0n }
				},
				sendTransaction: async () => hash,
				waitForTransactionReceipt: async () => receipt,
			},
			async () => undefined,
			reviewSignal,
		)
		reviewed.onTransactionPrepared?.({ account: review.managerAddress, chainName: client.chain.name, functionName: 'requestPrice', contractAddress: review.managerAddress, args: [request.proposedRepPerEthPrice], data: '0x1234', value: 12n })
		const submittedHash = await reviewed.sendTransaction({ to: review.managerAddress, data: '0x1234', value: 12n })
		presentation.value = { tone: 'pending', title: 'Requesting new price…', hash, operationKey: 'price-request' }
		requestAllowed.value = false
		const finalReceipt = await reviewed.waitForTransactionReceipt({ hash: submittedHash })
		if (reviewSignal?.aborted) return
		if (finalReceipt.status !== 'reverted') throw new Error('Expected a reverted transaction')
		requestAllowed.value = true
		presentation.value = {
			tone: 'error',
			title: 'Requesting new price…',
			detail: 'Transaction reverted.',
			hash,
			operationKey: 'price-request',
			rows: [
				{ label: 'Security Pool Address', value: review.securityPoolAddress },
				{ label: 'Attempted REP/ETH price', value: '2' },
			],
		}
	}
	function Harness() {
		return (
			<GlobalTransactionPresentationProvider transaction={presentation.value}>
				<RequestPriceModal
					{...props}
					review={formOpen.value ? review : undefined}
					canRequest={requestAllowed.value}
					fetchPrice={async () => {
						quoteReads += 1
						return BigInt(quoteReads + 1) * 10n ** 18n
					}}
					onClose={() => {
						closed = true
						formOpen.value = false
					}}
					onConfirm={onConfirm}
				/>
				<GlobalTransactionDialog transaction={presentation.value} />
			</GlobalTransactionPresentationProvider>
		)
	}
	const rendered = await renderIntoDocument(<Harness />)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		await act(() => fireEvent.click(queries.getByRole('button', { name: /^Request new price/ })))
		await settle()
		expect(transactionSteps.value?.steps[0]?.phase).toBe('failed')
		expect(within(queries.getByRole('dialog', { name: 'Transaction status' })).getByText('Failed')).not.toBeNull()
		expect(queries.getByRole('dialog', { name: 'Transaction status' }).querySelector('.global-transaction-notice-recovery')?.textContent).toBe('Transaction reverted; checking details…')
		await act(() => fireEvent.click(within(queries.getByRole('dialog', { name: 'Transaction status' })).getByRole('button', { name: 'Dismiss' })))
		expect(queries.queryByRole('dialog', { name: 'Transaction status' })).toBeNull()
		if (action !== 'dismiss') {
			const availableAction = action === 'fetch' ? queries.getByRole('button', { name: 'Fetch from Uniswap' }) : within(queries.getByRole('dialog', { name: 'Request new price' })).getByRole('button', { name: 'Close' })
			expect(availableAction.hasAttribute('disabled')).toBe(false)
			await act(() => fireEvent.click(availableAction))
		}
		expect(submittedSignal?.aborted).toBe(false)
		expect(quoteReads).toBe(action === 'fetch' ? 2 : 1)
		expect(closed).toBe(action === 'close')
		await act(async () => diagnostic.resolve())
		await settle()
		const statusDialog = queries.getByRole('dialog', { name: 'Transaction status' })
		expect(within(statusDialog).getByText('Failed')).not.toBeNull()
		expect(within(statusDialog).getByText(hash)).not.toBeNull()
		expect(within(statusDialog).getByText('Attempted REP/ETH price').parentElement?.textContent).toContain('2')
		await act(() => fireEvent.click(within(statusDialog).getByRole('button', { name: 'Dismiss' })))
		if (action === 'close') {
			await act(() => {
				formOpen.value = true
			})
			await settle()
		}
		expect(queries.getByRole('button', { name: /^Request new price/ }).hasAttribute('disabled')).toBe(false)
		expect(inputValue(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }))).toBe(action === 'fetch' ? '3' : '2')
		await act(() => fireEvent.click(queries.getByRole('button', { name: /^Request new price/ })))
		await settle()
		expect(attempts).toBe(2)
	} finally {
		diagnostic.resolve()
		await rendered.cleanup()
		restoreEnvironment()
		dom.cleanup()
	}
})

test.each(['close', 'fetch', 'edit'] as const)('tracks a reverted price request after %s while the wallet submission is unresolved', async action => {
	const dom = installDomEnvironment()
	const restoreEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: review.managerAddress }))
	const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
	const formOpen = signal(true)
	const requestAllowed = signal(true)
	const walletResponse = createDeferred<Hash>()
	const hashes: Record<typeof action, Hash> = {
		close: '0x7777777777777777777777777777777777777777777777777777777777777777',
		fetch: '0x8888888888888888888888888888888888888888888888888888888888888888',
		edit: '0x9999999999999999999999999999999999999999999999999999999999999999',
	}
	const hash = hashes[action]
	const receipt: TransactionReceipt = { blockHash: hash, blockNumber: 1n, cumulativeGasUsed: 21_000n, from: review.managerAddress, gasUsed: 21_000n, logs: [], status: 'reverted', transactionHash: hash, transactionIndex: 0n }
	let attempts = 0
	let quoteReads = 0
	let submittedSignal: AbortSignal | undefined
	const onConfirm = async (request: RequestPriceReview, reviewSignal?: AbortSignal) => {
		attempts += 1
		if (attempts > 1) return
		submittedSignal = reviewSignal
		const client = createWalletClient({
			account: review.managerAddress,
			chain: MAINNET_NETWORK_PROFILE.chain,
			transport: custom({
				request: async () => {
					throw new Error('Unexpected RPC')
				},
			}),
		}).extend(publicActions)
		const reviewed = createReviewedClient(
			{
				...client,
				estimateGas: async () => 21_000n,
				getTransaction: async () => ({ hash, from: review.managerAddress, to: review.managerAddress, gas: 22_000n, input: '0x1234', nonce: 0n, value: 0n }),
				sendTransaction: async () => await walletResponse.promise,
				waitForTransactionReceipt: async () => receipt,
			},
			async () => undefined,
			reviewSignal,
		)
		reviewed.onTransactionPrepared?.({ account: review.managerAddress, chainName: client.chain.name, functionName: 'requestPrice', contractAddress: review.managerAddress, args: [request.proposedRepPerEthPrice], data: '0x1234', value: 12n })
		const submittedHash = await reviewed.sendTransaction({ to: review.managerAddress, data: '0x1234', value: 12n })
		presentation.value = { tone: 'pending', title: 'Requesting new price…', hash, operationKey: 'price-request' }
		requestAllowed.value = false
		const finalReceipt = await reviewed.waitForTransactionReceipt({ hash: submittedHash })
		if (reviewSignal?.aborted) return
		if (finalReceipt.status !== 'reverted') throw new Error('Expected a reverted transaction')
		requestAllowed.value = true
		presentation.value = { tone: 'error', title: 'Requesting new price…', detail: 'Transaction reverted.', hash, operationKey: 'price-request', rows: [{ label: 'Attempted REP/ETH price', value: '2' }] }
	}
	function Harness() {
		return (
			<GlobalTransactionPresentationProvider transaction={presentation.value}>
				<RequestPriceModal
					{...props}
					review={formOpen.value ? review : undefined}
					canRequest={requestAllowed.value}
					fetchPrice={async () => {
						quoteReads += 1
						return BigInt(quoteReads + 1) * 10n ** 18n
					}}
					onClose={() => {
						formOpen.value = false
					}}
					onConfirm={onConfirm}
				/>
				<GlobalTransactionDialog transaction={presentation.value} />
			</GlobalTransactionPresentationProvider>
		)
	}
	const rendered = await renderIntoDocument(<Harness />)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		await act(() => fireEvent.click(queries.getByRole('button', { name: /^Request new price/ })))
		await settle()
		expect(transactionSteps.value?.steps[0]?.phase).toBe('wallet')
		expect(transactionSteps.value?.steps[0]?.hash).toBeUndefined()
		if (action === 'close') await act(() => fireEvent.click(within(queries.getByRole('dialog', { name: 'Request new price' })).getByRole('button', { name: 'Close' })))
		if (action === 'fetch') await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		if (action === 'edit') await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '4' } }))
		expect(submittedSignal?.aborted).toBe(false)
		await act(async () => walletResponse.resolve(hash))
		await settle()
		const status = queries.getByRole('dialog', { name: 'Transaction status' })
		expect(within(status).getByText('Failed')).not.toBeNull()
		expect(within(status).getByText(hash)).not.toBeNull()
		expect(within(status).getByText('Attempted REP/ETH price').parentElement?.textContent).toContain('2')
		await act(() => fireEvent.click(within(status).getByRole('button', { name: 'Dismiss' })))
		if (action === 'close')
			await act(() => {
				formOpen.value = true
			})
		await settle()
		const expectedPrices = { close: '2', fetch: '3', edit: '4' }
		expect(inputValue(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }))).toBe(expectedPrices[action])
		expect(queries.getByRole('button', { name: /^Request new price/ }).hasAttribute('disabled')).toBe(false)
	} finally {
		walletResponse.resolve(hash)
		await rendered.cleanup()
		restoreEnvironment()
		dom.cleanup()
	}
})

test('keeps submitted funding and pool details beside the original action after failure', async () => {
	const dom = installDomEnvironment()
	const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
	const guard = signal<string | undefined>(undefined)
	const onConfirm = async (_request: RequestPriceReview, signal?: AbortSignal) => {
		const controller = createTransactionStepController(signal)
		controller.setPlan([
			{
				...step,
				title: 'Request new price',
				tokenFunding: [
					{ amount: '2 REP', limit: undefined },
					{ amount: '1 WETH', limit: undefined },
				],
				oracleOutcome: { returnToWallet: true, settlerRewardAttoEth: 12n },
			},
		])
		try {
			await controller.review()
			controller.failed({ kind: 'error', message: 'nonce too low' })
			presentation.value = {
				tone: 'error',
				title: 'Requesting new price…',
				detail: 'nonce too low',
				operationKey: 'price-request',
				rows: [
					{ label: 'Security Pool Address', value: review.securityPoolAddress },
					{ label: 'Oracle Manager', value: review.managerAddress },
					{ label: 'Attempted REP/ETH price', value: '2' },
				],
				technicalRows: [{ label: 'Function', value: 'requestPrice' }],
			}
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes('canceled')) throw error
		}
	}
	function Harness() {
		return (
			<GlobalTransactionPresentationProvider transaction={presentation.value}>
				<RequestPriceModal {...props} confirmationGuardMessage={guard.value} onConfirm={onConfirm} />
				<TransactionStepsModal contextKey='wallet' />
				<GlobalTransactionDialog transaction={presentation.value} />
			</GlobalTransactionPresentationProvider>
		)
	}
	const rendered = await renderIntoDocument(<Harness />)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		await act(() => fireEvent.click(queries.getByRole('button', { name: /^Request new price/ })))
		await settle()
		expect(queries.getByRole('alert').textContent).toContain('nonce too low')
		expect(document.querySelector('.price-request-preview .global-transaction-notice')).toBeNull()
		const statusDialog = queries.getByRole('dialog', { name: 'Transaction status' })
		expect(within(statusDialog).getByText('Failed')).not.toBeNull()
		expect(within(statusDialog).getByText('Attempted REP/ETH price')).not.toBeNull()
		expect(within(statusDialog).getByText('2')).not.toBeNull()
		expect(queries.getByText('2 REP')).not.toBeNull()
		expect(queries.getByText('1 WETH')).not.toBeNull()
		expect(within(queries.getByRole('dialog', { name: 'Request new price' })).queryByRole('button', { name: /Approve.*(REP|WETH)/ })).toBeNull()
		expect(within(statusDialog).getByText('Security Pool Address').parentElement?.textContent).toContain(review.securityPoolAddress)
		expect(within(statusDialog).getByText('Oracle Manager').parentElement?.textContent).toContain(review.managerAddress)
		expect(within(statusDialog).getByText('Technical details')).not.toBeNull()
		expect(within(statusDialog).getByText('requestPrice')).not.toBeNull()
		expect(queries.getByRole('button', { name: /^Request new price/ }).hasAttribute('disabled')).toBe(false)
		await act(() => fireEvent.click(within(statusDialog).getByRole('button', { name: 'Dismiss' })))
		await settle()
		expect(queries.queryByRole('dialog', { name: 'Transaction status' })).toBeNull()
		expect(document.querySelector('.price-request-preview')?.textContent).not.toContain('nonce too low')
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '3' } }))
		expect(queries.getByRole('button', { name: /^Request new price/ }).hasAttribute('disabled')).toBe(false)
		guard.value = 'A pending report blocks another request.'
		await settle()
		expect(queries.getByText('A pending report blocks another request.')).not.toBeNull()
		expect(queries.getByRole('button', { name: /^Request new price/ }).hasAttribute('disabled')).toBe(true)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test.each(['preparation', 'transaction step'] as const)('does not restart after a %s failure when the price changes or a new quote arrives', async failure => {
	const dom = installDomEnvironment()
	let attempts = 0
	let quoteReads = 0
	const prices: bigint[] = []
	const onConfirm = async (request: RequestPriceReview, signal?: AbortSignal) => {
		attempts += 1
		if (request.proposedRepPerEthPrice !== undefined) prices.push(request.proposedRepPerEthPrice)
		if (failure === 'preparation') return
		const controller = createTransactionStepController(signal)
		controller.setPlan([{ ...step, title: 'Request new price' }])
		controller.startWithoutReview(0)
		controller.failed({ kind: 'error', message: 'nonce too low' })
	}
	const rendered = await renderIntoDocument(
		<GlobalTransactionPresentationProvider transaction={failure === 'preparation' ? { tone: 'error', title: 'Price request failed', detail: 'Uniswap quote unavailable.' } : undefined}>
			<RequestPriceModal {...props} fetchPrice={async () => BigInt(++quoteReads === 1 ? 2 : 4) * 10n ** 18n} onConfirm={onConfirm} />
		</GlobalTransactionPresentationProvider>,
	)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		expect(attempts).toBe(1)
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '3' } }))
		await settle()
		expect(attempts).toBe(1)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		expect(inputValue(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }))).toBe('4')
		expect(attempts).toBe(1)
		await act(() => fireEvent.click(queries.getByRole('button', { name: /^Request new price/ })))
		await settle()
		expect(attempts).toBe(2)
		expect(prices).toEqual([2n * 10n ** 18n, 4n * 10n ** 18n])
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test.each(['automatic', 'manual'] as const)('prepares %s again after visiting an invalid selection', async source => {
	const dom = installDomEnvironment()
	const prices: Array<bigint | undefined> = []
	const onConfirm = async (request: RequestPriceReview, signal?: AbortSignal) => {
		prices.push(request.proposedRepPerEthPrice)
		const controller = createTransactionStepController(signal)
		controller.setPlan([{ ...step, title: 'Request new price' }])
		try {
			await controller.review()
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes('canceled')) throw error
		}
	}
	const rendered = await renderIntoDocument(<RequestPriceModal {...props} onConfirm={onConfirm} />)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '' } }))
		if (source === 'manual') {
			await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '1.25' } }))
			await settle()
			await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '0' } }))
			await settle()
			await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '1.25' } }))
		} else {
			await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		}
		await settle()
		expect(prices).toEqual(source === 'manual' ? [2n * 10n ** 18n, 1_250_000_000_000_000_000n, 1_250_000_000_000_000_000n] : [2n * 10n ** 18n, 2n * 10n ** 18n])
		expect(queries.getByRole('button', { name: /^Request new price/ }).hasAttribute('disabled')).toBe(false)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('canceling a slow preparation leaves an independent transaction review actionable', async () => {
	const dom = installDomEnvironment()
	let release = () => undefined
	const delayed = new Promise<void>(resolve => {
		release = resolve
	})
	const onConfirm = async (_request: RequestPriceReview, signal?: AbortSignal) => {
		await delayed
		const controller = createTransactionStepController(signal)
		controller.setPlan([{ ...step, title: 'Obsolete price request' }])
		try {
			await controller.review()
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes('canceled')) throw error
		}
	}
	const rendered = await renderIntoDocument(<RequestPriceModal {...props} onConfirm={onConfirm} />)
	try {
		await act(() => fireEvent.click(within(document.body).getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		await rendered.cleanup()
		const independent = createTransactionStepController()
		independent.setPlan([{ ...step, title: 'Independent transaction' }])
		const result = independent.review().then(
			() => 'confirmed',
			() => 'canceled',
		)
		await act(async () => {
			release()
			await delayed
		})
		expect(transactionSteps.value?.steps[0]?.title).toBe('Independent transaction')
		transactionSteps.value?.confirm()
		expect(await result).toBe('confirmed')
	} finally {
		release()
		dom.cleanup()
	}
})

test('fetches only on demand, fills the editable field, and prepares the fetched price', async () => {
	const dom = installDomEnvironment()
	let fetches = 0
	const prices: Array<bigint | undefined> = []
	const rendered = await renderIntoDocument(
		<RequestPriceModal
			{...props}
			fetchPrice={async () => {
				fetches += 1
				return 1_234_567_890_123_456_789n
			}}
			onConfirm={async request => {
				prices.push(request.proposedRepPerEthPrice)
			}}
		/>,
	)
	try {
		await settle()
		const queries = within(document.body)
		expect(fetches).toBe(0)
		expect(prices).toEqual([])
		expect(queries.queryByRole('button', { name: 'Manual price' })).toBeNull()
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		expect(fetches).toBe(1)
		expect(inputValue(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }))).toBe('1.234567890123456789')
		expect(prices).toEqual([1_234_567_890_123_456_789n])
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '3.5' } }))
		await settle()
		expect(prices.at(-1)).toBe(3_500_000_000_000_000_000n)
		expect(fetches).toBe(1)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('a late Uniswap result cannot overwrite a manual edit', async () => {
	const dom = installDomEnvironment()
	let release = (_value: bigint) => undefined
	const quote = new Promise<bigint>(resolve => {
		release = resolve
	})
	const prices: Array<bigint | undefined> = []
	const rendered = await renderIntoDocument(
		<RequestPriceModal
			{...props}
			fetchPrice={() => quote}
			onConfirm={async request => {
				prices.push(request.proposedRepPerEthPrice)
			}}
		/>,
	)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		expect(queries.getByRole('button', { name: /Fetching/ }).hasAttribute('disabled')).toBe(true)
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '4' } }))
		await act(async () => {
			release(2n * 10n ** 18n)
			await quote
		})
		await settle()
		expect(prices).toEqual([4n * 10n ** 18n])
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('a failed fetch preserves the input and allows fetching again or manual entry', async () => {
	const dom = installDomEnvironment()
	let fetches = 0
	const rendered = await renderIntoDocument(
		<RequestPriceModal
			{...props}
			fetchPrice={async () => {
				fetches += 1
				if (fetches === 1) throw new Error('Uniswap unavailable')
				return 2n * 10n ** 18n
			}}
			onConfirm={async () => undefined}
		/>,
	)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '1.25' } }))
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		expect(queries.getByRole('alert').textContent).toContain('Uniswap unavailable')
		expect(inputValue(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }))).toBe('1.25')
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		expect(queries.queryByRole('alert')).toBeNull()
		expect(inputValue(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }))).toBe('2')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('ignores a quote completed after the dialog closes and reopens', async () => {
	const dom = installDomEnvironment()
	let release = (_value: bigint) => undefined
	const quote = new Promise<bigint>(resolve => {
		release = resolve
	})
	const prices: Array<bigint | undefined> = []
	const fetchPrice = () => quote
	const onConfirm = async (request: RequestPriceReview) => {
		prices.push(request.proposedRepPerEthPrice)
	}
	const rendered = await renderIntoDocument(<RequestPriceModal {...props} fetchPrice={fetchPrice} onConfirm={onConfirm} />)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await act(() => render(<RequestPriceModal {...props} review={undefined} fetchPrice={fetchPrice} onConfirm={onConfirm} />, rendered.container))
		await act(() => render(<RequestPriceModal {...props} fetchPrice={fetchPrice} onConfirm={onConfirm} />, rendered.container))
		await act(async () => {
			release(2n * 10n ** 18n)
			await quote
		})
		await settle()
		expect(inputValue(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }))).toBe('')
		expect(prices).toEqual([])
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('keeps the empty price form compact until an estimate is entered', async () => {
	const dom = installDomEnvironment()
	let preparations = 0
	const rendered = await renderIntoDocument(
		<RequestPriceModal
			{...props}
			onConfirm={async () => {
				preparations += 1
			}}
		/>,
	)
	try {
		await settle()
		const queries = within(document.body)
		expect(queries.getByText('Enter a starting price.')).not.toBeNull()
		expect(document.querySelector('.transaction-funding')).toBeNull()
		expect(queries.queryByRole('button', { name: /Approve.*(REP|WETH)/ })).toBeNull()
		const button = queries.getByRole('button', { name: /^Request new price/ })
		expect(button.hasAttribute('disabled')).toBe(true)
		const reasonId = button.getAttribute('aria-describedby')
		expect(reasonId === null ? undefined : document.getElementById(reasonId)?.textContent).toContain('Enter a starting price.')
		expect(preparations).toBe(0)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('keeps the preview while satisfied approvals are skipped before the final review is ready', async () => {
	const dom = installDomEnvironment()
	const ready = createDeferred<void>()
	const onConfirm = async (_request: RequestPriceReview, signal?: AbortSignal) => {
		const controller = createTransactionStepController(signal)
		controller.setPlan([...['REP', 'WETH'].map(tokenSymbol => ({ ...step, title: `Approve ${tokenSymbol}`, approval: { requiredAmount: 3n, approvedAmount: 3n, tokenSymbol, tokenUnits: 0 } })), { ...step, title: 'Request new price' }])
		await controller.chooseFunding([])
		await ready.promise
		try {
			await controller.review(2)
		} catch (error) {
			if (!(error instanceof Error) || !error.message.includes('canceled')) throw error
		}
	}
	const rendered = await renderIntoDocument(<RequestPriceModal {...props} onConfirm={onConfirm} />)
	try {
		const queries = within(rendered.container)
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '1.25' } }))
		await settle()
		expect(transactionSteps.value?.activeIndex).toBe(-1)
		expect(rendered.container.querySelectorAll('.approval-amount-field')).toHaveLength(0)
		expect(queries.getByRole('button', { name: /Preparing funding and approvals/ }).hasAttribute('disabled')).toBe(true)
		expect(queries.queryByRole('button', { name: /Request new price/ })).toBeNull()
		ready.resolve()
		await settle()
		expect(transactionSteps.value?.activeIndex).toBe(2)
		expect(queries.getByText('REP approved ✓')).not.toBeNull()
		expect(queries.getByText('WETH approved ✓')).not.toBeNull()
		expect(rendered.container.querySelectorAll('.approval-amount-field')).toHaveLength(0)
		expect(queries.getByRole('button', { name: /Request new price/ }).hasAttribute('disabled')).toBe(false)
	} finally {
		ready.resolve()
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('does not announce submission while preparing an unconfirmed price review', async () => {
	const dom = installDomEnvironment()
	const presentation = signal<GlobalTransactionPresentation | undefined>(undefined)
	function Harness() {
		return (
			<GlobalTransactionPresentationProvider transaction={presentation.value}>
				<RequestPriceModal
					{...props}
					onConfirm={async (_request, signal) => {
						presentation.value = { operationKey: 'price', tone: 'preparing', title: 'Requesting new price…', detail: 'Submitting in browser simulation' }
						const controller = createTransactionStepController(signal)
						controller.setPlan([{ ...step, title: 'Request new price' }])
						await controller.review().catch(() => undefined)
					}}
				/>
			</GlobalTransactionPresentationProvider>
		)
	}
	const rendered = await renderIntoDocument(<Harness />)
	try {
		const dialog = within(document.body).getByRole('dialog', { name: 'Request new price' })
		await act(() => fireEvent.input(within(dialog).getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '3' } }))
		await settle()
		expect(dialog.textContent).not.toContain('Submitting in browser simulation')
		expect(transactionSteps.value?.steps[0]?.phase).toBe('review')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

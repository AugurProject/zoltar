import { createDeferred } from '@zoltar/ui-core-shared/tests/testUtils/deferred.js'
import { GlobalTransactionPresentationProvider } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { afterEach, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
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
				title: 'Request price',
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
		expect(queries.getByRole('button', { name: /Approve REP/ })).not.toBeNull()
		expect(queries.getByRole('button', { name: /Request price/ })).not.toBeNull()
		expect(queries.queryByRole('button', { name: 'Review funding and steps' })).toBeNull()
		expect(submitted).toBe(0)
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '' } }))
		expect(queries.getByRole('button', { name: /Approve REP/ }).hasAttribute('disabled')).toBe(true)
		expect(document.querySelector('.transaction-funding')?.textContent).toContain('— REP')
		expect(document.querySelector('.transaction-funding')?.textContent).not.toContain('2 REP')
		for (const value of ['0', '-1', 'abc', '0.0000000000000000001', (2n ** 256n).toString()]) {
			await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value } }))
			expect(queries.getByText('Enter a positive REP per ETH price with up to 18 decimal places.')).not.toBeNull()
			expect(queries.getByRole('button', { name: /Request price/ }).hasAttribute('disabled')).toBe(true)
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
			fireEvent.click(queries.getByRole('button', { name: /Approve REP/ }))
			await Promise.resolve()
		})
		expect(submitted).toBe(1)
		expect(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }).hasAttribute('disabled')).toBe(true)
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
		controller.setPlan([{ ...step, title: 'Request price' }])
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
	const rendered = await renderIntoDocument(
		<GlobalTransactionPresentationProvider transaction={{ tone: 'error', title: 'Price request failed', detail: 'Uniswap quote unavailable.' }}>
			<RequestPriceModal {...props} onConfirm={onConfirm} />
		</GlobalTransactionPresentationProvider>,
	)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		expect(queries.getByRole('alert').textContent).toContain('Uniswap quote unavailable.')
		expect(queries.getByRole('alert').closest('.transaction-step-content') === null).toBe(true)
		expect(queries.queryByRole('status')).toBeNull()
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Retry' })))
		await settle()
		expect(attempts).toBe(2)
		await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }), { target: { value: '' } }))
		expect(queries.getByRole('textbox', { name: 'Open Oracle REP/ETH starting price' }).hasAttribute('disabled')).toBe(false)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('allows another price request after a failed transaction step', async () => {
	const dom = installDomEnvironment()
	let attempts = 0
	const onConfirm = async (_request: RequestPriceReview, signal?: AbortSignal) => {
		attempts += 1
		const controller = createTransactionStepController(signal)
		controller.setPlan([{ ...step, title: 'Request price' }])
		controller.startWithoutReview(0)
		controller.failed('nonce too low')
	}
	const rendered = await renderIntoDocument(<RequestPriceModal {...props} onConfirm={onConfirm} />)
	try {
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Fetch from Uniswap' })))
		await settle()
		expect(queries.getByRole('button', { name: 'Retry request' })).not.toBeNull()
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Retry request' })))
		await settle()
		expect(attempts).toBe(2)
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
		controller.setPlan([{ ...step, title: 'Request price' }])
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
		expect(queries.getByRole('button', { name: /^Request price/ }).hasAttribute('disabled')).toBe(false)
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

test('keeps the funding and action layout visible with unknown values until an estimate is entered', async () => {
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
		expect(document.querySelector('.transaction-funding')?.textContent).toContain('— REP')
		expect(queries.getByText('Settler bounty')).not.toBeNull()
		for (const name of [/Approve REP/, /Approve WETH/, /^Request price/]) {
			const button = queries.getByRole('button', { name })
			expect(button.hasAttribute('disabled')).toBe(true)
			const reasonId = button.getAttribute('aria-describedby')
			expect(reasonId === null ? undefined : document.getElementById(reasonId)?.textContent).toContain('Enter a starting price.')
		}
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
		controller.setPlan([...['REP', 'WETH'].map(tokenSymbol => ({ ...step, title: `Approve ${tokenSymbol}`, approval: { requiredAmount: 3n, approvedAmount: 3n, tokenSymbol, tokenUnits: 0 } })), { ...step, title: 'Request price' }])
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
		expect(rendered.container.querySelectorAll('.approval-amount-field')).toHaveLength(2)
		expect(queries.getByRole('button', { name: /Preparing funding and approvals/ }).hasAttribute('disabled')).toBe(true)
		expect(queries.queryByRole('button', { name: /Request price/ })).toBeNull()
		ready.resolve()
		await settle()
		expect(rendered.container.querySelectorAll('.approval-amount-field')).toHaveLength(2)
		expect(queries.getByRole('button', { name: /Request price/ }).hasAttribute('disabled')).toBe(false)
	} finally {
		ready.resolve()
		await rendered.cleanup()
		dom.cleanup()
	}
})

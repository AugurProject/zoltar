import { GlobalTransactionPresentationProvider } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { afterEach, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { render } from 'preact'
import { getAddress } from '@zoltar/core-shared/evm/ethereum'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { RequestPriceModal } from '../../app/transactions/RequestPriceModal.js'
import { TransactionStepsModal, embeddedTransactionSteps } from '../../app/transactions/TransactionStepsModal.js'
import { createTransactionStepController, transactionSteps } from '../../app/transactions/transactionSteps.js'
import type { RequestPriceReview } from '@zoltar/ui-statoblast-shared/features/security-pools/components/SecurityPoolOracleSections.js'

const review: RequestPriceReview = { managerAddress: getAddress('0x0000000000000000000000000000000000000001'), securityPoolAddress: getAddress('0x0000000000000000000000000000000000000002'), universeId: 0n, requestValueAttoEth: 12n }
const props = { review, canRequest: true, pending: false, confirmationGuardMessage: undefined, closeOnSuccessKey: undefined, onClose: () => undefined }
const step = { contractAddress: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 12n, description: 'Fund the report.' }

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
			{ ...step, title: 'Request price', proposedRepPerEthPrice: request.proposedRepPerEthPrice ?? 2n * 10n ** 18n },
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
		await settle()
		const queries = within(document.body)
		expect(queries.getAllByRole('dialog')).toHaveLength(1)
		expect(queries.getByRole('button', { name: /Approve REP/ })).not.toBeNull()
		expect(queries.getByRole('button', { name: /Request price/ })).not.toBeNull()
		expect(queries.queryByRole('button', { name: 'Review funding and steps' })).toBeNull()
		expect(submitted).toBe(0)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Manual price' })))
		expect(queries.queryByRole('button', { name: /Approve REP/ }) === null).toBe(true)
		for (const value of ['0', '-1', 'abc', '0.0000000000000000001', (2n ** 256n).toString()]) {
			await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'REP per ETH' }), { target: { value } }))
			expect(queries.getByText('Enter a positive REP per ETH price with up to 18 decimal places.')).not.toBeNull()
			expect(queries.queryByRole('button', { name: /Request price/ })).toBeNull()
		}
		const priceInput = queries.getByRole('textbox', { name: 'REP per ETH' })
		priceInput.focus()
		await act(() => fireEvent.input(priceInput, { target: { value: '1.25' } }))
		await settle()
		expect(prices).toEqual([undefined, 1_250_000_000_000_000_000n])
		expect(document.activeElement).toBe(priceInput)
		expect(queries.getAllByRole('dialog')).toHaveLength(1)
		expect(submitted).toBe(0)
		await act(async () => {
			fireEvent.click(queries.getByRole('button', { name: /Approve REP/ }))
			await Promise.resolve()
		})
		expect(submitted).toBe(1)
		expect(queries.getByRole('textbox', { name: 'REP per ETH' }).hasAttribute('disabled')).toBe(true)
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

test('shows quote failure with retry and keeps manual entry available', async () => {
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
		await settle()
		const queries = within(document.body)
		expect(queries.getByRole('alert').textContent).toContain('Uniswap quote unavailable.')
		expect(queries.queryByRole('status')).toBeNull()
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Retry' })))
		await settle()
		expect(attempts).toBe(2)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Manual price' })))
		expect(queries.getByRole('textbox', { name: 'REP per ETH' }).hasAttribute('disabled')).toBe(false)
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
		await settle()
		const queries = within(document.body)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Manual price' })))
		if (source === 'manual') {
			await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'REP per ETH' }), { target: { value: '1.25' } }))
			await settle()
			await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'REP per ETH' }), { target: { value: '0' } }))
			await settle()
			await act(() => fireEvent.input(queries.getByRole('textbox', { name: 'REP per ETH' }), { target: { value: '1.25' } }))
		} else {
			await act(() => fireEvent.click(queries.getByRole('button', { name: 'Uniswap quote' })))
		}
		await settle()
		expect(prices).toEqual(source === 'manual' ? [undefined, 1_250_000_000_000_000_000n, 1_250_000_000_000_000_000n] : [undefined, undefined])
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

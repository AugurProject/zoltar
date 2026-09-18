import { GlobalTransactionPresentationProvider } from '@zoltar/ui-core-shared/components/GlobalTransactionPresentationContext.js'
import { TransactionActionButtonLockProvider } from '@zoltar/ui-core-shared/components/TransactionActionButton.js'
import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import { fireEvent, within } from '@zoltar/ui-core-shared/tests/testUtils/queries.js'
import { TransactionStepsModal } from '../../app/transactions/TransactionStepsModal.js'
import { createTransactionStepController, transactionSteps } from '../../app/transactions/transactionSteps.js'

test('shows every step, token deposit, expected return and ETH cost before the first confirmation', async () => {
	const dom = installDomEnvironment()
	const controller = createTransactionStepController()
	const common = { contractAddress: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }
	controller.setPlan([
		{ ...common, title: 'Approve REP spending', description: 'Allow REP spending.', amount: '6 REP' },
		{ ...common, title: 'Approve WETH spending', description: 'Allow WETH spending.', amount: '2 WETH' },
		{
			...common,
			title: 'Request price',
			description: 'Fund the report.',
			ethValueAttoEth: 12n,
			tokenFunding: [
				{ amount: '3 REP', limit: '6 REP' },
				{ amount: '1 WETH', limit: '2 WETH' },
			],
			oracleOutcome: { settlerRewardAttoEth: 10n, ethRefundAttoEth: 2n, returnToWallet: true },
		},
	])
	let confirmed = false
	const review = controller.review().then(() => {
		confirmed = true
	})
	const rendered = await renderIntoDocument(<TransactionStepsModal contextKey='wallet' />)
	try {
		const queries = within(rendered.container)
		expect(queries.getByText('6 REP')).not.toBeNull()
		expect(rendered.container.querySelector('details')).toBeNull()
		expect(queries.getByRole('button', { name: /Approve WETH spending/ })).not.toBeNull()
		expect(queries.getByText('3 REP')).not.toBeNull()
		expect(queries.getByText('1 WETH')).not.toBeNull()
		expect(queries.getByText('Settler bounty (est.)')).not.toBeNull()
		expect(queries.getByText('Request refund (est.)')).not.toBeNull()
		expect(queries.getByRole('button', { name: /Request price/ })).not.toBeNull()
		expect(confirmed).toBe(false)
		await act(() => fireEvent.click(queries.getByRole('button', { name: /Approve REP spending/ })))
		await review
		expect(confirmed).toBe(true)
		expect(transactionSteps.value?.steps[1]?.phase).toBe('upcoming')
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

for (const choice of ['custom', 'max'] as const) {
	test(`reuses the approval amount control for ${choice} without sending the next step`, async () => {
		const dom = installDomEnvironment()
		const controller = createTransactionStepController()
		controller.setPlan([
			{ title: 'Approve REP spending', description: 'Allow REP spending.', contractAddress: undefined, spender: undefined, amount: '3 REP', ethValueAttoEth: 0n, approval: { requiredAmount: 3n, approvedAmount: 1n, tokenSymbol: 'REP', tokenUnits: 0 } },
			{
				title: 'Request price',
				description: 'Fund the report.',
				contractAddress: undefined,
				spender: undefined,
				amount: undefined,
				ethValueAttoEth: 12n,
				tokenFunding: [
					{ amount: '3 REP', limit: '6 REP' },
					{ amount: '1 WETH', limit: '2 WETH' },
				],
				oracleOutcome: { settlerRewardAttoEth: 10n, ethRefundAttoEth: 2n, returnToWallet: true },
			},
		])
		const review = controller.review()
		const rendered = await renderIntoDocument(
			<TransactionActionButtonLockProvider locked>
				<TransactionStepsModal contextKey='approval' />
			</TransactionActionButtonLockProvider>,
		)
		try {
			const queries = within(rendered.container)
			const funding = rendered.container.querySelector('.transaction-funding')
			const approvalInput = queries.getByRole('textbox')
			if (funding === null) throw new Error('Missing funding summary')
			expect(funding.textContent).toContain('3 REP')
			expect(funding.textContent).toContain('1 WETH')
			expect(queries.getByRole('button', { name: /Request price/ }).hasAttribute('disabled')).toBe(true)
			if (choice === 'custom') await act(() => fireEvent.input(queries.getByRole('textbox'), { target: { value: '9' } }))
			else await act(() => fireEvent.click(queries.getByText('Max')))
			expect(transactionSteps.value?.steps[0]?.phase).toBe('review')
			expect(queries.getByRole('button', { name: choice === 'custom' ? /Approve REP/ : /Approve Max/ }).hasAttribute('disabled')).toBe(false)
			await act(() => fireEvent.click(queries.getByRole('button', { name: choice === 'custom' ? /Approve REP/ : /Approve Max/ })))
			expect(await review).toBe(choice === 'custom' ? 9n : 2n ** 256n - 1n)
			expect(transactionSteps.value?.steps[1]?.phase).toBe('upcoming')
			expect(rendered.container.querySelector('.transaction-funding')).toBe(funding)
			expect(funding.textContent).toContain('Settler bounty (est.)')
			expect(funding.textContent).toContain('Request refund (est.)')
			const hash = '0x1111111111111111111111111111111111111111111111111111111111111111'
			await act(() => {
				controller.submitted(hash)
				controller.receipt(hash, 'success')
			})
			expect(queries.getByRole('textbox')).toBe(approvalInput)
			expect(approvalInput.hasAttribute('disabled')).toBe(true)
			expect(queries.getByText('Approved REP')).not.toBeNull()
			expect(rendered.container.querySelectorAll('.approval-amount-field')).toHaveLength(1)
			const nextReview = controller.review()
			await act(() => undefined)
			expect(rendered.container.querySelector('.transaction-funding')).toBe(funding)
			await act(() => fireEvent.click(queries.getByRole('button', { name: /Request price/ })))
			await nextReview
			expect(rendered.container.querySelector('.transaction-funding')).toBe(funding)
		} finally {
			await rendered.cleanup()
			dom.cleanup()
		}
	})
}

for (const result of ['success', 'reverted'] as const) {
	test(`keeps one button per transaction and gates the next action after ${result}`, async () => {
		const dom = installDomEnvironment()
		const controller = createTransactionStepController()
		const common = { contractAddress: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n, description: 'Transaction purpose.' }
		controller.setPlan([
			{ ...common, title: 'Wrap ETH' },
			{ ...common, title: 'Approve REP' },
			{ ...common, title: 'Request price' },
		])
		const firstReview = controller.review()
		const rendered = await renderIntoDocument(<TransactionStepsModal contextKey='buttons' />)
		try {
			const queries = within(rendered.container)
			const button = (name: string) => queries.getByRole('button', { name: new RegExp(name) })
			expect(button('Wrap ETH').hasAttribute('disabled')).toBe(false)
			expect(button('Approve REP').hasAttribute('disabled')).toBe(true)
			expect(button('Request price').hasAttribute('disabled')).toBe(true)
			await act(() => fireEvent.click(button('Request price')))
			expect(transactionSteps.value?.steps[0]?.phase).toBe('review')
			await act(() => fireEvent.click(button('Wrap ETH')))
			await firstReview
			expect(button('Approve REP').hasAttribute('disabled')).toBe(true)
			expect(button('Request price').hasAttribute('disabled')).toBe(true)
			const hash = '0x1111111111111111111111111111111111111111111111111111111111111111'
			await act(() => {
				controller.submitted(hash)
				controller.receipt(hash, result)
			})
			if (result === 'success') {
				const secondReview = controller.review()
				await act(() => undefined)
				expect(button('Wrap ETH').hasAttribute('disabled')).toBe(true)
				expect(button('Approve REP').hasAttribute('disabled')).toBe(false)
				expect(button('Request price').hasAttribute('disabled')).toBe(true)
				await act(() => fireEvent.click(button('Approve REP')))
				await secondReview
			} else {
				expect(button('Wrap ETH').hasAttribute('disabled')).toBe(true)
				expect(button('Approve REP').hasAttribute('disabled')).toBe(true)
				expect(button('Request price').hasAttribute('disabled')).toBe(true)
			}
		} finally {
			await rendered.cleanup()
			dom.cleanup()
		}
	})
}

test('both insufficient approvals are enabled independently while the report waits for funding', async () => {
	const dom = installDomEnvironment()
	const controller = createTransactionStepController()
	const common = { description: 'Authorize spending.', contractAddress: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }
	controller.setPlan([...['REP', 'WETH'].map(tokenSymbol => ({ ...common, title: `Approve ${tokenSymbol}`, approval: { requiredAmount: 3n, approvedAmount: 0n, tokenSymbol, tokenUnits: 0 } })), { ...common, title: 'Request price' }])
	const choosing = controller.chooseFunding([0, 1])
	const rendered = await renderIntoDocument(<TransactionStepsModal contextKey='independent' />)
	try {
		const queries = within(rendered.container)
		for (const token of ['REP', 'WETH']) expect(queries.getByRole('button', { name: `Approve ${token}` }).hasAttribute('disabled')).toBe(false)
		expect(queries.getByRole('button', { name: 'Request price' }).hasAttribute('disabled')).toBe(true)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Approve WETH' })))
		expect(await choosing).toEqual({ index: 1, amount: 3n })
		expect(queries.getByRole('button', { name: 'Approve REP' }).hasAttribute('disabled')).toBe(true)
		expect(queries.getByRole('button', { name: 'Request price' }).hasAttribute('disabled')).toBe(true)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('shows requirement-read failures from the enclosing operation after an approval confirms', async () => {
	const dom = installDomEnvironment()
	const controller = createTransactionStepController()
	const common = { description: 'Transaction purpose.', contractAddress: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }
	controller.setPlan([
		{ ...common, title: 'Approve REP' },
		{ ...common, title: 'Request price' },
	])
	const review = controller.review()
	transactionSteps.value?.confirm()
	await review
	const hash = '0x1111111111111111111111111111111111111111111111111111111111111111'
	controller.submitted(hash)
	controller.receipt(hash, 'success')
	const rendered = await renderIntoDocument(
		<GlobalTransactionPresentationProvider transaction={{ tone: 'error', title: 'Request failed', detail: 'Could not refresh funding requirements.' }}>
			<TransactionStepsModal contextKey='read-failure' />
		</GlobalTransactionPresentationProvider>,
	)
	try {
		const queries = within(rendered.container)
		expect(queries.getByRole('alert').textContent).toContain('Could not refresh funding requirements.')
		expect(queries.getByRole('button', { name: 'Request price' }).hasAttribute('disabled')).toBe(true)
		expect(queries.getByRole('button', { name: 'Close' }).hasAttribute('disabled')).toBe(false)
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

for (const phase of ['skipped', 'failed'] as const) {
	test(`keeps approval fields visible when approval is ${phase}`, async () => {
		const dom = installDomEnvironment()
		const controller = createTransactionStepController()
		const common = { description: 'Authorize spending.', contractAddress: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }
		controller.setPlan([
			{ ...common, title: 'Approve REP', approval: { requiredAmount: 3n, approvedAmount: phase === 'skipped' ? 3n : 0n, tokenSymbol: 'REP', tokenUnits: 0 } },
			{ ...common, title: 'Request price' },
		])
		if (phase === 'skipped') await controller.chooseFunding([])
		else {
			const review = controller.review()
			transactionSteps.value?.confirm()
			await review
			controller.failed('Approval rejected.')
		}
		const nextReview = phase === 'skipped' ? controller.review(1) : undefined
		const rendered = await renderIntoDocument(<TransactionStepsModal contextKey={phase} />)
		try {
			const queries = within(rendered.container)
			expect(queries.getByRole('textbox').hasAttribute('disabled')).toBe(true)
			expect(queries.getByText('Required REP')).not.toBeNull()
			expect(queries.getByText('Approved REP')).not.toBeNull()
			expect(queries.getByRole('button', { name: 'Approve REP' }).hasAttribute('disabled')).toBe(true)
			await act(() => transactionSteps.value?.confirm())
			await nextReview
		} finally {
			await rendered.cleanup()
			dom.cleanup()
		}
	})
}

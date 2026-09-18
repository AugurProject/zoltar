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
		expect(queries.getByText('2 WETH')).not.toBeNull()
		expect(queries.getByText('3 REP')).not.toBeNull()
		expect(queries.getByText('1 WETH')).not.toBeNull()
		expect(queries.getByText('Settler bounty (est.)')).not.toBeNull()
		expect(queries.getByText('Request refund (est.)')).not.toBeNull()
		expect(queries.getByText('Request price')).not.toBeNull()
		expect(confirmed).toBe(false)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Approve REP spending' })))
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
			{ title: 'Request price', description: 'Fund the report.', contractAddress: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n },
		])
		const review = controller.review()
		const rendered = await renderIntoDocument(
			<TransactionActionButtonLockProvider locked>
				<TransactionStepsModal contextKey='approval' />
			</TransactionActionButtonLockProvider>,
		)
		try {
			const queries = within(rendered.container)
			await act(() => fireEvent.click(queries.getByRole('button', { name: 'Approve REP spending' })))
			if (choice === 'custom') await act(() => fireEvent.input(queries.getByRole('textbox'), { target: { value: '9' } }))
			else await act(() => fireEvent.click(queries.getByText('Max')))
			expect(transactionSteps.value?.steps[0]?.phase).toBe('review')
			expect(queries.getByRole('button', { name: choice === 'custom' ? /Approve 9/ : /Approve Max/ }).hasAttribute('disabled')).toBe(false)
			await act(() => fireEvent.click(queries.getByRole('button', { name: choice === 'custom' ? /Approve 9/ : /Approve Max/ })))
			expect(await review).toBe(choice === 'custom' ? 9n : 2n ** 256n - 1n)
			expect(transactionSteps.value?.steps[1]?.phase).toBe('upcoming')
		} finally {
			await rendered.cleanup()
			dom.cleanup()
		}
	})
}

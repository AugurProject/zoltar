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
		expect(queries.getByText('ETH paid to settler (estimate)')).not.toBeNull()
		expect(queries.getByText('ETH refunded on request (estimate)')).not.toBeNull()
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

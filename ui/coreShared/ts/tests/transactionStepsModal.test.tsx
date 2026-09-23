import { GlobalTransactionPresentationProvider } from '../components/GlobalTransactionPresentationContext.js'
import { TransactionActionButtonLockProvider } from '../components/TransactionActionButton.js'
import { expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { fireEvent, within } from './testUtils/queries.js'
import { TransactionStepsModal } from '../components/TransactionStepsModal.js'
import { TransactionStepsContent } from '../components/TransactionStepsContent.js'
import { createTransactionStepController, transactionSteps } from '../transactions/transactionSteps.js'

test('shows every step, token deposit, expected return and ETH cost before the first confirmation', async () => {
	const dom = installDomEnvironment()
	const controller = createTransactionStepController()
	const common = { contractAddress: undefined, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }
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
			oracleOutcome: { settlerRewardAttoEth: 12n, returnToWallet: true },
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
		expect(queries.getByText('Settler bounty')).not.toBeNull()
		expect(queries.queryByText(/Request refund/)).toBeNull()
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

test('explains a step without token funding using its description, the operation rows, and the target contract', async () => {
	const dom = installDomEnvironment()
	const controller = createTransactionStepController()
	const contractAddress = '0x00000000000000000000000000000000000000aa'
	const description = 'Create the binary question and deploy its security pool in one transaction.'
	controller.setPlan([{ title: 'Create question and security pool', description, contractAddress, contractLabel: 'Multicall3', spender: undefined, amount: undefined, ethValueAttoEth: 0n }])
	const review = controller.review()
	const rendered = await renderIntoDocument(
		<GlobalTransactionPresentationProvider
			transaction={{
				tone: 'awaiting-wallet',
				title: 'Creating Security Pool',
				rows: [
					{ label: 'Question ID', value: '123' },
					{ label: 'Statoblast security multiplier', value: '2x' },
				],
			}}
		>
			<TransactionStepsModal contextKey='review' />
		</GlobalTransactionPresentationProvider>,
	)
	try {
		const queries = within(rendered.container)
		expect(rendered.container.querySelector('.modal-header h3')?.textContent).toBe('Create question and security pool')
		expect(queries.getByText(description)).not.toBeNull()
		expect(queries.getByText('Question ID')).not.toBeNull()
		expect(queries.getByText('123')).not.toBeNull()
		expect(queries.getByText('Statoblast security multiplier')).not.toBeNull()
		expect(queries.getByText('2x')).not.toBeNull()
		expect(rendered.container.querySelector('.transaction-funding')).toBeNull()
		expect(queries.getByText('Technical details')).not.toBeNull()
		expect(rendered.container.querySelector('details .address-value')?.getAttribute('title')).toBe(contractAddress)
		expect(rendered.container.querySelector('details dd')?.textContent).toBe(`Multicall3 ${contractAddress}`)
		await act(() => fireEvent.click(queries.getByRole('button', { name: 'Create question and security pool' })))
		await review
	} finally {
		await rendered.cleanup()
		dom.cleanup()
	}
})

test('only keeps inline actions visible when asked, leaving modal-embedded steps alone', async () => {
	const dom = installDomEnvironment()
	const scrolled: string[] = []
	const originalScrollIntoView = Element.prototype.scrollIntoView
	Element.prototype.scrollIntoView = function (this: Element, options?: boolean | ScrollIntoViewOptions) {
		scrolled.push(`${this.className}:${JSON.stringify(options)}`)
	}
	const originalRequestAnimationFrame = globalThis.requestAnimationFrame
	globalThis.requestAnimationFrame = callback => {
		callback(0)
		return 0
	}
	const controller = createTransactionStepController()
	controller.setPlan([{ title: 'Create security pool', description: undefined, contractAddress: undefined, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }])
	const review = controller.review()
	try {
		const embedded = await renderIntoDocument(<TransactionStepsContent contextKey='embedded' />)
		expect(scrolled).toEqual([])
		await embedded.cleanup()
		const kept = await renderIntoDocument(<TransactionStepsContent contextKey='kept' keepActionsVisible />)
		expect(scrolled).toEqual(['transaction-step-actions transaction-approval-editor:{"block":"center"}'])
		await kept.cleanup()
	} finally {
		Element.prototype.scrollIntoView = originalScrollIntoView
		globalThis.requestAnimationFrame = originalRequestAnimationFrame
		transactionSteps.value?.cancel()
		await review.catch(() => undefined)
		dom.cleanup()
	}
})

test('omits the explanation paragraph for a self-describing step and keeps the operation rows', async () => {
	const dom = installDomEnvironment()
	const controller = createTransactionStepController()
	controller.setPlan([{ title: 'Deposit REP to vault', description: undefined, contractAddress: undefined, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }])
	const review = controller.review()
	const rendered = await renderIntoDocument(
		<GlobalTransactionPresentationProvider transaction={{ tone: 'awaiting-wallet', title: 'Depositing REP', rows: [{ label: 'Vault', value: '0x00000000000000000000000000000000000000bb' }] }}>
			<TransactionStepsModal contextKey='self-describing' />
		</GlobalTransactionPresentationProvider>,
	)
	try {
		const queries = within(rendered.container)
		expect(rendered.container.querySelector('.transaction-step-content p.detail')).toBeNull()
		expect(queries.getByText('Vault')).not.toBeNull()
		expect(rendered.container.querySelector('details')).toBeNull()
		expect(queries.getByRole('button', { name: 'Deposit REP to vault' }).hasAttribute('disabled')).toBe(false)
		transactionSteps.value?.cancel()
		await review.catch(() => undefined)
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
			{ title: 'Approve REP spending', description: 'Allow REP spending.', contractAddress: undefined, contractLabel: undefined, spender: undefined, amount: '3 REP', ethValueAttoEth: 0n, approval: { requiredAmount: 3n, approvedAmount: 1n, tokenSymbol: 'REP', tokenUnits: 0 } },
			{
				title: 'Request price',
				description: 'Fund the report.',
				contractAddress: undefined,
				contractLabel: undefined,
				spender: undefined,
				amount: undefined,
				ethValueAttoEth: 12n,
				tokenFunding: [
					{ amount: '3 REP', limit: '6 REP' },
					{ amount: '1 WETH', limit: '2 WETH' },
				],
				oracleOutcome: { settlerRewardAttoEth: 12n, returnToWallet: true },
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
			expect(funding.textContent).toContain('Settler bounty')
			const hash = '0x1111111111111111111111111111111111111111111111111111111111111111'
			await act(() => {
				controller.submitted(hash)
				controller.receipt(hash, 'success')
			})
			expect(queries.getByRole('link', { name: hash }).closest('.transaction-step-actions')).not.toBeNull()
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
		const common = { contractAddress: undefined, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n, description: 'Transaction purpose.' }
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
				expect(button('Wrap ETH').textContent).toContain('Wrap ETH')
				expect(button('Wrap ETH').textContent).toContain('Confirmed')
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
	const common = { description: 'Authorize spending.', contractAddress: undefined, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }
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
	const common = { description: 'Transaction purpose.', contractAddress: undefined, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }
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
		expect(queries.getByRole('alert').closest('.transaction-step-content')).toBeNull()
		expect(queries.getByRole('alert').closest('.transaction-step-actions')).not.toBeNull()
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
		const common = { description: 'Authorize spending.', contractAddress: undefined, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }
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

for (const result of ['pending', 'reverted'] as const) {
	test(`keeps the final query hash accessible beside its action when ${result}`, async () => {
		const dom = installDomEnvironment()
		const controller = createTransactionStepController()
		controller.setPlan([{ title: 'Request price', description: 'Fund the report.', contractAddress: undefined, contractLabel: undefined, spender: undefined, amount: undefined, ethValueAttoEth: 0n }])
		const review = controller.review()
		transactionSteps.value?.confirm()
		await review
		const hash = '0x1111111111111111111111111111111111111111111111111111111111111111'
		controller.submitted(hash)
		if (result === 'reverted') {
			controller.receipt(hash, 'reverted')
			controller.failed('Transaction failed after using its full gas limit. Open the transaction details before retrying.')
		}
		const rendered = await renderIntoDocument(
			<GlobalTransactionPresentationProvider transaction={result === 'reverted' ? { tone: 'error', title: 'Request failed', detail: 'Transaction reverted' } : undefined}>
				<TransactionStepsModal contextKey='query-hash' />
			</GlobalTransactionPresentationProvider>,
		)
		try {
			const queries = within(rendered.container)
			expect(queries.getByRole('link', { name: hash }).closest('.transaction-step-actions') !== null).toBe(true)
			if (result === 'reverted') {
				expect(queries.getByRole('alert').textContent).toContain('full gas limit')
				expect(queries.getByRole('alert').closest('.transaction-step-content') === null).toBe(true)
			}
		} finally {
			await rendered.cleanup()
			dom.cleanup()
		}
	})
}

/// <reference types="bun-types" />

import { installDomTestLifecycle } from './testUtils/domTestLifecycle.js'
import { describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { TokenApprovalControl } from '../components/TokenApprovalControl.js'
import { TransactionActionButton, TransactionActionGroup } from '../components/TransactionActionButton.js'
import { fireEvent, within } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'
import { expectTransactionButtonDisabled, getTransactionButtonState } from './testUtils/transactionActionButton.js'

describe('TokenApprovalControl', () => {
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	installDomTestLifecycle({
		afterTest: async () => {
			await cleanupRenderedComponent?.()
			cleanupRenderedComponent = undefined
		},
	})

	for (const purpose of ['Vault deposit', 'Oracle report']) {
		for (const completed of [false, true]) {
			test(`keeps ${purpose} identifiable after approval: ${completed}`, async () => {
				const rendered = await renderIntoDocument(
					<TokenApprovalControl
						actionLabel='Submit vault operations'
						approvalPurpose={purpose}
						allowanceError={undefined}
						allowanceLoading={false}
						approvedAmount={completed ? 1000n : 0n}
						completedLabel={completed ? 'Approved' : undefined}
						guardMessage={undefined}
						onApprove={() => undefined}
						pending={false}
						pendingLabel='Approving REP'
						requiredAmount={500n}
						resetKey='purpose'
						tokenSymbol='REP'
						tokenUnits={0}
					/>,
				)
				cleanupRenderedComponent = rendered.cleanup
				expect(within(document.body).getByRole('textbox', { name: `${purpose}: REP approval amount` })).toBeTruthy()
			})
		}
	}

	test.each([
		[1791988085676923080n, 18, '≈ 1.8', '1.79198808567692308'],
		[1000000000000000001n, 18, '≈ 1.01', '1.000000000000000001'],
		[1n, 18, '≈ 0.01', '0.000000000000000001'],
		[180n, 2, '1.8', '1.8'],
		[1234567n, 0, '≈ 1.24M', '1\u00a0234\u00a0567'],
		[999999n, 0, '≈ 1M', '999\u00a0999'],
		[1000001n * 10n ** 18n, 18, '≈ 1.01M', '1\u00a0000\u00a0001'],
		[10n ** 30n + 1n, 0, undefined, '1\u00a0000\u00a0000\u00a0000\u00a0000\u00a0000\u00a0000\u00a0000\u00a0000\u00a0000\u00a0001'],
	])('rounds button amounts upward while approving the exact value %s', async (amount, units, label, exact) => {
		const approvals: (bigint | undefined)[] = []
		const rendered = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='queueing a commitment'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={0n}
				guardMessage={undefined}
				onApprove={value => approvals.push(value)}
				pending={false}
				pendingLabel='Approving WETH…'
				requiredAmount={amount}
				resetKey='rounded'
				tokenSymbol='WETH'
				tokenUnits={units}
			/>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const button = within(rendered.container).getByRole('button', { name: label === undefined ? 'Approve WETH' : `Approve ${label} WETH` })
		expect(button.querySelector('[title]')?.getAttribute('title')).toBe(`Approve ${exact}\u00a0WETH`)
		await act(() => fireEvent.click(button))
		expect(approvals).toEqual([amount])
	})

	test('rounds the required amount, the shortfall notice and the button in the same upward direction', async () => {
		const requiredAmount = 121_153_846_238_653_846n
		const rendered = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='disputing the report'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={0n}
				guardMessage={undefined}
				onApprove={() => undefined}
				pending={false}
				pendingLabel='Approving WETH…'
				requiredAmount={requiredAmount}
				resetKey='dispute'
				tokenSymbol='WETH'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const queries = within(rendered.container)
		const requiredValue = queries.getByText('Required WETH').parentElement?.querySelector('.currency-value')
		expect(requiredValue?.textContent).toBe('≈ 0.13 WETH')
		expect(requiredValue?.getAttribute('title')).toBe('0.121153846238653846 WETH')
		expect(queries.getByRole('button', { name: 'Approve ≈ 0.13 WETH' })).not.toBeNull()
		expect(rendered.container.textContent).toContain('Need ≈ 0.13\u00a0more\u00a0WETH approved before disputing the report.')
		expect(rendered.container.textContent).not.toContain('0.121153846238653846 more')
	})

	test('shows large required amounts in the same grouped notation as the approved balance', async () => {
		const rendered = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='depositing REP'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={2_250_000n * 10n ** 18n}
				guardMessage={undefined}
				onApprove={() => undefined}
				pending={false}
				pendingLabel='Approving REP…'
				requiredAmount={2_250_000n * 10n ** 18n}
				resetKey='deposit'
				tokenSymbol='REP'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const queries = within(rendered.container)
		const requiredValue = queries.getByText('Required REP').parentElement?.querySelector('.currency-value')
		const approvedValue = queries.getByText('Approved REP').parentElement?.querySelector('.currency-value')
		expect(requiredValue?.textContent).toBe('2\u00a0250\u00a0000.00 REP')
		expect(approvedValue?.textContent).toBe(requiredValue?.textContent)
	})

	test.each([true, false])('preserves partial and invalid notices with showRequirementNotice=%s', async showRequirementNotice => {
		const rendered = await renderIntoDocument(
			<TokenApprovalControl
				showRequirementNotice={showRequirementNotice}
				actionLabel='splitting REP'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={0n}
				guardMessage={undefined}
				onApprove={() => undefined}
				pending={false}
				pendingLabel='Approving REP…'
				requiredAmount={10n ** 18n}
				resetKey='grouped'
				tokenSymbol='REP'
				tokenUnits={18}
				renderActions={({ button, notice, noticeId }) => (
					<TransactionActionGroup id={noticeId} message={notice}>
						{button}
						<TransactionActionButton idleLabel='Split REP' pendingLabel='Splitting REP…' onClick={() => undefined} availability={{ disabled: true, reason: 'Approval required' }} />
					</TransactionActionGroup>
				)}
			/>,
		)
		cleanupRenderedComponent = rendered.cleanup
		const input = within(rendered.container).getByRole('textbox')
		expect(rendered.container.querySelectorAll('.tx-action-notice').length).toBe(showRequirementNotice ? 1 : 0)
		await act(() => fireEvent.input(input, { target: { value: '0.5' } }))
		expect(rendered.container.querySelector('.tx-action-notice')?.textContent).toContain('will still leave')
		await act(() => fireEvent.input(input, { target: { value: 'invalid' } }))
		const notices = rendered.container.querySelectorAll('.tx-action-notice')
		expect(notices.length).toBe(1)
		expect(input.getAttribute('aria-describedby')).toBe(notices[0]?.id)
		expect(notices[0]?.textContent).toBe('Approval amount must be a decimal number.')
		expect(rendered.container.querySelectorAll('.field-error').length).toBe(0)
		expect(within(rendered.container).getByRole('button', { name: 'Approve REP' }).hasAttribute('disabled')).toBe(true)
	})

	test('disables non-increasing custom approvals without rendering the removed validation copy', async () => {
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='submitting the initial report'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={25n * 10n ** 18n}
				guardMessage={undefined}
				onApprove={() => undefined}
				pending={false}
				pendingLabel='Approving WETH…'
				requiredAmount={30n * 10n ** 18n}
				resetKey='weth-approval'
				tokenSymbol='WETH'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.input(documentQueries.getByPlaceholderText('Leave blank for required total'), {
				target: { value: '25' },
			})
		})

		const approveButton = documentQueries.getByRole('button', { name: 'Approve 25 WETH' }) as HTMLButtonElement
		expect(approveButton.disabled).toBe(true)
		expect(documentQueries.queryByText(/must be greater than the current approved/i)).toBeNull()
		expectTransactionButtonDisabled(document.body, 'Approve 25 WETH', 'Already approved 25\u00a0WETH. Enter a higher amount, or leave blank for the required total.')
	})

	test.each([
		['-1', 'Enter a valid non-negative amount.'],
		[(2n ** 256n).toString(), 'Approval amount is too large.'],
	])('rejects the out-of-range approval amount %s with a field error instead of crashing the render', async (value, error) => {
		const approvals: (bigint | undefined)[] = []
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='forking the universe'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={0n}
				guardMessage={undefined}
				onApprove={amount => approvals.push(amount)}
				pending={false}
				pendingLabel='Approving REP…'
				requiredAmount={450_000n * 10n ** 18n}
				resetKey='rep-approval-range'
				tokenSymbol='REP'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await act(() => fireEvent.input(documentQueries.getByPlaceholderText('Leave blank for required total'), { target: { value } }))
		expect(documentQueries.getByText(error).id).not.toBe('')
		const approveButton = documentQueries.getByRole('button', { name: 'Approve REP' }) as HTMLButtonElement
		expect(approveButton.disabled).toBe(true)
		await act(() => fireEvent.click(approveButton))
		expect(approvals).toEqual([])
		await act(() => fireEvent.input(documentQueries.getByPlaceholderText('Leave blank for required total'), { target: { value: '' } }))
		expect(documentQueries.queryByText(error)).toBeNull()
		expect((documentQueries.getByRole('button', { name: 'Approve 450k REP' }) as HTMLButtonElement).disabled).toBe(false)
	})

	test('names an effectively unlimited custom approval on the button', async () => {
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl actionLabel='depositing REP' allowanceError={undefined} allowanceLoading={false} approvedAmount={0n} guardMessage={undefined} onApprove={() => undefined} pending={false} pendingLabel='Approving REP…' requiredAmount={10n} resetKey='rep-approval-unlimited' tokenSymbol='REP' tokenUnits={0} />,
		)
		cleanupRenderedComponent = renderedComponent.cleanup
		const documentQueries = within(document.body)
		await act(() => fireEvent.input(documentQueries.getByPlaceholderText('Leave blank for required total'), { target: { value: (2n ** 256n - 1n).toString() } }))
		expect((documentQueries.getByRole('button', { name: 'Approve unlimited REP' }) as HTMLButtonElement).disabled).toBe(false)
	})

	test.each([true, false])('preserves guard messages with showRequirementNotice=%s', async showRequirementNotice => {
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='submitting the initial report'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={0n}
				showRequirementNotice={showRequirementNotice}
				guardMessage='Connect a wallet before approving.'
				onApprove={() => undefined}
				pending={false}
				pendingLabel='Approving WETH…'
				requiredAmount={10n * 10n ** 18n}
				resetKey='weth-approval-guard'
				tokenSymbol='WETH'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const approveButton = documentQueries.getByRole('button', { name: 'Approve WETH' }) as HTMLButtonElement

		expect(approveButton.disabled).toBe(true)
		expectTransactionButtonDisabled(document.body, 'Approve WETH', 'Connect a wallet before approving.')
	})

	test.each([true, false])('preserves a single allowance error with showRequirementNotice=%s', async showRequirementNotice => {
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='submitting the initial report'
				showRequirementNotice={showRequirementNotice}
				allowanceError='Unable to read current WETH allowance.'
				allowanceLoading={false}
				approvedAmount={0n}
				guardMessage={undefined}
				onApprove={() => undefined}
				pending={false}
				pendingLabel='Approving WETH…'
				requiredAmount={10n * 10n ** 18n}
				resetKey='weth-approval-error'
				tokenSymbol='WETH'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const approveButton = documentQueries.getByRole('button', { name: 'Approve 10 WETH' }) as HTMLButtonElement
		const expectedMessage = 'Unable to verify WETH approval before submitting the initial report. Reason: Unable to read current WETH allowance. Retry loading the approval status before continuing.'

		expect(approveButton.disabled).toBe(true)
		expect(approveButton.getAttribute('title')).toBeNull()
		expect(documentQueries.queryByRole('note')).toBeNull()
		expect(documentQueries.getAllByText(expectedMessage)).toHaveLength(1)
		expect(documentQueries.getByRole('alert').textContent).toContain(expectedMessage)
		expect(getTransactionButtonState(document.body, 'Approve 10 WETH').reason).toBe(expectedMessage)
	})

	test('shows loading state while approval is pending', async () => {
		let approveCalls = 0
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='submitting the initial report'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={0n}
				guardMessage={undefined}
				onApprove={() => {
					approveCalls += 1
				}}
				pending={true}
				pendingLabel='Approving WETH…'
				requiredAmount={10n * 10n ** 18n}
				resetKey='weth-approval-pending'
				tokenSymbol='WETH'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const approveButton = documentQueries.getByRole('button', { name: 'Approving WETH…' }) as HTMLButtonElement

		// The pending button stays focusable so keyboard focus is not dropped while the wallet works.
		expect(approveButton.getAttribute('aria-disabled')).toBe('true')
		fireEvent.click(approveButton)
		expect(approveCalls).toBe(0)
	})

	test('approves exactly the required amount by default and offers no unlimited approval', async () => {
		const approvals: (bigint | undefined)[] = []
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='depositing REP'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={0n}
				guardMessage={undefined}
				onApprove={amount => approvals.push(amount)}
				pending={false}
				pendingLabel='Approving REP…'
				requiredAmount={1200n * 10n ** 18n}
				resetKey='rep-approval-exact'
				tokenSymbol='REP'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByRole('button', { name: /max/i })).toBeNull()
		await act(() => fireEvent.click(documentQueries.getByRole('button', { name: 'Approve 1.2k REP' })))
		expect(approvals).toEqual([1200n * 10n ** 18n])

		await act(() => fireEvent.input(documentQueries.getByPlaceholderText('Leave blank for required total'), { target: { value: 'max' } }))
		expect(documentQueries.getByText('Approval amount must be a decimal number.')).not.toBeNull()
		expect((documentQueries.getByRole('button', { name: 'Approve REP' }) as HTMLButtonElement).disabled).toBe(true)
	})

	test('reports and blocks an invalid custom approval input', async () => {
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='submitting the initial report'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={0n}
				guardMessage={undefined}
				onApprove={() => undefined}
				pending={false}
				pendingLabel='Approving WETH…'
				requiredAmount={10n * 10n ** 18n}
				resetKey='weth-approval-invalid'
				tokenSymbol='WETH'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		await act(() => {
			fireEvent.input(documentQueries.getByPlaceholderText('Leave blank for required total'), {
				target: { value: 'not-a-number' },
			})
		})

		const approveButton = documentQueries.getByRole('button', { name: 'Approve WETH' }) as HTMLButtonElement
		const amountInput = documentQueries.getByPlaceholderText('Leave blank for required total')
		const validationMessage = documentQueries.getByText('Approval amount must be a decimal number.')
		expect(approveButton.disabled).toBe(true)
		expect(approveButton.getAttribute('title')).toBeNull()
		expect(amountInput.getAttribute('aria-describedby')).toBe(validationMessage.id)
		expect(approveButton.getAttribute('aria-describedby')).toBe(validationMessage.id)
		expect(document.body.querySelectorAll('.field-error')).toHaveLength(1)
	})
})

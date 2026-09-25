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
		// The validation error belongs to the field, not the shared action notice, and is not announced as an alert while typing.
		expect(rendered.container.querySelectorAll('.tx-action-notice').length).toBe(0)
		const fieldErrors = rendered.container.querySelectorAll('.field-error')
		expect(fieldErrors.length).toBe(1)
		expect(fieldErrors[0]?.textContent).toBe('Approval amount must be a decimal number.')
		expect(input.getAttribute('aria-describedby')?.split(' ')).toContain(fieldErrors[0]?.id)
		expect(within(rendered.container).queryByRole('alert')).toBeNull()
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

		expect(approveButton.disabled).toBe(true)
		fireEvent.click(approveButton)
		expect(approveCalls).toBe(0)
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
		expect(amountInput.getAttribute('aria-describedby')?.split(' ')).toContain(validationMessage.id)
		expect(approveButton.getAttribute('aria-describedby')).toBe(validationMessage.id)
		expect(document.body.querySelectorAll('.field-error')).toHaveLength(1)
		expect(validationMessage.getAttribute('role')).toBeNull()
	})

	test('offers only the exact required approval until Advanced is opened', async () => {
		const approvals: (bigint | undefined)[] = []
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='depositing REP'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={0n}
				guardMessage={undefined}
				onApprove={amount => {
					approvals.push(amount)
				}}
				pending={false}
				pendingLabel='Approving REP…'
				requiredAmount={450_000n * 10n ** 18n}
				resetKey='exact-approval'
				tokenSymbol='REP'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.queryByText('Required REP')).toBeNull()
		expect(documentQueries.queryByText('Approved REP')).toBeNull()
		const advanced = documentQueries.getByText('Advanced').closest('details')
		expect(advanced?.open).toBe(false)
		expect(documentQueries.getAllByRole('button').map(button => button.textContent)).toEqual(['Approve 450 000\u00a0REP'])
		await act(() => fireEvent.click(documentQueries.getByRole('button', { name: 'Approve 450 000\u00a0REP' })))
		expect(approvals).toEqual([450_000n * 10n ** 18n])
	})

	test('shows a satisfied state instead of an approval button once the allowance covers the requirement', async () => {
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='depositing REP'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={5n * 10n ** 18n}
				guardMessage={undefined}
				onApprove={() => undefined}
				pending={false}
				pendingLabel='Approving REP…'
				requiredAmount={5n * 10n ** 18n}
				resetKey='approved'
				tokenSymbol='REP'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('status').textContent).toBe('✓ REP approved')
		expect(documentQueries.queryByRole('button')).toBeNull()
		expect(documentQueries.queryByText('Advanced')).toBeNull()
	})

	test('keeps unlimited approval behind Advanced with an explicit warning', async () => {
		const approvals: (bigint | undefined)[] = []
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='depositing REP'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={0n}
				guardMessage={undefined}
				onApprove={amount => {
					approvals.push(amount)
				}}
				pending={false}
				pendingLabel='Approving REP…'
				requiredAmount={10n ** 18n}
				resetKey='unlimited'
				tokenSymbol='REP'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const unlimited = documentQueries.getByRole('checkbox', { name: 'Unlimited approval' })
		const warning = document.getElementById(unlimited.getAttribute('aria-describedby') ?? '')
		expect(warning?.textContent).toBe('Unlimited approval lets this contract spend all of your REP, now and later, until you revoke it.')
		expect(warning?.classList.contains('active')).toBe(false)
		await act(() => fireEvent.click(unlimited))
		expect(warning?.classList.contains('active')).toBe(true)
		expect(documentQueries.getByText('Custom approval amount').parentElement?.querySelector('input')?.disabled).toBe(true)
		await act(() => fireEvent.click(documentQueries.getByRole('button', { name: 'Approve unlimited REP' })))
		expect(approvals).toEqual([2n ** 256n - 1n])
	})
})

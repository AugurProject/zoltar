/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from './testUtils/queries'
import { act } from 'preact/test-utils'
import { TokenApprovalControl } from '../components/TokenApprovalControl.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

describe('TokenApprovalControl', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
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
				pendingLabel='Approving WETH...'
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

	test('shows a guard message and keeps approval disabled when approval is guarded', async () => {
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='submitting the initial report'
				allowanceError={undefined}
				allowanceLoading={false}
				approvedAmount={0n}
				guardMessage='Connect a wallet before approving.'
				onApprove={() => undefined}
				pending={false}
				pendingLabel='Approving WETH...'
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
		expect(approveButton.title).toBe('Connect a wallet before approving.')
	})

	test('does not duplicate allowance errors as both disabled reason and error notice', async () => {
		const renderedComponent = await renderIntoDocument(
			<TokenApprovalControl
				actionLabel='submitting the initial report'
				allowanceError='Unable to read current WETH allowance.'
				allowanceLoading={false}
				approvedAmount={0n}
				guardMessage={undefined}
				onApprove={() => undefined}
				pending={false}
				pendingLabel='Approving WETH...'
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
		expect(approveButton.title).toBe(expectedMessage)
		expect(document.body.querySelector('.disabled-reason')).toBeNull()
		expect(documentQueries.getByText(expectedMessage)).toBeDefined()
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
				pendingLabel='Approving WETH...'
				requiredAmount={10n * 10n ** 18n}
				resetKey='weth-approval-pending'
				tokenSymbol='WETH'
				tokenUnits={18}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		const approveButton = documentQueries.getByRole('button', { name: 'Approving WETH...' }) as HTMLButtonElement

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
				pendingLabel='Approving WETH...'
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
		expect(approveButton.disabled).toBe(true)
		expect(approveButton.title).toBe('Approval amount must be a decimal number')
	})
})

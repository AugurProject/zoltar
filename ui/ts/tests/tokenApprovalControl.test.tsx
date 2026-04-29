/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
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
})

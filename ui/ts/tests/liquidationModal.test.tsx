/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { render } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import { zeroAddress } from 'viem'
import { LiquidationModal } from '../components/LiquidationModal.js'
import type { OracleManagerDetails } from '../types/contracts.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

function createOracleManagerDetails(overrides: Partial<OracleManagerDetails> = {}): OracleManagerDetails {
	return {
		callbackStateHash: undefined,
		exactToken1Report: undefined,
		isPriceValid: true,
		lastPrice: 1n,
		lastSettlementTimestamp: 1n,
		managerAddress: zeroAddress,
		openOracleAddress: zeroAddress,
		pendingOperation: undefined,
		pendingOperationSlotId: 0n,
		pendingReportId: 0n,
		priceValidUntilTimestamp: 1000n,
		requestPriceEthCost: 1n,
		token1: zeroAddress,
		token2: zeroAddress,
		...overrides,
	}
}

describe('LiquidationModal', () => {
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

	test('traps focus while open and restores it when closed', async () => {
		let open = true
		const opener = document.createElement('button')
		opener.textContent = 'Open modal'
		document.body.appendChild(opener)
		opener.focus()

		const renderModal = async () =>
			await renderIntoDocument(
				<LiquidationModal
					accountAddress={zeroAddress}
					closeLiquidationModal={() => {
						open = false
					}}
					currentPoolOracleManagerDetails={undefined}
					isMainnet
					liquidationAmount='1'
					liquidationManagerAddress={zeroAddress}
					liquidationModalOpen={open}
					liquidationSecurityPoolAddress={zeroAddress}
					loadingPoolOracleManager={false}
					liquidationTargetVault={zeroAddress}
					onSelectedPoolViewChange={() => undefined}
					onLiquidationAmountChange={() => undefined}
					onLiquidationTargetVaultChange={() => undefined}
					onQueueLiquidation={() => undefined}
					securityPoolOverviewActiveAction={undefined}
					securityPoolOverviewResult={undefined}
				/>,
			)

		let renderedComponent = await renderModal()
		cleanupRenderedComponent = renderedComponent.cleanup

		const closeButton = within(document.body).getByText('Close') as HTMLButtonElement
		const cancelButton = within(document.body).getByText('Cancel') as HTMLButtonElement
		expect(document.activeElement).toBe(closeButton)

		await act(() => {
			fireEvent.keyDown(cancelButton, { key: 'Tab' })
		})
		expect(document.activeElement).toBe(closeButton)

		await act(() => {
			fireEvent.keyDown(closeButton, { key: 'Escape' })
		})

		await renderedComponent.cleanup()
		renderedComponent = await renderModal()
		cleanupRenderedComponent = renderedComponent.cleanup
		expect(document.body.querySelector("[role='dialog']")).toBeNull()
		expect(document.activeElement).toBe(opener)
		opener.remove()
	})

	test('keeps focus on the edited input while the modal rerenders', async () => {
		function LiquidationHarness() {
			const [liquidationAmount, setLiquidationAmount] = useState('1')

			return (
				<LiquidationModal
					accountAddress={zeroAddress}
					closeLiquidationModal={() => undefined}
					currentPoolOracleManagerDetails={undefined}
					isMainnet
					liquidationAmount={liquidationAmount}
					liquidationManagerAddress={zeroAddress}
					liquidationModalOpen
					liquidationSecurityPoolAddress={zeroAddress}
					loadingPoolOracleManager={false}
					liquidationTargetVault={zeroAddress}
					onSelectedPoolViewChange={() => undefined}
					onLiquidationAmountChange={setLiquidationAmount}
					onLiquidationTargetVaultChange={() => undefined}
					onQueueLiquidation={() => undefined}
					securityPoolOverviewActiveAction={undefined}
					securityPoolOverviewResult={undefined}
				/>
			)
		}

		const container = document.createElement('div')
		document.body.appendChild(container)

		await act(() => {
			render(<LiquidationHarness />, container)
		})

		const amountInput = within(container).getByLabelText('Liquidation Amount') as HTMLInputElement
		amountInput.focus()
		expect(document.activeElement).toBe(amountInput)

		await act(() => {
			fireEvent.input(amountInput, { target: { value: '12' } })
		})

		const rerenderedAmountInput = within(container).getByLabelText('Liquidation Amount') as HTMLInputElement
		expect(rerenderedAmountInput.value).toBe('12')
		expect(document.activeElement).toBe(rerenderedAmountInput)

		render(null, container)
		container.remove()
	})

	test('shows queued liquidation details and links to staged operations', async () => {
		const selectedViews: string[] = []
		const renderedComponent = await renderIntoDocument(
			<LiquidationModal
				accountAddress={zeroAddress}
				closeLiquidationModal={() => undefined}
				currentPoolOracleManagerDetails={createOracleManagerDetails({
					pendingOperation: {
						amount: 5n,
						initiatorVault: zeroAddress,
						operation: 'liquidation',
						operationId: 9n,
						targetVault: zeroAddress,
					},
					pendingOperationSlotId: 9n,
				})}
				isMainnet
				liquidationAmount='5'
				liquidationManagerAddress={zeroAddress}
				liquidationModalOpen
				liquidationSecurityPoolAddress={zeroAddress}
				loadingPoolOracleManager={false}
				liquidationTargetVault={zeroAddress}
				onSelectedPoolViewChange={view => {
					selectedViews.push(view ?? '')
				}}
				onLiquidationAmountChange={() => undefined}
				onLiquidationTargetVaultChange={() => undefined}
				onQueueLiquidation={() => undefined}
				securityPoolOverviewActiveAction={undefined}
				securityPoolOverviewResult={{
					action: 'queueLiquidation',
					hash: '0x00000000000000000000000000000000000000000000000000000000000000aa',
					securityPoolAddress: zeroAddress,
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Liquidation Queued' })).not.toBeNull()
		expect(documentQueries.getByText('#9')).not.toBeNull()

		await act(() => {
			fireEvent.click(documentQueries.getByRole('button', { name: 'View In Staged Operations' }))
		})

		expect(selectedViews).toEqual(['staged-operations'])
	})

	test('shows immediate execution when liquidation uses an already valid oracle price', async () => {
		const renderedComponent = await renderIntoDocument(
			<LiquidationModal
				accountAddress={zeroAddress}
				closeLiquidationModal={() => undefined}
				currentPoolOracleManagerDetails={createOracleManagerDetails({
					isPriceValid: true,
					pendingOperation: undefined,
					pendingOperationSlotId: 0n,
				})}
				isMainnet
				liquidationAmount='5'
				liquidationManagerAddress={zeroAddress}
				liquidationModalOpen
				liquidationSecurityPoolAddress={zeroAddress}
				loadingPoolOracleManager={false}
				liquidationTargetVault={zeroAddress}
				onSelectedPoolViewChange={() => undefined}
				onLiquidationAmountChange={() => undefined}
				onLiquidationTargetVaultChange={() => undefined}
				onQueueLiquidation={() => undefined}
				securityPoolOverviewActiveAction={undefined}
				securityPoolOverviewResult={{
					action: 'queueLiquidation',
					hash: '0x00000000000000000000000000000000000000000000000000000000000000aa',
					securityPoolAddress: zeroAddress,
				}}
			/>,
		)
		cleanupRenderedComponent = renderedComponent.cleanup

		const documentQueries = within(document.body)
		expect(documentQueries.getByRole('heading', { name: 'Liquidation Executed' })).not.toBeNull()
		expect(documentQueries.queryByRole('button', { name: 'View In Staged Operations' })).toBeNull()
	})
})

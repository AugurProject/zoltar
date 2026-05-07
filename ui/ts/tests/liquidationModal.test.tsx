/// <reference types="bun-types" />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { fireEvent, within } from '@testing-library/dom'
import { act } from 'preact/test-utils'
import { zeroAddress } from 'viem'
import { LiquidationModal } from '../components/LiquidationModal.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

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
					isMainnet
					liquidationAmount='1'
					liquidationManagerAddress={zeroAddress}
					liquidationModalOpen={open}
					liquidationSecurityPoolAddress={zeroAddress}
					liquidationTargetVault={zeroAddress}
					onLiquidationAmountChange={() => undefined}
					onLiquidationTargetVaultChange={() => undefined}
					onQueueLiquidation={() => undefined}
					securityPoolOverviewActiveAction={undefined}
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
})

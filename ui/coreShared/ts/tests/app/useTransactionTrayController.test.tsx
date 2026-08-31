/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { useTransactionTrayController } from '../../app/hooks/useTransactionTrayController.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { render } from 'preact'

describe('useTransactionTrayController', () => {
	let cleanupDom: (() => void) | undefined
	let cleanupRendered: (() => Promise<void>) | undefined

	beforeEach(() => {
		cleanupDom = installDomEnvironment().cleanup
	})

	afterEach(async () => {
		await cleanupRendered?.()
		cleanupRendered = undefined
		cleanupDom?.()
		cleanupDom = undefined
	})

	test('owns the standard transaction lifecycle and delegates completion', async () => {
		let finishedCount = 0
		let controller: ReturnType<typeof useTransactionTrayController> | undefined
		function Harness() {
			controller = useTransactionTrayController({
				onFinished: () => {
					finishedCount += 1
				},
			})
			return null
		}
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRendered = rendered.cleanup
		if (controller === undefined) throw new Error('Transaction tray controller did not initialize')

		await act(() => {
			controller?.onTransactionRequested({ action: 'createMarket', source: 'zoltar', submittedTitle: 'Creating Question' })
		})
		expect(controller.transactionState.value.inFlightCount).toBe(1)
		expect(controller.transactionState.value.active?.tone).toBe('awaiting-wallet')

		await act(() => {
			controller?.onTransactionSubmitted('0x1234000000000000000000000000000000000000000000000000000000000000')
			controller?.onTransactionFinished()
		})
		expect(controller.transactionState.value.inFlightCount).toBe(0)
		expect(finishedCount).toBe(1)
	})

	test('resets for a replacement environment and ignores callbacks from the previous generation', async () => {
		let controller: ReturnType<typeof useTransactionTrayController> | undefined
		function Harness() {
			controller = useTransactionTrayController()
			return null
		}
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRendered = rendered.cleanup
		if (controller === undefined) throw new Error('Transaction tray controller did not initialize')
		const previousGeneration = controller

		await act(() => {
			previousGeneration.onTransactionRequested({ action: 'createMarket', source: 'zoltar', submittedTitle: 'Creating Question' })
			previousGeneration.onTransactionPresented({ action: 'createMarket', source: 'zoltar', status: { badgeLabel: 'Created', badgeTone: 'success', detail: 'Created', key: 'created' }, submittedTitle: 'Question created' })
			previousGeneration.resetForEnvironment()
		})
		expect(previousGeneration.transactionState.value.active).toBeUndefined()
		expect(previousGeneration.transactionState.value.inFlightCount).toBe(0)

		await act(() => {
			previousGeneration.onTransactionSubmitted('0x1234000000000000000000000000000000000000000000000000000000000000')
			previousGeneration.onTransactionFinished()
		})
		expect(previousGeneration.transactionState.value.active).toBeUndefined()
		expect(previousGeneration.transactionState.value.inFlightCount).toBe(0)

		await act(() => {
			render(<Harness />, rendered.container)
		})
		if (controller === undefined) throw new Error('Transaction tray controller did not rerender')
		await act(() => {
			controller?.onTransactionRequested({ action: 'createMarket', source: 'zoltar', submittedTitle: 'Creating in new environment' })
		})
		expect(controller.transactionState.value.inFlightCount).toBe(1)
	})

	test('rejects a second transaction without replacing the admitted intent', async () => {
		let controller: ReturnType<typeof useTransactionTrayController> | undefined
		function Harness() {
			controller = useTransactionTrayController({ onFinished: () => undefined })
			return null
		}
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRendered = rendered.cleanup
		if (controller === undefined) throw new Error('Transaction tray controller did not initialize')

		let firstAccepted: boolean | void
		let secondAccepted: boolean | void
		await act(() => {
			firstAccepted = controller?.onTransactionRequested({ action: 'createMarket', source: 'zoltar', submittedTitle: 'Creating Question' })
			secondAccepted = controller?.onTransactionRequested({ action: 'deploy', source: 'zoltar', submittedTitle: 'Deploying contracts' })
		})

		expect(firstAccepted).toBe(true)
		expect(secondAccepted).toBe(false)
		expect(controller.transactionState.value.inFlightCount).toBe(1)
		expect(controller.transactionState.value.pendingIntent?.action).toBe('createMarket')
	})
})

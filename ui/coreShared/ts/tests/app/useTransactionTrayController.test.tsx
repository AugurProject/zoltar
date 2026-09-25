/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { act } from 'preact/test-utils'
import { useTransactionTrayController } from '../../app/hooks/useTransactionTrayController.js'
import { getInFlightTransactionCount } from '../../transactions/transactionTray.js'
import { hasPendingTransactionActivity, transactionActivity } from '../../transactions/transactionActivityStore.js'
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
		expect(getInFlightTransactionCount(controller.transactionState.value)).toBe(1)
		expect(controller.transactionState.value.active?.tone).toBe('awaiting-wallet')

		await act(() => {
			controller?.onTransactionSubmitted('0x1234000000000000000000000000000000000000000000000000000000000000')
			controller?.onTransactionFinished()
		})
		expect(getInFlightTransactionCount(controller.transactionState.value)).toBe(0)
		expect(finishedCount).toBe(1)
	})

	test('admits a new transaction after a failed attempt finishes', async () => {
		let controller: ReturnType<typeof useTransactionTrayController> | undefined
		function Harness() {
			controller = useTransactionTrayController()
			return null
		}
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRendered = rendered.cleanup
		if (controller === undefined) throw new Error('Transaction tray controller did not initialize')
		const intent = { action: 'createMarket' as const, source: 'zoltar' as const, submittedTitle: 'Creating Question' }
		await act(() => {
			expect(controller?.onTransactionRequested(intent)).toBe('transaction-request-1')
			controller?.onTransactionFailed('nonce too low')
			controller?.onTransactionFinished()
		})
		expect(getInFlightTransactionCount(controller.transactionState.value)).toBe(0)
		expect(controller.transactionState.value.active?.tone).toBe('error')
		let admitted: string | false | undefined
		await act(() => {
			admitted = controller?.onTransactionRequested(intent)
		})
		expect(admitted).toBe('transaction-request-2')
		expect(controller.transactionState.value.active?.tone).toBe('awaiting-wallet')
		expect(getInFlightTransactionCount(controller.transactionState.value)).toBe(1)
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
		expect(getInFlightTransactionCount(previousGeneration.transactionState.value)).toBe(0)

		await act(() => {
			previousGeneration.onTransactionSubmitted('0x1234000000000000000000000000000000000000000000000000000000000000')
			previousGeneration.onTransactionFinished()
		})
		expect(previousGeneration.transactionState.value.active).toBeUndefined()
		expect(getInFlightTransactionCount(previousGeneration.transactionState.value)).toBe(0)

		await act(() => {
			render(<Harness />, rendered.container)
		})
		if (controller === undefined) throw new Error('Transaction tray controller did not rerender')
		await act(() => {
			controller?.onTransactionRequested({ action: 'createMarket', source: 'zoltar', submittedTitle: 'Creating in new environment' })
		})
		expect(getInFlightTransactionCount(controller.transactionState.value)).toBe(1)
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

		let firstAccepted: string | false | undefined
		let secondAccepted: string | false | undefined
		await act(() => {
			firstAccepted = controller?.onTransactionRequested({ action: 'createMarket', source: 'zoltar', submittedTitle: 'Creating Question' })
			secondAccepted = controller?.onTransactionRequested({ action: 'deploy', source: 'zoltar', submittedTitle: 'Deploying contracts' })
		})

		expect(firstAccepted).toBe('transaction-request-1')
		expect(secondAccepted).toBe(false)
		expect(getInFlightTransactionCount(controller.transactionState.value)).toBe(1)
		expect(controller.transactionState.value.entries[0]?.intent.action).toBe('createMarket')
	})

	test('admits a transaction on another object once the first is broadcast and records both in the activity list', async () => {
		let controller: ReturnType<typeof useTransactionTrayController> | undefined
		function Harness() {
			controller = useTransactionTrayController()
			return null
		}
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRendered = rendered.cleanup
		if (controller === undefined) throw new Error('Transaction tray controller did not initialize')
		transactionActivity.value = { chainId: 1, entries: [], ownerKey: undefined, storageKey: undefined }
		const firstHash = '0x1111000000000000000000000000000000000000000000000000000000000000'
		const secondHash = '0x2222000000000000000000000000000000000000000000000000000000000000'
		const poolA = { action: 'depositRepToVault', scope: ['security-pool:0xa'], source: 'security-vault', submittedTitle: 'Depositing REP' }
		const poolB = { ...poolA, scope: ['security-pool:0xb'] }
		let first: string | false | undefined
		let sameObject: string | false | undefined
		let otherObject: string | false | undefined
		await act(() => {
			first = controller?.onTransactionRequested(poolA)
			controller?.onTransactionSubmitted(firstHash)
			sameObject = controller?.onTransactionRequested(poolA)
			otherObject = controller?.onTransactionRequested(poolB)
			controller?.onTransactionSubmitted(secondHash)
			controller?.onTransactionFailed('Transaction reverted', { kind: 'reverted', requestKey: typeof otherObject === 'string' ? otherObject : undefined })
			controller?.onTransactionFinished(typeof first === 'string' ? first : undefined)
		})

		expect(first).toBe('transaction-request-1')
		expect(sameObject).toBe(false)
		expect(otherObject).toBe('transaction-request-2')
		expect(controller.transactionState.value.entries.map(entry => entry.key)).toEqual(['transaction-request-2'])
		expect(transactionActivity.value.entries.map(entry => [entry.hash, entry.status, entry.failureKind])).toEqual([
			[secondHash, 'failed', 'reverted'],
			[firstHash, 'confirmed', undefined],
		])
		transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
	})

	for (const outcome of ['confirmed', 'rejected'] as const) {
		test(`settles every step of a multi-write action when the last step is ${outcome}`, async () => {
			let controller: ReturnType<typeof useTransactionTrayController> | undefined
			function Harness() {
				controller = useTransactionTrayController()
				return null
			}
			const rendered = await renderIntoDocument(<Harness />)
			cleanupRendered = rendered.cleanup
			if (controller === undefined) throw new Error('Transaction tray controller did not initialize')
			transactionActivity.value = { chainId: 1, entries: [], ownerKey: undefined, storageKey: undefined }
			const approvalHash = '0x1111000000000000000000000000000000000000000000000000000000000000'
			const depositHash = '0x2222000000000000000000000000000000000000000000000000000000000000'
			const preview = { account: '0x00000000000000000000000000000000000000a1', args: undefined, chainName: 'Ethereum', contractAddress: '0x00000000000000000000000000000000000000b2', functionName: 'approve', value: 0n }
			await act(() => {
				const key = controller?.onTransactionRequested({ action: 'depositRepToVault', scope: ['security-pool:0xa'], source: 'security-vault', submittedTitle: 'Depositing REP' })
				const requestKey = typeof key === 'string' ? key : undefined
				controller?.onTransactionPrepared(preview)
				controller?.onTransactionSubmitted(approvalHash)
				controller?.onTransactionPrepared({ ...preview, functionName: 'depositRepToVault' })
				if (outcome === 'confirmed') controller?.onTransactionSubmitted(depositHash)
				else controller?.onTransactionFailed('Action canceled in wallet.', { kind: 'rejected', requestKey })
				controller?.onTransactionFinished(requestKey)
			})

			expect(transactionActivity.value.entries.map(entry => [entry.hash, entry.status])).toEqual(
				outcome === 'confirmed'
					? [
							[depositHash, 'confirmed'],
							[approvalHash, 'confirmed'],
						]
					: [[approvalHash, 'confirmed']],
			)
			expect(hasPendingTransactionActivity(['security-pool:0xa'])).toBeFalse()
			transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
		})
	}

	test('does not attribute a later step of one action to another running action', async () => {
		let controller: ReturnType<typeof useTransactionTrayController> | undefined
		function Harness() {
			controller = useTransactionTrayController()
			return null
		}
		const rendered = await renderIntoDocument(<Harness />)
		cleanupRendered = rendered.cleanup
		if (controller === undefined) throw new Error('Transaction tray controller did not initialize')
		transactionActivity.value = { chainId: 1, entries: [], ownerKey: undefined, storageKey: undefined }
		const firstHash = '0x1111000000000000000000000000000000000000000000000000000000000000'
		const secondHash = '0x2222000000000000000000000000000000000000000000000000000000000000'
		const strayHash = '0x3333000000000000000000000000000000000000000000000000000000000000'
		let firstKey: string | false | undefined
		let secondKey: string | false | undefined
		await act(() => {
			firstKey = controller?.onTransactionRequested({ action: 'depositRepToVault', scope: ['security-pool:0xa'], source: 'security-vault', submittedTitle: 'Depositing REP' })
			controller?.onTransactionSubmitted(firstHash)
			secondKey = controller?.onTransactionRequested({ action: 'depositRepToVault', scope: ['security-pool:0xb'], source: 'security-vault', submittedTitle: 'Depositing REP' })
			controller?.onTransactionSubmitted(secondHash)
			// The first action prepares and sends its next transaction while both are running.
			controller?.onTransactionPrepared({ account: '0x00000000000000000000000000000000000000a1', args: undefined, chainName: 'Ethereum', contractAddress: '0x00000000000000000000000000000000000000b2', functionName: 'approve', value: 0n })
			controller?.onTransactionSubmitted(strayHash)
			controller?.onTransactionFinished(typeof secondKey === 'string' ? secondKey : undefined)
		})

		const state = controller.transactionState.value
		expect(state.entries.map(entry => [entry.key, entry.lifecycle])).toEqual([[firstKey, { phase: 'pending', hash: firstHash }]])
		expect(transactionActivity.value.entries.map(entry => [entry.hash, entry.status])).toEqual([
			[secondHash, 'confirmed'],
			[firstHash, 'pending'],
		])
		transactionActivity.value = { chainId: undefined, entries: [], ownerKey: undefined, storageKey: undefined }
	})
})

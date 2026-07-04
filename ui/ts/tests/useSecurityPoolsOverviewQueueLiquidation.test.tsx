/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { getAddress, zeroAddress } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { createFakeBackend } from './testUtils/fakeBackend.js'
import { waitFor } from './testUtils/queries'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type UseSecurityPoolsOverview = typeof import('../hooks/useSecurityPoolsOverview.js')['useSecurityPoolsOverview']
type UseSecurityPoolsOverviewState = ReturnType<UseSecurityPoolsOverview>

const WALLET_ADDRESS = getAddress('0x0000000000000000000000000000000000000001')

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	const promise = new Promise<T>(promiseResolve => {
		resolve = promiseResolve
	})
	return { promise, resolve }
}

function createHarness(useSecurityPoolsOverview: UseSecurityPoolsOverview, onRender: (state: UseSecurityPoolsOverviewState) => void) {
	return function SecurityPoolsOverviewHarness() {
		const state = useSecurityPoolsOverview({
			accountAddress: WALLET_ADDRESS,
			onTransactionFinished: () => undefined,
			onTransactionPresented: () => undefined,
			onTransactionRequested: () => undefined,
			onTransactionSubmitted: () => undefined,
			refreshState: async () => undefined,
		})

		onRender(state)

		return h('div', {})
	}
}

function requireHookState(state: UseSecurityPoolsOverviewState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')
	return state
}

describe('useSecurityPoolsOverview queueLiquidation', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let restoreActiveEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined

	beforeEach(() => {
		restoreDomEnvironment = installDomEnvironment().cleanup
		restoreActiveEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: WALLET_ADDRESS }))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		restoreActiveEnvironment?.()
		restoreActiveEnvironment = undefined
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
	})

	test('snapshots submitted modal inputs before async preflight completes', async () => {
		const loadOracleManagerQueueOperationEthValueDeferred = createDeferred<bigint>()
		const queueSecurityPoolLiquidation = mock(async () => ({
			action: 'queueLiquidation' as const,
			hash: '0x01',
			securityPoolAddress: zeroAddress,
		}))

		mock.module('../contracts.js', () => ({
			loadAllSecurityPools: mock(async () => []),
			loadOracleManagerQueueOperationEthValue: mock(async () => await loadOracleManagerQueueOperationEthValueDeferred.promise),
			loadSecurityPoolPage: mock(async () => {
				throw new Error('loadSecurityPoolPage should not be called in this test')
			}),
			queueSecurityPoolLiquidation,
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 0n,
			})),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useSecurityPoolsOverview } = await import(`../hooks/useSecurityPoolsOverview.js?case=${crypto.randomUUID()}`)
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(useSecurityPoolsOverview, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).setLiquidationTargetVault('0x0000000000000000000000000000000000000001')
			requireHookState(hookState).setLiquidationAmount('1')
			requireHookState(hookState).setLiquidationTimeoutMinutes('5')
		})

		const queuePromise = act(async () => {
			await requireHookState(hookState).queueLiquidation(zeroAddress, zeroAddress)
		})

		await act(() => {
			requireHookState(hookState).setLiquidationTargetVault('0x0000000000000000000000000000000000000002')
			requireHookState(hookState).setLiquidationAmount('2')
			requireHookState(hookState).setLiquidationTimeoutMinutes('1')
		})

		loadOracleManagerQueueOperationEthValueDeferred.resolve(0n)
		await queuePromise

		expect(queueSecurityPoolLiquidation).toHaveBeenCalledWith(expect.anything(), zeroAddress, '0x0000000000000000000000000000000000000001', 10n ** 18n, 5n * 60n)
	})

	test('ignores stale modal errors after the user edits the form', async () => {
		const loadOracleManagerQueueOperationEthValueDeferred = createDeferred<bigint>()

		mock.module('../contracts.js', () => ({
			loadAllSecurityPools: mock(async () => []),
			loadOracleManagerQueueOperationEthValue: mock(async () => await loadOracleManagerQueueOperationEthValueDeferred.promise),
			loadSecurityPoolPage: mock(async () => {
				throw new Error('loadSecurityPoolPage should not be called in this test')
			}),
			queueSecurityPoolLiquidation: mock(async () => {
				throw new Error('stale queued liquidation failure')
			}),
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({
				getBalance: async () => 0n,
			})),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useSecurityPoolsOverview } = await import(`../hooks/useSecurityPoolsOverview.js?case=${crypto.randomUUID()}`)
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(useSecurityPoolsOverview, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).setLiquidationTargetVault('0x0000000000000000000000000000000000000001')
			requireHookState(hookState).setLiquidationAmount('1')
			requireHookState(hookState).setLiquidationTimeoutMinutes('5')
		})

		const queuePromise = act(async () => {
			await requireHookState(hookState).queueLiquidation(zeroAddress, zeroAddress)
		})

		await act(() => {
			requireHookState(hookState).setLiquidationAmount('2')
		})
		loadOracleManagerQueueOperationEthValueDeferred.resolve(0n)
		await queuePromise

		await waitFor(() => {
			expect(requireHookState(hookState).securityPoolLiquidationError).toBeUndefined()
		})
	})

	test('skips wallet ETH balance reads for zero-cost liquidations', async () => {
		const queueSecurityPoolLiquidation = mock(async () => ({
			action: 'queueLiquidation' as const,
			hash: '0x02',
			securityPoolAddress: zeroAddress,
		}))

		mock.module('../contracts.js', () => ({
			loadAllSecurityPools: mock(async () => []),
			loadOracleManagerQueueOperationEthValue: mock(async () => 0n),
			loadSecurityPoolPage: mock(async () => {
				throw new Error('loadSecurityPoolPage should not be called in this test')
			}),
			queueSecurityPoolLiquidation,
		}))
		mock.module('../lib/clients.js', () => ({
			createConnectedReadClient: mock(() => ({
				getBalance: async () => {
					throw new Error('wallet ETH balance should not be loaded')
				},
			})),
			createWalletWriteClient: mock(() => ({ kind: 'write-client' })),
		}))

		const { useSecurityPoolsOverview } = await import(`../hooks/useSecurityPoolsOverview.js?case=${crypto.randomUUID()}`)
		let hookState: UseSecurityPoolsOverviewState | undefined
		const Harness = createHarness(useSecurityPoolsOverview, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(() => {
			requireHookState(hookState).setLiquidationTargetVault('0x0000000000000000000000000000000000000001')
			requireHookState(hookState).setLiquidationAmount('1')
			requireHookState(hookState).setLiquidationTimeoutMinutes('5')
		})

		await act(async () => {
			await requireHookState(hookState).queueLiquidation(zeroAddress, zeroAddress)
		})

		expect(queueSecurityPoolLiquidation).toHaveBeenCalledTimes(1)
	})
})

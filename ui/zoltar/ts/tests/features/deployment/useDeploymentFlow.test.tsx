/// <reference types='bun-types' />

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import { createWalletClient, custom, getAddress, keccak256, publicActions, type Hash } from '@zoltar/shared/ethereum'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { useDeploymentFlow } from '../../../features/deployment/hooks/useDeploymentFlow.js'
import { createFakeBackend } from '@zoltar/ui-core-shared/tests/testUtils/fakeBackend.js'
import { installDomEnvironment } from '@zoltar/ui-core-shared/tests/testUtils/domEnvironment.js'
import { renderIntoDocument } from '@zoltar/ui-core-shared/tests/testUtils/renderIntoDocument.js'
import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'
import { MAINNET_NETWORK_PROFILE } from '@zoltar/ui-core-shared/lib/networkProfile.js'

type UseDeploymentFlowState = ReturnType<typeof useDeploymentFlow>

const WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000a1')
const NEXT_WALLET_ADDRESS = getAddress('0x00000000000000000000000000000000000000b2')

function requireHookState(state: UseDeploymentFlowState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')

	return state
}

describe('useDeploymentFlow', () => {
	let restoreDomEnvironment: (() => void) | undefined
	let cleanupRenderedComponent: (() => Promise<void>) | undefined
	let resetEnvironment: (() => void) | undefined

	beforeEach(() => {
		const domEnvironment = installDomEnvironment()
		restoreDomEnvironment = domEnvironment.cleanup
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend({ accountAddress: NEXT_WALLET_ADDRESS }))
	})

	afterEach(async () => {
		await cleanupRenderedComponent?.()
		cleanupRenderedComponent = undefined
		resetEnvironment?.()
		resetEnvironment = undefined
		resetActiveEnvironmentForTesting()
		restoreDomEnvironment?.()
		restoreDomEnvironment = undefined
		mock.restore()
	})

	test('does not request a deployment transaction when the active wallet account changed', async () => {
		const deploy = mock(async () => `0x${'1'.repeat(64)}` as Hash)
		const onTransactionRequested = mock(() => undefined)
		const onTransactionFailed = mock(() => undefined)
		const deploymentStatuses: DeploymentStatus[] = [
			{
				address: getAddress('0x00000000000000000000000000000000000000d1'),
				dependencies: [],
				deploy,
				deployed: false,
				expectedRuntimeCodeHash: keccak256('0x1234'),
				id: 'zoltar',
				label: 'Zoltar',
			},
		]
		let hookState: UseDeploymentFlowState | undefined
		const Harness = function DeploymentFlowHarness() {
			hookState = useDeploymentFlow({
				accountAddress: WALLET_ADDRESS,
				deploymentStatuses,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionPrepared: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				setDeploymentStatuses: () => undefined,
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).deployStep('zoltar')
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(deploy).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledWith('Wallet account changed. Review the action with the connected account and try again')
	})

	test('does not request a deployment transaction when the wallet disconnects after selection', async () => {
		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting(createFakeBackend())
		const deploy = mock(async () => `0x${'1'.repeat(64)}` as Hash)
		const onTransactionRequested = mock(() => undefined)
		const onTransactionFailed = mock(() => undefined)
		const deploymentStatuses: DeploymentStatus[] = [
			{
				address: getAddress('0x00000000000000000000000000000000000000d1'),
				dependencies: [],
				deploy,
				deployed: false,
				expectedRuntimeCodeHash: keccak256('0x1234'),
				id: 'zoltar',
				label: 'Zoltar',
			},
		]
		let hookState: UseDeploymentFlowState | undefined
		const Harness = function DeploymentFlowHarness() {
			hookState = useDeploymentFlow({
				accountAddress: WALLET_ADDRESS,
				deploymentStatuses,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionPrepared: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				setDeploymentStatuses: () => undefined,
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).deployStep('zoltar')
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(deploy).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledWith('Wallet account is no longer connected. Reconnect your wallet and try again')
	})

	test('does not request a deployment transaction when the wallet network changed', async () => {
		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting({
			...createFakeBackend({ accountAddress: WALLET_ADDRESS }),
			getChainId: async () => '0x5',
		})
		const deploy = mock(async () => `0x${'1'.repeat(64)}` as Hash)
		const onTransactionRequested = mock(() => undefined)
		const onTransactionFailed = mock(() => undefined)
		const deploymentStatuses: DeploymentStatus[] = [
			{
				address: getAddress('0x00000000000000000000000000000000000000d1'),
				dependencies: [],
				deploy,
				deployed: false,
				id: 'zoltar',
				label: 'Zoltar',
			},
		]
		let hookState: UseDeploymentFlowState | undefined
		const Harness = function DeploymentFlowHarness() {
			hookState = useDeploymentFlow({
				accountAddress: WALLET_ADDRESS,
				deploymentStatuses,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionPrepared: () => undefined,
				onTransactionRequested,
				onTransactionSubmitted: () => undefined,
				setDeploymentStatuses: () => undefined,
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).deployStep('zoltar')
		})

		expect(onTransactionRequested).not.toHaveBeenCalled()
		expect(deploy).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledWith('Transaction failed while attempting to deploy Zoltar. Reason: Wallet network changed. Switch to Ethereum Mainnet and try again')
	})

	test('does not mark a deployment successful when the target code remains absent', async () => {
		const writeClient = createWalletClient({
			account: WALLET_ADDRESS,
			chain: MAINNET_NETWORK_PROFILE.chain,
			transport: custom({
				request: async request => {
					if (request.method === 'eth_getCode') return '0x'
					throw new Error(`Unexpected RPC method ${request.method}`)
				},
			}),
		}).extend(publicActions)
		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting({
			...createFakeBackend({ accountAddress: WALLET_ADDRESS }),
			createWriteClient: () => writeClient,
		})
		const deploy = mock(async () => `0x${'1'.repeat(64)}` as Hash)
		let failedMessage: string | undefined
		const onTransactionFailed = mock((message: string) => {
			failedMessage = message
		})
		const onTransactionPresented = mock(() => undefined)
		const setDeploymentStatuses = mock(() => undefined)
		const deploymentStatuses: DeploymentStatus[] = [
			{
				address: getAddress('0x00000000000000000000000000000000000000d1'),
				dependencies: [],
				deploy,
				deployed: false,
				expectedRuntimeCodeHash: keccak256('0x1234'),
				id: 'zoltar',
				label: 'Zoltar',
			},
		]
		let hookState: UseDeploymentFlowState | undefined
		const Harness = function DeploymentFlowHarness() {
			hookState = useDeploymentFlow({
				accountAddress: WALLET_ADDRESS,
				deploymentStatuses,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				rpcStateRetryWait: async () => undefined,
				setDeploymentStatuses,
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).deployStep('zoltar')
		})

		expect(deploy).toHaveBeenCalledTimes(1)
		expect(setDeploymentStatuses).not.toHaveBeenCalled()
		expect(onTransactionPresented).not.toHaveBeenCalled()
		expect(onTransactionFailed).toHaveBeenCalledTimes(1)
		expect(failedMessage).toBe('Deployment verification failed: no contract code was found at the expected address. Check the selected network and retry.')
		expect(requireHookState(hookState).errorMessage).toBe(failedMessage)
	})

	test('marks deployment successful when expected code appears after an RPC state retry', async () => {
		let codeReadCount = 0
		const writeClient = createWalletClient({
			account: WALLET_ADDRESS,
			chain: MAINNET_NETWORK_PROFILE.chain,
			transport: custom({
				request: async request => {
					if (request.method === 'eth_getCode') {
						codeReadCount += 1
						return codeReadCount < 3 ? '0x' : '0x1234'
					}
					throw new Error(`Unexpected RPC method ${request.method}`)
				},
			}),
		}).extend(publicActions)
		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting({
			...createFakeBackend({ accountAddress: WALLET_ADDRESS }),
			createWriteClient: () => writeClient,
		})
		const deploy = mock(async () => `0x${'1'.repeat(64)}` as Hash)
		const onTransactionFailed = mock(() => undefined)
		const onTransactionPresented = mock(() => undefined)
		const retryDelays: number[] = []
		let deployed = false
		const deploymentStatuses: DeploymentStatus[] = [
			{
				address: getAddress('0x00000000000000000000000000000000000000d1'),
				dependencies: [],
				deploy,
				deployed: false,
				expectedRuntimeCodeHash: keccak256('0x1234'),
				id: 'zoltar',
				label: 'Zoltar',
			},
		]
		let hookState: UseDeploymentFlowState | undefined
		const Harness = function DeploymentFlowHarness() {
			hookState = useDeploymentFlow({
				accountAddress: WALLET_ADDRESS,
				deploymentStatuses,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				rpcStateRetryWait: async delayMilliseconds => {
					retryDelays.push(delayMilliseconds)
				},
				setDeploymentStatuses: update => {
					deployed = update(deploymentStatuses)[0]?.deployed ?? false
				},
			})
			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).deployStep('zoltar')
		})

		expect(deployed).toBe(true)
		expect(retryDelays).toEqual([250])
		expect(onTransactionPresented).toHaveBeenCalledTimes(1)
		expect(onTransactionFailed).not.toHaveBeenCalled()
	})

	test('does not mark a deployment successful when unexpected code is installed', async () => {
		let codeReadCount = 0
		const writeClient = createWalletClient({
			account: WALLET_ADDRESS,
			chain: MAINNET_NETWORK_PROFILE.chain,
			transport: custom({
				request: async request => {
					if (request.method === 'eth_getCode') {
						codeReadCount += 1
						return codeReadCount === 1 ? '0x' : '0x1234'
					}
					throw new Error(`Unexpected RPC method ${request.method}`)
				},
			}),
		}).extend(publicActions)
		resetEnvironment?.()
		resetEnvironment = installActiveEnvironmentForTesting({
			...createFakeBackend({ accountAddress: WALLET_ADDRESS }),
			createWriteClient: () => writeClient,
		})
		const deploy = mock(async () => `0x${'1'.repeat(64)}` as Hash)
		const onTransactionFailed = mock(() => undefined)
		const setDeploymentStatuses = mock(() => undefined)
		const deploymentStatuses: DeploymentStatus[] = [
			{
				address: getAddress('0x00000000000000000000000000000000000000d1'),
				dependencies: [],
				deploy,
				deployed: false,
				expectedRuntimeCodeHash: keccak256('0x5678'),
				id: 'zoltar',
				label: 'Zoltar',
			},
		]
		let hookState: UseDeploymentFlowState | undefined
		const Harness = function DeploymentFlowHarness() {
			hookState = useDeploymentFlow({
				accountAddress: WALLET_ADDRESS,
				deploymentStatuses,
				onTransactionFailed,
				onTransactionFinished: () => undefined,
				onTransactionPresented: () => undefined,
				onTransactionRequested: () => undefined,
				onTransactionSubmitted: () => undefined,
				setDeploymentStatuses,
			})

			return <div />
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await act(async () => {
			await requireHookState(hookState).deployStep('zoltar')
		})

		expect(onTransactionFailed).toHaveBeenCalledTimes(1)
		expect(deploy).toHaveBeenCalledTimes(1)
		expect(setDeploymentStatuses).not.toHaveBeenCalled()
		expect(requireHookState(hookState).errorMessage).toContain('Unexpected runtime code for zoltar')
	})
})

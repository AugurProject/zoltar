/// <reference types="bun-types" />

import { fireEvent, waitFor, within } from '../testUtils/queries'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { useState } from 'preact/hooks'
import { act } from 'preact/test-utils'
import type { Address } from '@zoltar/shared/ethereum'
import { getAddress } from '@zoltar/shared/ethereum'
import type { ChainBackend, ReadClient } from '../../lib/chainBackend.js'
import { getDeploymentSteps } from '../../protocol/index.js'
import { MAINNET_NETWORK_PROFILE, createSimulationProfile, type NetworkProfile } from '../../lib/networkProfile.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../../lib/activeEnvironment.js'
import { installDomEnvironment } from '../testUtils/domEnvironment.js'
import { renderIntoDocument } from '../testUtils/renderIntoDocument.js'
import { useOnchainState, type UseOnchainStateDependencies } from '../../app/hooks/useOnchainState.js'

type UseOnchainStateState = ReturnType<typeof useOnchainState>
type UseOnchainStateOptions = Parameters<typeof useOnchainState>[0]

type UnsubCounter = {
	subscribe: number
	accounts: number
	chain: number
}

type BackendSubscriptionState = {
	stateHandler: (() => void) | undefined
	accountHandler: (() => void) | undefined
	chainHandler: (() => void) | undefined
	readTransportModes: ('provider' | 'rpc')[]
	unsub: UnsubCounter
}

function createDeferred<T>() {
	let resolve: (value: T) => void = () => undefined
	let reject: (reason?: unknown) => void = () => undefined
	const promise = new Promise<T>((promiseResolve, promiseReject) => {
		resolve = promiseResolve
		reject = promiseReject
	})
	return { promise, reject, resolve }
}

function createReadClient({ ethBalance = 0n, blockNumber = 10n, blockTimestamp = BigInt(Math.floor(Date.now() / 1000)) }: { ethBalance?: bigint; blockNumber?: bigint; blockTimestamp?: bigint } = {}) {
	return {
		getBalance: async () => ethBalance,
		getBlock: async () => ({ number: blockNumber, timestamp: blockTimestamp }),
		getChainId: async () => 1,
		readContract: async () => 0n,
		getCode: async () => '0x',
	} as unknown as ReadClient
}

function createBackend({
	accountAddress,
	isBootstrapped = true,
	hasWallet = true,
	requestAccounts,
	getAccounts,
	waitUntilReady,
	profile = MAINNET_NETWORK_PROFILE,
	readClient = createReadClient(),
	bootstrapLabel = 'ready',
	bootstrapProgress = 100,
	isBootstrapping = false,
}: {
	accountAddress?: Address
	isBootstrapped?: boolean
	hasWallet?: boolean
	requestAccounts?: () => Promise<readonly Address[]>
	getAccounts?: () => Promise<readonly Address[]>
	waitUntilReady?: () => Promise<void>
	profile?: NetworkProfile
	readClient?: ReadClient
	bootstrapLabel?: string | undefined
	bootstrapProgress?: number | undefined
	isBootstrapping?: boolean
}) {
	const accounts = accountAddress === undefined ? [] : [accountAddress]
	const subscriptionState: BackendSubscriptionState = {
		stateHandler: undefined,
		accountHandler: undefined,
		chainHandler: undefined,
		readTransportModes: [],
		unsub: { subscribe: 0, accounts: 0, chain: 0 },
	}

	const backend: ChainBackend = {
		bootstrapError: undefined,
		bootstrapLabel,
		bootstrapProgress,
		createReadClient: () => readClient,
		createWriteClient: () => {
			throw new Error('write client is unavailable in this test')
		},
		getAccounts: getAccounts ?? (async () => accounts),
		getChainId: async () => profile.chainIdHex,
		getProvider: () => undefined,
		hasWallet: () => hasWallet,
		id: 'injected',
		isBootstrapped,
		isBootstrapping,
		profile,
		requestAccounts: requestAccounts ?? (async () => accounts),
		setReadTransportMode: mode => {
			subscriptionState.readTransportModes.push(mode)
		},
		subscribe: handler => {
			subscriptionState.stateHandler = handler
			return () => {
				subscriptionState.unsub.subscribe += 1
			}
		},
		subscribeAccountsChanged: handler => {
			subscriptionState.accountHandler = handler
			return () => {
				subscriptionState.unsub.accounts += 1
			}
		},
		subscribeChainChanged: handler => {
			subscriptionState.chainHandler = handler
			return () => {
				subscriptionState.unsub.chain += 1
			}
		},
	}

	if (waitUntilReady !== undefined) {
		backend.waitUntilReady = waitUntilReady
	}

	return { backend, subscriptionState }
}

function createOnchainStateDependencies(overrides: Partial<UseOnchainStateDependencies> = {}): UseOnchainStateDependencies {
	return {
		getDeploymentSteps,
		loadDeploymentStatusOracleSnapshot: mock(async () => ({
			augurPlaceHolderDeployed: false,
			deploymentStatuses: getDeploymentSteps().map(step => ({
				...step,
				deployed: false,
			})),
		})),
		loadErc20Balance: mock(async () => 0n),
		...overrides,
	}
}

function createHarness(dependencies: UseOnchainStateDependencies, onRender: (state: UseOnchainStateState) => void, options?: UseOnchainStateOptions) {
	return function OnchainStateHarness() {
		const state = useOnchainState(options, dependencies)
		onRender(state)

		return h('div', {}, [
			h(
				'button',
				{
					onClick: () => {
						void state.connectWallet()
					},
					type: 'button',
				},
				'Connect wallet',
			),
			h(
				'button',
				{
					onClick: () => {
						void state.refreshState({ loadWalletState: false })
					},
					type: 'button',
				},
				'Refresh state without wallet',
			),
			h(
				'button',
				{
					onClick: () => {
						state.setDeploymentStatuses(current => current.map(step => ({ ...step, deployed: true })))
					},
					type: 'button',
				},
				'Mark deployments deployed',
			),
		])
	}
}

function requireHookState(state: UseOnchainStateState | undefined) {
	if (state === undefined) throw new Error('Hook state unavailable')
	return state
}

let restoreDomEnvironment: (() => void) | undefined
let cleanupRenderedComponent: (() => Promise<void>) | undefined
let originalSetInterval: typeof window.setInterval
let originalClearInterval: typeof window.clearInterval

beforeEach(() => {
	const domEnvironment = installDomEnvironment()
	restoreDomEnvironment = domEnvironment.cleanup
	originalSetInterval = window.setInterval
	originalClearInterval = window.clearInterval
	mock.restore()
})

afterEach(async () => {
	await cleanupRenderedComponent?.()
	cleanupRenderedComponent = undefined
	if (typeof window !== 'undefined' && originalSetInterval !== undefined) window.setInterval = originalSetInterval
	if (typeof window !== 'undefined' && originalClearInterval !== undefined) window.clearInterval = originalClearInterval
	restoreDomEnvironment?.()
	restoreDomEnvironment = undefined
	mock.restore()
	resetActiveEnvironmentForTesting()
})

describe('useOnchainState (integration)', () => {
	const deploymentStatuses = getDeploymentSteps().map(step => ({
		...step,
		deployed: false,
	}))

	test('loads wallet and deployment status data when connected', async () => {
		const account = getAddress('0x00000000000000000000000000000000000000a1')
		const { backend, subscriptionState } = createBackend({
			accountAddress: account,
			readClient: createReadClient({ ethBalance: 123n, blockNumber: 100n, blockTimestamp: 200n }),
		})
		const loadDeploymentStatusOracleSnapshot = mock(async () => ({
			augurPlaceHolderDeployed: false,
			deploymentStatuses,
		}))
		const loadErc20Balance = mock(async () => 555n)

		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot,
			loadErc20Balance,
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).walletBootstrapComplete).toBe(true))

		expect(requireHookState(hookState).accountState).toMatchObject({
			address: account,
			chainId: MAINNET_NETWORK_PROFILE.chainIdHex,
			ethBalance: 123n,
			wethBalance: 555n,
		})
		expect(requireHookState(hookState).hasLoadedDeploymentStatuses).toBe(true)
		expect(requireHookState(hookState).currentBlockNumber).toBe(100n)
		expect(requireHookState(hookState).currentTimestamp).toBe(200n)
		expect(subscriptionState.readTransportModes).toEqual(['provider'])
		expect(loadDeploymentStatusOracleSnapshot).toHaveBeenCalledTimes(1)
		expect(loadErc20Balance).toHaveBeenCalledTimes(1)

		resetEnvironment()
	})

	test('resubscribes and refreshes against a replacement active environment when the nonce changes', async () => {
		const accountA = getAddress('0x00000000000000000000000000000000000000a1')
		const accountB = getAddress('0x00000000000000000000000000000000000000b2')
		const { backend: backendA, subscriptionState: subscriptionsA } = createBackend({
			accountAddress: accountA,
			readClient: createReadClient({ blockNumber: 100n, blockTimestamp: 200n }),
		})
		const { backend: backendB, subscriptionState: subscriptionsB } = createBackend({
			accountAddress: accountB,
			readClient: createReadClient({ blockNumber: 300n, blockTimestamp: 400n }),
		})
		const loadDeploymentStatusOracleSnapshot = mock(async () => ({
			augurPlaceHolderDeployed: false,
			deploymentStatuses,
		}))
		const loadErc20Balance = mock(async () => 0n)

		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot,
			loadErc20Balance,
		})
		let resetEnvironment = installActiveEnvironmentForTesting(backendA)
		let hookState: UseOnchainStateState | undefined
		function Harness() {
			const [activeEnvironmentNonce, setActiveEnvironmentNonce] = useState(0)
			const state = useOnchainState({ activeEnvironmentNonce }, dependencies)
			hookState = state
			return h(
				'button',
				{
					onClick: () => {
						setActiveEnvironmentNonce(currentNonce => currentNonce + 1)
					},
					type: 'button',
				},
				'Refresh environment',
			)
		}
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).accountState.address).toBe(accountA))
		expect(requireHookState(hookState).currentBlockNumber).toBe(100n)
		expect(subscriptionsA.stateHandler).not.toBeUndefined()
		expect(subscriptionsA.accountHandler).not.toBeUndefined()
		expect(subscriptionsA.chainHandler).not.toBeUndefined()

		resetEnvironment = installActiveEnvironmentForTesting(backendB)
		fireEvent.click(within(renderedComponent.container).getByRole('button', { name: 'Refresh environment' }))

		await waitFor(() => expect(requireHookState(hookState).accountState.address).toBe(accountB))
		expect(requireHookState(hookState).currentBlockNumber).toBe(300n)
		expect(subscriptionsA.unsub).toEqual({ accounts: 1, chain: 1, subscribe: 1 })
		expect(subscriptionsB.stateHandler).not.toBeUndefined()
		expect(subscriptionsB.accountHandler).not.toBeUndefined()
		expect(subscriptionsB.chainHandler).not.toBeUndefined()
		expect(loadDeploymentStatusOracleSnapshot).toHaveBeenCalledTimes(2)
		resetEnvironment()
	})

	test('replaces chain-clock polling when the active environment nonce changes', async () => {
		const intervalHandlers: TimerHandler[] = []
		const clearedIntervals: number[] = []
		const originalSetInterval = window.setInterval
		const originalClearInterval = window.clearInterval
		Object.defineProperty(window, 'setInterval', {
			configurable: true,
			value: (handler: TimerHandler) => {
				intervalHandlers.push(handler)
				return intervalHandlers.length
			},
		})
		Object.defineProperty(window, 'clearInterval', {
			configurable: true,
			value: (handle: number | undefined) => {
				if (handle !== undefined) clearedIntervals.push(handle)
			},
		})
		const accountA = getAddress('0x00000000000000000000000000000000000000a1')
		const accountB = getAddress('0x00000000000000000000000000000000000000b2')
		const { backend: backendA } = createBackend({
			accountAddress: accountA,
			readClient: createReadClient({ blockNumber: 100n, blockTimestamp: 200n }),
		})
		const { backend: backendB } = createBackend({
			accountAddress: accountB,
			readClient: createReadClient({ blockNumber: 300n, blockTimestamp: 400n }),
		})
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		})

		try {
			let resetEnvironment = installActiveEnvironmentForTesting(backendA)
			let hookState: UseOnchainStateState | undefined
			function Harness() {
				const [activeEnvironmentNonce, setActiveEnvironmentNonce] = useState(0)
				const state = useOnchainState({ activeEnvironmentNonce }, dependencies)
				hookState = state
				return h(
					'button',
					{
						onClick: () => {
							setActiveEnvironmentNonce(currentNonce => currentNonce + 1)
						},
						type: 'button',
					},
					'Refresh environment',
				)
			}

			const renderedComponent = await renderIntoDocument(h(Harness, {}))
			cleanupRenderedComponent = renderedComponent.cleanup
			await waitFor(() => {
				requireHookState(hookState)
				expect(intervalHandlers.length).toBe(1)
			})
			expect(intervalHandlers.length).toBe(1)

			resetEnvironment = installActiveEnvironmentForTesting(backendB)
			fireEvent.click(within(renderedComponent.container).getByRole('button', { name: 'Refresh environment' }))

			await waitFor(() => expect(intervalHandlers.length).toBe(2))
			expect(clearedIntervals).toEqual([1])
			expect(intervalHandlers.length).toBe(2)
			resetEnvironment()
		} finally {
			Object.defineProperty(window, 'setInterval', {
				configurable: true,
				value: originalSetInterval,
			})
			Object.defineProperty(window, 'clearInterval', {
				configurable: true,
				value: originalClearInterval,
			})
		}
	})

	test('surfaces a blocking error when the configured read RPC is on the wrong chain', async () => {
		const loadDeploymentStatusOracleSnapshot = mock(async () => ({
			augurPlaceHolderDeployed: false,
			deploymentStatuses,
		}))
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot,
			loadErc20Balance: mock(async () => 0n),
		})
		const wrongChainReadClient = {
			...createReadClient(),
			getBlock: async () => ({ number: 999n, timestamp: 1234n }),
			getChainId: async () => 11155111,
		} as ReadClient
		const { backend, subscriptionState } = createBackend({ hasWallet: false, readClient: wrongChainReadClient })
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).readBackendMessage).toBe('Configured read RPC reports chain 11155111, but this app requires Ethereum Mainnet (1).'))
		expect(requireHookState(hookState).currentBlockNumber).toBeUndefined()
		expect(requireHookState(hookState).currentTimestamp).toBeUndefined()
		expect(subscriptionState.readTransportModes).toEqual(['rpc'])
		await act(async () => {
			subscriptionState.stateHandler?.()
			await Promise.resolve()
		})
		expect(requireHookState(hookState).currentBlockNumber).toBeUndefined()
		expect(requireHookState(hookState).currentTimestamp).toBeUndefined()
		expect(loadDeploymentStatusOracleSnapshot).not.toHaveBeenCalled()

		resetEnvironment()
	})

	test('keeps RPC-backed reads active when a connected wallet is on the wrong chain', async () => {
		const account = getAddress('0x00000000000000000000000000000000000000a3')
		const loadDeploymentStatusOracleSnapshot = mock(async () => ({
			augurPlaceHolderDeployed: false,
			deploymentStatuses,
		}))
		const loadErc20Balance = mock(async () => 777n)
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot,
			loadErc20Balance,
		})
		const rpcBlockTimestamp = BigInt(Math.floor(Date.now() / 1000))
		const rpcReadClient = {
			...createReadClient({ blockNumber: 321n, blockTimestamp: rpcBlockTimestamp, ethBalance: 123n }),
			getChainId: async () => 1,
		} as ReadClient
		const { backend, subscriptionState } = createBackend({
			accountAddress: account,
			profile: MAINNET_NETWORK_PROFILE,
			readClient: rpcReadClient,
		})
		backend.getChainId = async () => '0xaa36a7'
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).walletBootstrapComplete).toBe(true))

		expect(requireHookState(hookState).accountState).toMatchObject({
			address: account,
			chainId: '0xaa36a7',
			ethBalance: undefined,
			wethBalance: undefined,
		})
		expect(requireHookState(hookState).readBackendMessage).toBeUndefined()
		expect(requireHookState(hookState).currentBlockNumber).toBe(321n)
		expect(requireHookState(hookState).currentTimestamp).toBe(rpcBlockTimestamp)
		expect(requireHookState(hookState).hasLoadedDeploymentStatuses).toBe(true)
		expect(subscriptionState.readTransportModes).toEqual(['rpc'])
		expect(loadDeploymentStatusOracleSnapshot).toHaveBeenCalledTimes(1)

		resetEnvironment()
	})

	test('uses the active backend label when surfacing a read-RPC chain mismatch', async () => {
		const loadDeploymentStatusOracleSnapshot = mock(async () => ({
			augurPlaceHolderDeployed: false,
			deploymentStatuses,
		}))
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot,
			loadErc20Balance: mock(async () => 0n),
		})
		const wrongChainReadClient = {
			...createReadClient(),
			getChainId: async () => 11155111,
		} as ReadClient
		const profile = createSimulationProfile({
			genesisRepTokenAddress: getAddress('0x00000000000000000000000000000000000000f1'),
			wethAddress: getAddress('0x00000000000000000000000000000000000000f2'),
		})
		const { backend } = createBackend({ hasWallet: false, profile, readClient: wrongChainReadClient })
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).readBackendMessage).toBe('Configured read RPC reports chain 11155111, but this app requires Browser Simulation (1337).'))
		expect(loadDeploymentStatusOracleSnapshot).not.toHaveBeenCalled()

		resetEnvironment()
	})

	test('surfaces deployment status refresh failures', async () => {
		const account = getAddress('0x00000000000000000000000000000000000000a2')
		const { backend } = createBackend({
			accountAddress: account,
			readClient: createReadClient(),
		})
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => {
				throw new Error('deployment status RPC failed')
			}),
			loadErc20Balance: mock(async () => 111n),
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).errorMessage).toBe('Failed to refresh deployment status. Reason: deployment status RPC failed'))
		expect(requireHookState(hookState).hasLoadedDeploymentStatuses).toBe(false)
		resetEnvironment()
	})

	test('surfaces wallet refresh failures', async () => {
		const { backend } = createBackend({
			getAccounts: async () => {
				throw new Error('wallet connect failed')
			},
		})
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: true,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).errorMessage).toBe('Failed to refresh wallet state. Reason: wallet connect failed'))
		expect(requireHookState(hookState).walletBootstrapComplete).toBe(true)
		resetEnvironment()
	})

	test('shows a wallet-install message when connectWallet is requested without a wallet provider', async () => {
		const { backend } = createBackend({
			hasWallet: false,
		})
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		const connectButton = within(document.body).getByRole('button', { name: 'Connect wallet' })
		await act(async () => {
			fireEvent.click(connectButton)
		})

		expect(requireHookState(hookState).errorMessage).toBe('No wallet detected. Install or enable a wallet to continue.')
		expect(requireHookState(hookState).isConnectingWallet).toBe(false)
		resetEnvironment()
	})

	test('treats recoverable chain-clock reads as missing block and timestamp data', async () => {
		const account = getAddress('0x00000000000000000000000000000000000000a4')
		const readClient = {
			getBalance: async () => 123n,
			getBlock: async () => {
				const error = new Error('block RPC failed')
				error.name = 'ContractFunctionExecutionError'
				throw error
			},
			readContract: async () => 0n,
			getCode: async () => '0x',
		} as unknown as ReadClient
		const { backend } = createBackend({
			accountAddress: account,
			readClient,
		})
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 222n),
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).walletBootstrapComplete).toBe(true))

		expect(requireHookState(hookState).currentBlockNumber).toBeUndefined()
		expect(requireHookState(hookState).currentTimestamp).toBeUndefined()
		expect(requireHookState(hookState).errorMessage).toBeUndefined()
		resetEnvironment()
	})

	test('updates bootstrap state and chain clock from backend subscription events', async () => {
		const account = getAddress('0x00000000000000000000000000000000000000a5')
		let currentBlockNumber = 10n
		let currentTimestamp = 20n
		const readClient = {
			getBalance: async () => 123n,
			getBlock: async () => ({ number: currentBlockNumber, timestamp: currentTimestamp }),
			readContract: async () => 0n,
			getCode: async () => '0x',
		} as unknown as ReadClient
		const { backend, subscriptionState } = createBackend({
			accountAddress: account,
			readClient,
		})
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 333n),
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).currentBlockNumber).toBe(10n))

		backend.bootstrapError = 'bootstrap failed'
		backend.bootstrapLabel = 'retrying'
		backend.bootstrapProgress = 45
		backend.isBootstrapped = true
		currentBlockNumber = 99n
		currentTimestamp = 1234n

		await act(async () => {
			subscriptionState.stateHandler?.()
			await Promise.resolve()
		})

		await waitFor(() => expect(requireHookState(hookState).currentBlockNumber).toBe(99n))
		expect(requireHookState(hookState).currentTimestamp).toBe(1234n)
		expect(requireHookState(hookState).environmentBootstrapError).toBe('bootstrap failed')
		expect(requireHookState(hookState).environmentBootstrapLabel).toBe('retrying')
		expect(requireHookState(hookState).environmentBootstrapProgress).toBe(45)
		expect(requireHookState(hookState).environmentReady).toBe(true)
		resetEnvironment()
	})

	test('prevents concurrent connectWallet calls and reports connection failures', async () => {
		const account = getAddress('0x00000000000000000000000000000000000000a3')
		const connectDeferred = createDeferred<readonly Address[]>()
		let requestAccountsCalls = 0
		const { backend } = createBackend({
			requestAccounts: async () => {
				requestAccountsCalls += 1
				return await connectDeferred.promise
			},
			getAccounts: async () => [account],
		})

		const loadDeploymentStatusOracleSnapshot = mock(async () => ({
			augurPlaceHolderDeployed: false,
			deploymentStatuses,
		}))
		const loadErc20Balance = mock(async () => 0n)
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot,
			loadErc20Balance,
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		const connectButton = within(document.body).getByRole('button', { name: 'Connect wallet' })

		await act(async () => {
			fireEvent.click(connectButton)
		})
		await waitFor(() => expect(requireHookState(hookState).isConnectingWallet).toBe(true))

		await act(async () => {
			fireEvent.click(connectButton)
		})
		expect(requestAccountsCalls).toBe(1)

		connectDeferred.reject(new Error('wallet rejected'))
		await waitFor(() => expect(requireHookState(hookState).errorMessage).toBe('Wallet connection failed. Reason: wallet rejected'))
		expect(requireHookState(hookState).isConnectingWallet).toBe(false)
		resetEnvironment()
	})

	test('surfaces wallet authorization rejections during connectWallet', async () => {
		const { backend } = createBackend({
			requestAccounts: async () => {
				throw new Error('User denied account authorization')
			},
		})

		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		const connectButton = within(document.body).getByRole('button', { name: 'Connect wallet' })

		await act(async () => {
			fireEvent.click(connectButton)
		})

		await waitFor(() => expect(requireHookState(hookState).errorMessage).toBe('Action canceled in wallet.'))
		expect(requireHookState(hookState).isConnectingWallet).toBe(false)
		resetEnvironment()
	})

	test('handles bootstrap wait-success and bootstrap wait-failure paths', async () => {
		const readySignal = createDeferred<void>()
		const { backend } = createBackend({
			isBootstrapped: false,
			bootstrapLabel: 'warming up',
			bootstrapProgress: 2,
			waitUntilReady: async () => {
				await readySignal.promise
			},
			readClient: createReadClient({ ethBalance: 0n, blockNumber: 1n, blockTimestamp: 2n }),
		})
		let dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		})
		const resetSuccessEnvironment = installActiveEnvironmentForTesting(backend)
		let successState: UseOnchainStateState | undefined
		const SuccessHarness = createHarness(dependencies, state => {
			successState = state
		})
		const successRender = await renderIntoDocument(h(SuccessHarness, {}))
		cleanupRenderedComponent = async () => {
			await successRender.cleanup()
		}

		expect(requireHookState(successState).environmentReady).toBe(false)
		backend.isBootstrapped = true
		backend.bootstrapLabel = 'ready'
		backend.bootstrapProgress = 100
		readySignal.resolve()

		await waitFor(() => expect(requireHookState(successState).environmentReady).toBe(true))
		expect(requireHookState(successState).environmentBootstrapLabel).toBe('ready')
		await successRender.cleanup()
		cleanupRenderedComponent = undefined
		resetSuccessEnvironment()

		const failureSignal = createDeferred<void>()
		const failureBackend = createBackend({
			isBootstrapped: false,
			waitUntilReady: async () => {
				await failureSignal.promise
			},
		}).backend
		dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		})
		const resetFailureEnvironment = installActiveEnvironmentForTesting(failureBackend)
		let failureState: UseOnchainStateState | undefined
		const FailureHarness = createHarness(dependencies, state => {
			failureState = state
		})
		const failureRender = await renderIntoDocument(h(FailureHarness, {}))
		cleanupRenderedComponent = async () => {
			await failureRender.cleanup()
		}

		failureSignal.reject(new Error('bootstrap unavailable'))
		await waitFor(() => expect(requireHookState(failureState).environmentBootstrapError).toBe('Failed to bootstrap simulation environment. Reason: bootstrap unavailable'))
		await failureRender.cleanup()
		cleanupRenderedComponent = undefined
		resetFailureEnvironment()
	})

	test('supports state refresh without wallet state loading', async () => {
		const account = getAddress('0x00000000000000000000000000000000000000a4')
		const getAccounts = mock(async () => [account])
		const { backend } = createBackend({
			accountAddress: account,
			isBootstrapped: true,
			getAccounts,
		})
		const loadDeploymentStatusOracleSnapshot = mock(async () => ({
			augurPlaceHolderDeployed: false,
			deploymentStatuses,
		}))
		const loadErc20Balance = mock(async () => 0n)
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot,
			loadErc20Balance,
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		const noWalletButton = within(document.body).getByRole('button', { name: 'Refresh state without wallet' })

		await waitFor(() => expect(requireHookState(hookState).hasLoadedDeploymentStatuses).toBe(true))
		getAccounts.mockClear()
		loadErc20Balance.mockClear()

		await act(async () => {
			fireEvent.click(noWalletButton)
		})

		expect(getAccounts).toHaveBeenCalledTimes(0)
		expect(loadErc20Balance).toHaveBeenCalledTimes(0)
		expect(requireHookState(hookState).hasLoadedDeploymentStatuses).toBe(true)
		expect(requireHookState(hookState).isRefreshing).toBe(false)
		expect(requireHookState(hookState).walletBootstrapComplete).toBe(true)
		resetEnvironment()
	})

	test('wallet-only refresh updates balances without rereading deployment status or chain clock', async () => {
		const account = getAddress('0x00000000000000000000000000000000000000a6')
		let ethBalance = 123n
		let wethBalance = 555n
		let blockNumber = 100n
		let blockTimestamp = 200n
		let getBlockCalls = 0
		const readClient = {
			getBalance: async () => ethBalance,
			getBlock: async () => {
				getBlockCalls += 1
				return { number: blockNumber, timestamp: blockTimestamp }
			},
			getChainId: async () => 1,
			readContract: async () => 0n,
			getCode: async () => '0x',
		} as unknown as ReadClient
		const { backend } = createBackend({
			accountAddress: account,
			readClient,
		})
		const loadDeploymentStatusOracleSnapshot = mock(async () => ({
			augurPlaceHolderDeployed: false,
			deploymentStatuses,
		}))
		const loadErc20Balance = mock(async () => wethBalance)
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot,
			loadErc20Balance,
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).walletBootstrapComplete).toBe(true))
		expect(requireHookState(hookState).accountState.ethBalance).toBe(123n)
		expect(requireHookState(hookState).accountState.wethBalance).toBe(555n)
		expect(requireHookState(hookState).currentBlockNumber).toBe(100n)
		expect(requireHookState(hookState).currentTimestamp).toBe(200n)
		expect(loadDeploymentStatusOracleSnapshot).toHaveBeenCalledTimes(1)
		expect(loadErc20Balance).toHaveBeenCalledTimes(1)
		const initialGetBlockCalls = getBlockCalls

		ethBalance = 999n
		wethBalance = 777n
		blockNumber = 999n
		blockTimestamp = 888n

		await act(async () => {
			await requireHookState(hookState).refreshState({
				loadChainClock: false,
				loadDeploymentState: false,
			})
		})

		await waitFor(() => {
			expect(requireHookState(hookState).accountState.ethBalance).toBe(999n)
			expect(requireHookState(hookState).accountState.wethBalance).toBe(777n)
		})
		expect(requireHookState(hookState).currentBlockNumber).toBe(100n)
		expect(requireHookState(hookState).currentTimestamp).toBe(200n)
		expect(loadDeploymentStatusOracleSnapshot).toHaveBeenCalledTimes(1)
		expect(loadErc20Balance).toHaveBeenCalledTimes(2)
		expect(getBlockCalls).toBe(initialGetBlockCalls)
		resetEnvironment()
	})

	test('executes backend subscriptions and unsubscribes on cleanup', async () => {
		const { backend, subscriptionState } = createBackend({
			readClient: createReadClient({ ethBalance: 3n }),
		})
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(subscriptionState.stateHandler).toBeDefined())
		backend.bootstrapError = 'warn'
		backend.bootstrapLabel = 'from callback'
		backend.bootstrapProgress = 11
		subscriptionState.stateHandler?.()

		await waitFor(() => expect(requireHookState(hookState).environmentBootstrapLabel).toBe('from callback'))
		await renderedComponent.cleanup()
		cleanupRenderedComponent = undefined
		expect(subscriptionState.unsub.subscribe).toBe(1)
		expect(subscriptionState.unsub.accounts).toBe(1)
		expect(subscriptionState.unsub.chain).toBe(1)
		resetEnvironment()
	})

	test('updates placeholder state when all deployment statuses are marked deployed', async () => {
		const { backend } = createBackend({
			readClient: createReadClient({ ethBalance: 4n }),
		})
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps: () => deploymentStatuses,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).augurPlaceHolderDeployed).toBe(false))
		const deployButton = within(document.body).getByRole('button', { name: 'Mark deployments deployed' })
		await act(async () => {
			fireEvent.click(deployButton)
		})

		await waitFor(() => expect(requireHookState(hookState).augurPlaceHolderDeployed).toBe(true))
		expect(requireHookState(hookState).environmentReady).toBe(true)
		resetEnvironment()
	})

	test('sets and clears chain clock interval when backend is ready', async () => {
		const setIntervalMock = mock((_callback: () => void, _ms: number) => 42)
		const clearIntervalMock = mock((_id: number | NodeJS.Timeout) => undefined)
		window.setInterval = setIntervalMock as unknown as typeof window.setInterval
		window.clearInterval = clearIntervalMock as unknown as typeof window.clearInterval

		const { backend } = createBackend({
			isBootstrapped: true,
		})
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(dependencies, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).environmentReady).toBe(true))
		await waitFor(() => expect(setIntervalMock).toHaveBeenCalledTimes(1))
		await renderedComponent.cleanup()
		cleanupRenderedComponent = undefined
		expect(clearIntervalMock).toHaveBeenCalledTimes(1)
		resetEnvironment()
	})

	test('can disable chain-clock polling while still loading deployment statuses and balances', async () => {
		const setIntervalMock = mock((_callback: () => void, _ms: number) => 42)
		window.setInterval = setIntervalMock as unknown as typeof window.setInterval
		const account = getAddress('0x00000000000000000000000000000000000000a7')
		let getBlockCalls = 0
		const readClient = {
			getBalance: async () => 321n,
			getBlock: async () => {
				getBlockCalls += 1
				return { number: 44n, timestamp: 55n }
			},
			getChainId: async () => 1,
			readContract: async () => 0n,
			getCode: async () => '0x',
		} as unknown as ReadClient
		const { backend } = createBackend({
			accountAddress: account,
			isBootstrapped: true,
			readClient,
		})
		const loadDeploymentStatusOracleSnapshot = mock(async () => ({
			augurPlaceHolderDeployed: false,
			deploymentStatuses,
		}))
		const loadErc20Balance = mock(async () => 654n)
		const dependencies = createOnchainStateDependencies({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot,
			loadErc20Balance,
		})
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(
			dependencies,
			state => {
				hookState = state
			},
			{ enableChainClock: false },
		)
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

		await waitFor(() => expect(requireHookState(hookState).walletBootstrapComplete).toBe(true))
		expect(requireHookState(hookState).hasLoadedDeploymentStatuses).toBe(true)
		expect(requireHookState(hookState).accountState.ethBalance).toBe(321n)
		expect(requireHookState(hookState).accountState.wethBalance).toBe(654n)
		expect(requireHookState(hookState).currentBlockNumber).toBeUndefined()
		expect(requireHookState(hookState).currentTimestamp).toBeUndefined()
		expect(loadDeploymentStatusOracleSnapshot).toHaveBeenCalledTimes(1)
		expect(loadErc20Balance).toHaveBeenCalledTimes(1)
		expect(getBlockCalls).toBe(0)
		expect(setIntervalMock).toHaveBeenCalledTimes(0)
		resetEnvironment()
	})
})

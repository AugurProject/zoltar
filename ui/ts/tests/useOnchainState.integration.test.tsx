/// <reference types="bun-types" />

import { fireEvent, waitFor, within } from '@testing-library/dom'
import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { h } from 'preact'
import { act } from 'preact/test-utils'
import type { Address } from 'viem'
import { getAddress } from 'viem'
import type { ChainBackend, ReadClient } from '../lib/chainBackend.js'
import { getDeploymentSteps } from '../contracts.js'
import { MAINNET_NETWORK_PROFILE, type NetworkProfile } from '../lib/networkProfile.js'
import { installActiveEnvironmentForTesting, resetActiveEnvironmentForTesting } from '../lib/activeEnvironment.js'
import { installDomEnvironment } from './testUtils/domEnvironment.js'
import { renderIntoDocument } from './testUtils/renderIntoDocument.js'

type UseOnchainState = typeof import('../hooks/useOnchainState.js')['useOnchainState']
type UseOnchainStateState = ReturnType<UseOnchainState>

type UnsubCounter = {
	subscribe: number
	accounts: number
	chain: number
}

type BackendSubscriptionState = {
	stateHandler: (() => void) | undefined
	accountHandler: (() => void) | undefined
	chainHandler: (() => void) | undefined
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

function createReadClient({ ethBalance = 0n, blockNumber = 10n, blockTimestamp = 20n }: { ethBalance?: bigint; blockNumber?: bigint; blockTimestamp?: bigint } = {}) {
	return {
		getBalance: async () => ethBalance,
		getBlock: async () => ({ number: blockNumber, timestamp: blockTimestamp }),
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
		setReadTransportMode: () => undefined,
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

function createHarness(useOnchainState: UseOnchainState, onRender: (state: UseOnchainStateState) => void) {
	return function OnchainStateHarness() {
		const state = useOnchainState()
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
		const { backend } = createBackend({
			accountAddress: account,
			readClient: createReadClient({ ethBalance: 123n, blockNumber: 100n, blockTimestamp: 200n }),
		})
		const loadDeploymentStatusOracleSnapshot = mock(async () => ({
			augurPlaceHolderDeployed: false,
			deploymentStatuses,
		}))
		const loadErc20Balance = mock(async () => 555n)

		mock.module('../contracts.js', () => ({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot,
			loadErc20Balance,
		}))

		const { useOnchainState } = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(useOnchainState, state => {
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
		expect(loadDeploymentStatusOracleSnapshot).toHaveBeenCalledTimes(1)
		expect(loadErc20Balance).toHaveBeenCalledTimes(1)

		resetEnvironment()
	})

	test('surfaces deployment status refresh failures', async () => {
		const account = getAddress('0x00000000000000000000000000000000000000a2')
		const { backend } = createBackend({
			accountAddress: account,
			readClient: createReadClient(),
		})
		mock.module('../contracts.js', () => ({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => {
				throw new Error('deployment status RPC failed')
			}),
			loadErc20Balance: mock(async () => 111n),
		}))

		const { useOnchainState } = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(useOnchainState, state => {
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
		mock.module('../contracts.js', () => ({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: true,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		}))

		const { useOnchainState } = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(useOnchainState, state => {
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
		mock.module('../contracts.js', () => ({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		}))

		const { useOnchainState } = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(useOnchainState, state => {
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
		mock.module('../contracts.js', () => ({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 222n),
		}))

		const { useOnchainState } = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(useOnchainState, state => {
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
		mock.module('../contracts.js', () => ({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 333n),
		}))

		const { useOnchainState } = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(useOnchainState, state => {
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
		mock.module('../contracts.js', () => ({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot,
			loadErc20Balance,
		}))

		const { useOnchainState } = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(useOnchainState, state => {
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
		mock.module('../contracts.js', () => ({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		}))

		const successModule = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetSuccessEnvironment = installActiveEnvironmentForTesting(backend)
		let successState: UseOnchainStateState | undefined
		const SuccessHarness = createHarness(successModule.useOnchainState, state => {
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
		mock.module('../contracts.js', () => ({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		}))

		const failureModule = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetFailureEnvironment = installActiveEnvironmentForTesting(failureBackend)
		let failureState: UseOnchainStateState | undefined
		const FailureHarness = createHarness(failureModule.useOnchainState, state => {
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
		mock.module('../contracts.js', () => ({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot,
			loadErc20Balance,
		}))

		const { useOnchainState } = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(useOnchainState, state => {
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

	test('executes backend subscriptions and unsubscribes on cleanup', async () => {
		const { backend, subscriptionState } = createBackend({
			readClient: createReadClient({ ethBalance: 3n }),
		})
		mock.module('../contracts.js', () => ({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		}))

		const { useOnchainState } = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(useOnchainState, state => {
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
		mock.module('../contracts.js', () => ({
			getDeploymentSteps: () => deploymentStatuses,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		}))

		const { useOnchainState } = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(useOnchainState, state => {
			hookState = state
		})
		const renderedComponent = await renderIntoDocument(h(Harness, {}))
		cleanupRenderedComponent = renderedComponent.cleanup

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
		mock.module('../contracts.js', () => ({
			getDeploymentSteps,
			loadDeploymentStatusOracleSnapshot: mock(async () => ({
				augurPlaceHolderDeployed: false,
				deploymentStatuses,
			})),
			loadErc20Balance: mock(async () => 0n),
		}))

		const { useOnchainState } = await import(`../hooks/useOnchainState.js?case=${crypto.randomUUID()}`)
		const resetEnvironment = installActiveEnvironmentForTesting(backend)
		let hookState: UseOnchainStateState | undefined
		const Harness = createHarness(useOnchainState, state => {
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
})

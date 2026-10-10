import { withTimeout } from '../lib/promise.js'
import { createPublicClient, createWalletClient, custom, publicActions, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ChainBackend, WriteClient } from '../wallet/chainBackend.js'
import { normalizeAccount } from '../wallet/chainBackend.js'
import { createSimulationProfile, getGenesisNetworkProfile } from '../wallet/networkProfile.js'
import type { GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import type { SimulationController } from './controller.js'
import { predictSimulationTokenAddresses } from './bootstrap.js'
import type { SimulationScenario } from './scenarios.js'
import type { SavedSimulationStateEnvelopeV1, SimulationInitialization } from './savedStates.js'
import { createSimulationProvider, type SimulationProviderRequest } from './simulationProvider.js'
import { DEFAULT_SIMULATION_WALLET_MODE, SIMULATION_WRONG_CHAIN_ID_HEX, type SimulationWalletMode } from './simulationWallet.js'
import { withTransactionCallbacks } from './writeClientCallbacks.js'
import type { SimulationWorkerCallMap, SimulationWorkerCallMessage, SimulationWorkerCallMethod, SimulationWorkerEvent, SimulationWorkerMessage, SimulationWorkerResultValue, SimulationWorkerRpcMessage, SimulationWorkerState } from './tevmWorkerProtocol.js'

const QA_ACCOUNTS = [normalizeAccount('0x00000000000000000000000000000000000000a1'), normalizeAccount('0x00000000000000000000000000000000000000b2'), normalizeAccount('0x00000000000000000000000000000000000000c3')].filter((account): account is Address => account !== undefined)

const WORKER_REQUEST_TIMEOUT_MILLISECONDS = 120_000
// These calls run a whole scenario seeding script as one request, which can legitimately outlast an ordinary request
// on a slow machine. The worker reports progress while it seeds, so each report restarts their timeout instead.
const PROGRESS_REPORTING_CALLS: ReadonlySet<SimulationWorkerCallMethod> = new Set(['bootstrap', 'reset', 'waitUntilReady'])

type PendingRequest = {
	reject: (error: Error) => void
	resolve: (value: SimulationWorkerResultValue) => void
}

type WorkerRequestMessage = Omit<SimulationWorkerCallMessage, 'id'> | Omit<SimulationWorkerRpcMessage, 'id'>

type SimulationWorkerConnection = {
	clearHandlers: () => void
	postMessage: (message: SimulationWorkerMessage) => void
	setErrorHandler: (handler: (event: ErrorEvent) => void) => void
	setMessageErrorHandler: (handler: () => void) => void
	setMessageHandler: (handler: (event: MessageEvent<SimulationWorkerEvent>) => void) => void
	terminate: () => void
}

type CreateSimulationBackendDependencies = {
	createWorkerConnection?: (workerPath: URL) => SimulationWorkerConnection
}

type SimulationBackend = ChainBackend &
	SimulationController & {
		bootstrap(): Promise<void>
	}

function createListenerMap() {
	return {
		accountsChanged: new Set<() => void>(),
		chainChanged: new Set<() => void>(),
		state: new Set<() => void>(),
	}
}

function emitListeners(listeners: ReturnType<typeof createListenerMap>, eventName: 'accountsChanged' | 'chainChanged' | 'state') {
	for (const listener of listeners[eventName]) {
		listener()
	}
}

function resolveWorkerPath(appId: 'zoltar' | 'statoblast' | 'trading' = 'zoltar') {
	const currentUrl = new URL(import.meta.url)
	if (currentUrl.protocol === 'file:') return new URL(`../../../${appId}/ts/simulation/tevmWorker.ts`, import.meta.url)
	if (currentUrl.pathname.includes('/assets/')) return new URL('./tevmWorker.worker.js', import.meta.url)
	return new URL(`../../../${appId}/js/simulation/tevmWorker.worker.js`, import.meta.url)
}

function createWorkerConnection(workerPath: URL): SimulationWorkerConnection {
	const worker = new Worker(workerPath, { type: 'module' })
	return {
		clearHandlers: () => {
			worker.onmessage = null
			worker.onerror = null
			worker.onmessageerror = null
		},
		postMessage: message => worker.postMessage(message),
		setErrorHandler: handler => {
			worker.onerror = handler
		},
		setMessageErrorHandler: handler => {
			worker.onmessageerror = handler
		},
		setMessageHandler: handler => {
			worker.onmessage = handler
		},
		terminate: () => worker.terminate(),
	}
}

export async function createSimulationBackend(
	{
		appId = 'zoltar',
		genesisOutcome = 'yes',
		initialBootstrapError,
		savedState,
		savedStateId,
		scenario,
		walletMode = DEFAULT_SIMULATION_WALLET_MODE,
	}: { appId?: 'zoltar' | 'statoblast' | 'trading'; genesisOutcome?: GenesisOutcome; initialBootstrapError?: string; savedState?: SavedSimulationStateEnvelopeV1; savedStateId?: string; scenario?: SimulationScenario; walletMode?: SimulationWalletMode },
	dependencies: CreateSimulationBackendDependencies = {},
): Promise<SimulationBackend> {
	const primaryAccount = QA_ACCOUNTS[0]
	if (primaryAccount === undefined) throw new Error('No simulation QA accounts configured')
	const profile = getGenesisNetworkProfile(createSimulationProfile(predictSimulationTokenAddresses(primaryAccount, genesisOutcome)), genesisOutcome)
	const initialization: SimulationInitialization =
		savedState !== undefined && savedStateId !== undefined
			? {
					envelope: savedState,
					kind: 'saved-state',
					stateId: savedStateId,
				}
			: {
					kind: 'scenario',
					scenario: scenario ?? 'baseline',
				}
	const listeners = createListenerMap()
	const workerPath = resolveWorkerPath(appId)
	const worker = (dependencies.createWorkerConnection ?? createWorkerConnection)(workerPath)
	const pendingRequests = new Map<number, PendingRequest>()
	const progressListeners = new Set<() => void>()
	let nextRequestId = 1
	let currentState: SimulationWorkerState | undefined = undefined
	let bootstrapPromise: Promise<void> | undefined = undefined
	let disposed = false
	let terminalError: Error | undefined = undefined
	let bootstrapWarning = initialBootstrapError
	let rejectReady: ((error: Error) => void) | undefined = undefined

	const rejectPendingRequests = (error: Error) => {
		for (const pendingRequest of pendingRequests.values()) {
			pendingRequest.reject(error)
		}
		pendingRequests.clear()
	}

	const failWorker = (error: Error) => {
		if (disposed) return
		patchState({ bootstrapError: error.message, bootstrapLabel: 'Simulation unavailable', isBootstrapping: false, isBootstrapped: false })
		terminalError = error
		disposed = true
		worker.clearHandlers()
		rejectPendingRequests(error)
		rejectReady?.(error)
		rejectReady = undefined
		worker.terminate()
	}

	const withWorkerTimeout = async <TResult>(work: Promise<TResult>, restartsOnProgress: boolean) => {
		let timeoutId: ReturnType<typeof setTimeout> | undefined
		let rejectTimeout: (error: Error) => void = () => undefined
		const timeout = new Promise<never>((_resolve, reject) => {
			rejectTimeout = reject
		})
		const restartTimeout = () => {
			clearTimeout(timeoutId)
			timeoutId = setTimeout(() => rejectTimeout(new Error('Simulation request timed out. Reload the page to retry.')), WORKER_REQUEST_TIMEOUT_MILLISECONDS)
		}
		restartTimeout()
		if (restartsOnProgress) progressListeners.add(restartTimeout)
		try {
			return await Promise.race([work, timeout])
		} finally {
			clearTimeout(timeoutId)
			progressListeners.delete(restartTimeout)
		}
	}

	const requestFromWorker = <TResult>(message: WorkerRequestMessage, restartsOnProgress = false): Promise<TResult> => {
		let settled = false
		return withWorkerTimeout(
			new Promise<TResult>((resolve, reject) => {
				if (terminalError !== undefined) {
					reject(terminalError)
					return
				}
				if (disposed) {
					reject(new Error('Simulation backend has been disposed'))
					return
				}
				const requestId = nextRequestId
				nextRequestId += 1
				pendingRequests.set(requestId, {
					reject,
					resolve: value => {
						resolve(value as TResult)
					},
				})
				try {
					worker.postMessage({
						...message,
						id: requestId,
					} as SimulationWorkerMessage)
				} catch (error) {
					pendingRequests.delete(requestId)
					reject(error instanceof Error ? error : new Error('Simulation worker request failed'))
				}
			}).finally(() => {
				settled = true
			}),
			restartsOnProgress,
		).catch(error => {
			if (!settled) failWorker(error instanceof Error ? error : new Error(String(error)))
			throw error
		})
	}

	const callWorker = async <TMethod extends SimulationWorkerCallMethod>(method: TMethod, params: SimulationWorkerCallMap[TMethod]['params']): Promise<SimulationWorkerCallMap[TMethod]['result']> =>
		await requestFromWorker<SimulationWorkerCallMap[TMethod]['result']>(
			{
				method,
				params,
				type: 'call',
			},
			PROGRESS_REPORTING_CALLS.has(method),
		)

	const requestRpc = async (parameters: SimulationProviderRequest) =>
		await requestFromWorker<unknown>({
			method: parameters.method,
			params: parameters.params,
			type: 'rpc',
		})

	const applyState = (nextState: SimulationWorkerState) => {
		const previousSelectedAccount = currentState?.selectedAccount
		currentState = nextState
		if (previousSelectedAccount !== undefined && previousSelectedAccount !== nextState.selectedAccount) emitListeners(listeners, 'accountsChanged')
		emitListeners(listeners, 'state')
	}

	const patchState = (patch: Partial<SimulationWorkerState>) => {
		const state = currentState
		if (state === undefined) return
		applyState({
			...state,
			...patch,
		})
	}

	const waitForReady = new Promise<SimulationWorkerState>((resolve, reject) => {
		rejectReady = reject
		worker.setMessageHandler(event => {
			const message = event.data
			if (message.type === 'ready') {
				applyState(message.state)
				rejectReady = undefined
				resolve(message.state)
				return
			}
			if (message.type === 'state') {
				applyState(message.state)
				for (const restartTimeout of progressListeners) restartTimeout()
				return
			}
			if (message.type === 'error' && message.id === undefined) {
				failWorker(new Error(message.message))
				return
			}
			if (message.type === 'result') {
				const requestId = message.id
				const pendingRequest = pendingRequests.get(requestId)
				if (pendingRequest === undefined) return
				pendingRequests.delete(requestId)
				pendingRequest.resolve(message.value)
				return
			}
			if (message.type === 'error' && message.id !== undefined) {
				const requestId = message.id
				const pendingRequest = pendingRequests.get(requestId)
				if (pendingRequest === undefined) return
				pendingRequests.delete(requestId)
				pendingRequest.reject(new Error(message.message))
			}
		})
		worker.setErrorHandler(event => {
			const locationSuffix = event.filename === undefined || event.filename === '' ? '' : ` at ${event.filename}${event.lineno === 0 ? '' : `:${event.lineno}${event.colno === 0 ? '' : `:${event.colno}`}`}`
			failWorker(new Error(`${event.message || 'Simulation worker failed'}${locationSuffix} (worker: ${workerPath.toString()})`))
		})
		worker.setMessageErrorHandler(() => {
			failWorker(new Error(`Simulation worker message deserialization failed (worker: ${workerPath.toString()})`))
		})
		try {
			worker.postMessage({
				genesisOutcome,
				initialization,
				type: 'init',
			} satisfies SimulationWorkerMessage)
		} catch (error) {
			failWorker(error instanceof Error ? error : new Error('Simulation worker initialization failed'))
		}
	})

	await withTimeout(waitForReady, 30_000, 'Simulation startup timed out. Reload the page to retry.').catch(error => {
		failWorker(error instanceof Error ? error : new Error(String(error)))
		throw error
	})

	if (initialBootstrapError !== undefined) {
		const state = currentState
		if (state === undefined) throw new Error('Simulation worker state is unavailable')
		applyState(Object.assign({}, state, { bootstrapError: initialBootstrapError }))
	}

	const requireState = () => {
		if (currentState === undefined) throw new Error('Simulation worker state is unavailable')
		return currentState
	}

	// The wallet-facing provider honours the QA wallet mode (wrong chain or no accounts) so the app's wrong-network and
	// connect states render in simulation. Reads keep using a provider pinned to the simulation chain, mirroring a real
	// deployment whose configured read RPC stays on the app chain regardless of the wallet.
	const provider = createSimulationProvider({
		getChainId: () => profile.chainIdHex,
		getSelectedAccount: () => requireState().selectedAccount,
		initialWalletMode: walletMode,
		onWalletModeChange: (mode, previousMode) => {
			if ((mode === 'wrong-chain') !== (previousMode === 'wrong-chain')) emitListeners(listeners, 'chainChanged')
			if ((mode === 'disconnected') !== (previousMode === 'disconnected')) emitListeners(listeners, 'accountsChanged')
			emitListeners(listeners, 'state')
		},
		requestRpc,
	})
	const readProvider = createSimulationProvider({
		getChainId: () => profile.chainIdHex,
		getSelectedAccount: () => requireState().selectedAccount,
		requestRpc,
	})
	const createBaseWriteClient = (accountAddress: Address) =>
		createWalletClient({
			account: accountAddress,
			chain: profile.chain,
			transport: custom(provider),
		}).extend(publicActions) as WriteClient

	const backend: SimulationBackend = {
		accounts: QA_ACCOUNTS,
		advanceTime: async seconds => {
			await callWorker('advanceTime', { seconds })
		},
		bootstrap: async () => {
			if (bootstrapPromise === undefined) {
				patchState({
					bootstrapError: currentState?.bootstrapError,
					bootstrapLabel: 'Starting simulation bootstrap',
					bootstrapProgress: 0,
					isBootstrapping: true,
				})
				bootstrapPromise = callWorker('bootstrap', undefined)
			}
			return await bootstrapPromise
		},
		get bootstrapError() {
			return requireState().bootstrapError ?? bootstrapWarning
		},
		get bootstrapLabel() {
			return requireState().bootstrapLabel
		},
		get bootstrapProgress() {
			return requireState().bootstrapProgress
		},
		createReadClient: () =>
			createPublicClient({
				chain: profile.chain,
				transport: custom(readProvider),
			}),
		createWriteClient: (accountAddress, callbacks = {}) => {
			const baseClient = createBaseWriteClient(accountAddress)
			return withTransactionCallbacks(
				{
					...baseClient,
					installSimulationProxyDeployer: async ({ address, runtimeCode }) => {
						await callWorker('installSimulationProxyDeployer', { address, runtimeCode })
					},
					patchSimulationGenesisRepToken: async ({ repAddress, zoltarAddress }) => {
						await callWorker('patchSimulationGenesisRepToken', { repAddress, zoltarAddress })
					},
					requiresWalletConfirmation: false,
					waitForTransactionReceipt: async parameters => await callWorker('waitForTransactionReceipt', { hash: parameters.hash }),
				},
				callbacks,
			)
		},
		get blockCountSinceReset() {
			return requireState().blockCountSinceReset
		},
		get currentTimestamp() {
			return requireState().currentTimestamp
		},
		get currentScenario() {
			return requireState().currentScenario
		},
		dispose: async () => {
			if (disposed) return
			disposed = true
			worker.clearHandlers()
			rejectPendingRequests(new Error('Simulation backend has been disposed'))
			worker.terminate()
		},
		exportState: async name => await callWorker('exportState', { name }),
		get isBootstrapped() {
			return requireState().isBootstrapped
		},
		get isBootstrapping() {
			return requireState().isBootstrapping
		},
		getAccounts: async () => (provider.getWalletMode() === 'disconnected' ? [] : await callWorker('getAccounts', undefined)),
		getChainId: async () => (provider.getWalletMode() === 'wrong-chain' ? SIMULATION_WRONG_CHAIN_ID_HEX : profile.chainIdHex),
		getProvider: () => provider,
		getReadBackendStatus: () => ({
			blockNumber: requireState().blockCountSinceReset,
			blockTimestamp: requireState().currentTimestamp,
			rpcSource: 'default',
			rpcUrl: 'browser-simulation',
			transportMode: 'provider',
		}),
		hasWallet: () => true,
		id: 'simulation',
		isActive: true,
		mintRep: async amount => {
			await callWorker('mintRep', { amount })
		},
		advanceBlock: async () => {
			await callWorker('advanceBlock', undefined)
		},
		profile,
		get queryDelayMilliseconds() {
			return requireState().queryDelayMilliseconds
		},
		get repPerEthPrice() {
			return requireState().repPerEthPrice
		},
		get repPerUsdcPrice() {
			return requireState().repPerUsdcPrice
		},
		requestAccounts: async () => {
			if (provider.getWalletMode() === 'disconnected') provider.setWalletMode('connected')
			return await callWorker('getAccounts', undefined)
		},
		reset: async () => {
			bootstrapWarning = undefined
			await callWorker('reset', undefined)
		},
		selectAccount: async address => {
			await callWorker('selectAccount', { address })
		},
		get selectedAccount() {
			return requireState().selectedAccount
		},
		get simulationSource() {
			return requireState().currentSource
		},
		setRepPerEthPrice: async value => await callWorker('setRepPerEthPrice', { value }),
		setRepPerUsdcPrice: async value => await callWorker('setRepPerUsdcPrice', { value }),
		setQueryDelayMilliseconds: async value => await callWorker('setQueryDelayMilliseconds', { value }),
		setTransactionDelayMilliseconds: async value => await callWorker('setTransactionDelayMilliseconds', { value }),
		setWalletMode: async mode => {
			provider.setWalletMode(mode)
		},
		subscribe: handler => {
			listeners.state.add(handler)
			return () => {
				listeners.state.delete(handler)
			}
		},
		subscribeAccountsChanged: handler => {
			listeners.accountsChanged.add(handler)
			return () => {
				listeners.accountsChanged.delete(handler)
			}
		},
		subscribeChainChanged: handler => {
			listeners.chainChanged.add(handler)
			return () => {
				listeners.chainChanged.delete(handler)
			}
		},
		get transactionCountSinceReset() {
			return requireState().transactionCountSinceReset
		},
		switchNetwork: async () => {
			await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: profile.chainIdHex }] })
		},
		get transactionDelayMilliseconds() {
			return requireState().transactionDelayMilliseconds
		},
		get walletMode() {
			return provider.getWalletMode()
		},
		waitUntilReady: async () => {
			await callWorker('waitUntilReady', undefined)
		},
	}

	return backend
}

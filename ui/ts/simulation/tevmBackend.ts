import { createPublicClient, createWalletClient, custom, publicActions, type Address } from 'viem'
import type { InjectedEthereum } from '../injectedEthereum.js'
import type { ChainBackend, ReadClient, WriteClient } from '../lib/chainBackend.js'
import { normalizeAccount } from '../lib/chainBackend.js'
import { createSimulationProfile } from '../lib/networkProfile.js'
import type { SimulationController } from './controller.js'
import { predictSimulationTokenAddresses } from './bootstrap.js'
import type { SimulationScenario } from './scenarios.js'
import type { SimulationWorkerCallMap, SimulationWorkerCallMessage, SimulationWorkerCallMethod, SimulationWorkerEvent, SimulationWorkerMessage, SimulationWorkerRpcMessage, SimulationWorkerState } from './tevmWorkerProtocol.js'

const QA_ACCOUNTS = [normalizeAccount('0x00000000000000000000000000000000000000a1'), normalizeAccount('0x00000000000000000000000000000000000000b2'), normalizeAccount('0x00000000000000000000000000000000000000c3')].filter((account): account is Address => account !== undefined)

type RequestArguments = {
	method: string
	params?: unknown
}

type PendingRequest = {
	reject: (error: Error) => void
	resolve: (value: unknown) => void
}

type WorkerRequestMessage = Omit<SimulationWorkerCallMessage, 'id'> | Omit<SimulationWorkerRpcMessage, 'id'>

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

function resolveWorkerPath() {
	const currentUrl = new URL(import.meta.url)
	if (currentUrl.protocol === 'file:' && currentUrl.pathname.includes('/ui/ts/')) {
		return new URL('./tevmWorker.ts', import.meta.url)
	}
	return new URL('./tevmWorker.worker.js', import.meta.url)
}

function createSimulationProvider(requestRpc: (parameters: RequestArguments) => Promise<unknown>): InjectedEthereum {
	const request = (async parameters => await requestRpc(parameters as RequestArguments)) as InjectedEthereum['request']
	return {
		on: () => undefined,
		removeListener: () => undefined,
		request,
	}
}

export async function createSimulationBackend({ scenario }: { scenario: SimulationScenario }): Promise<SimulationBackend> {
	const primaryAccount = QA_ACCOUNTS[0]
	if (primaryAccount === undefined) {
		throw new Error('No simulation QA accounts configured')
	}
	const profile = createSimulationProfile(predictSimulationTokenAddresses(primaryAccount))
	const listeners = createListenerMap()
	const workerPath = resolveWorkerPath()
	const worker = new Worker(workerPath, { type: 'module' })
	const pendingRequests = new Map<number, PendingRequest>()
	let nextRequestId = 1
	let currentState: SimulationWorkerState | undefined = undefined
	let bootstrapPromise: Promise<void> | undefined = undefined
	let disposed = false

	const rejectPendingRequests = (error: Error) => {
		for (const pendingRequest of pendingRequests.values()) {
			pendingRequest.reject(error)
		}
		pendingRequests.clear()
	}

	const requestFromWorker = <TResult>(message: WorkerRequestMessage): Promise<TResult> =>
		new Promise((resolve, reject) => {
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
			worker.postMessage({
				...message,
				id: requestId,
			} as SimulationWorkerMessage)
		})

	const callWorker = async <TMethod extends SimulationWorkerCallMethod>(method: TMethod, params: SimulationWorkerCallMap[TMethod]['params']): Promise<SimulationWorkerCallMap[TMethod]['result']> =>
		await requestFromWorker<SimulationWorkerCallMap[TMethod]['result']>({
			method,
			params,
			type: 'call',
		})

	const requestRpc = async (parameters: RequestArguments) =>
		await requestFromWorker<unknown>({
			method: parameters.method,
			params: parameters.params,
			type: 'rpc',
		})

	const applyState = (nextState: SimulationWorkerState) => {
		const previousSelectedAccount = currentState?.selectedAccount
		currentState = nextState
		if (previousSelectedAccount !== undefined && previousSelectedAccount !== nextState.selectedAccount) {
			emitListeners(listeners, 'accountsChanged')
		}
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
		worker.onmessage = event => {
			const message = event.data as SimulationWorkerEvent
			if (message.type === 'ready') {
				applyState(message.state)
				resolve(message.state)
				return
			}
			if (message.type === 'state') {
				applyState(message.state)
				return
			}
			if (message.type === 'error' && message.id === undefined) {
				reject(new Error(message.message))
				return
			}
			if (message.type === 'result') {
				const requestId = message.id
				const pendingRequest = pendingRequests.get(requestId)
				if (pendingRequest === undefined) {
					return
				}
				pendingRequests.delete(requestId)
				pendingRequest.resolve(message.value)
				return
			}
			if (message.type === 'error' && message.id !== undefined) {
				const requestId = message.id
				const pendingRequest = pendingRequests.get(requestId)
				if (pendingRequest === undefined) {
					return
				}
				pendingRequests.delete(requestId)
				pendingRequest.reject(new Error(message.message))
			}
		}
		worker.onerror = event => {
			const locationSuffix = event.filename === undefined || event.filename === '' ? '' : ` at ${event.filename}${event.lineno === 0 ? '' : `:${event.lineno}${event.colno === 0 ? '' : `:${event.colno}`}`}`
			reject(new Error(`${event.message || 'Simulation worker failed'}${locationSuffix} (worker: ${workerPath.toString()})`))
		}
		worker.onmessageerror = () => {
			reject(new Error(`Simulation worker message deserialization failed (worker: ${workerPath.toString()})`))
		}
		worker.postMessage({
			scenario,
			type: 'init',
		} satisfies SimulationWorkerMessage)
	})

	await waitForReady

	const requireState = () => {
		if (currentState === undefined) {
			throw new Error('Simulation worker state is unavailable')
		}
		return currentState
	}

	const provider = createSimulationProvider(requestRpc)
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
					bootstrapError: undefined,
					bootstrapLabel: 'Starting simulation bootstrap',
					bootstrapProgress: 0,
					isBootstrapping: true,
				})
				bootstrapPromise = callWorker('bootstrap', undefined)
			}
			return await bootstrapPromise
		},
		get bootstrapError() {
			return requireState().bootstrapError
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
				transport: custom(provider),
			}) as ReadClient,
		createWriteClient: (accountAddress, callbacks = {}) => {
			const baseClient = createBaseWriteClient(accountAddress)

			const sendRawTransaction: typeof baseClient.sendRawTransaction = async parameters => {
				const hash = await baseClient.sendRawTransaction(parameters)
				callbacks.onTransactionSubmitted?.(hash)
				return hash
			}

			const sendTransaction: typeof baseClient.sendTransaction = async parameters => {
				const hash = await baseClient.sendTransaction(parameters)
				callbacks.onTransactionSubmitted?.(hash)
				return hash
			}

			const writeContract: typeof baseClient.writeContract = async parameters => {
				const hash = await baseClient.writeContract(parameters)
				callbacks.onTransactionSubmitted?.(hash)
				return hash
			}

			const waitForTransactionReceipt: typeof baseClient.waitForTransactionReceipt = async parameters => await callWorker('waitForTransactionReceipt', { hash: parameters.hash })

			return {
				...baseClient,
				installSimulationProxyDeployer: async ({ address, runtimeCode }) => {
					await callWorker('installSimulationProxyDeployer', { address, runtimeCode })
				},
				patchSimulationGenesisRepToken: async ({ repAddress, zoltarAddress }) => {
					await callWorker('patchSimulationGenesisRepToken', { repAddress, zoltarAddress })
				},
				sendRawTransaction,
				sendTransaction,
				waitForTransactionReceipt,
				writeContract,
			}
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
			worker.onmessage = null
			worker.onerror = null
			rejectPendingRequests(new Error('Simulation backend has been disposed'))
			worker.terminate()
		},
		get isBootstrapped() {
			return requireState().isBootstrapped
		},
		get isBootstrapping() {
			return requireState().isBootstrapping
		},
		getAccounts: async () => await callWorker('getAccounts', undefined),
		getChainId: async () => profile.chainIdHex,
		getProvider: () => provider,
		hasWallet: () => true,
		id: 'simulation',
		isActive: true,
		mineBlock: async () => {
			await callWorker('mineBlock', undefined)
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
		requestAccounts: async () => await callWorker('getAccounts', undefined),
		reset: async () => {
			await callWorker('reset', undefined)
		},
		selectAccount: async address => {
			await callWorker('selectAccount', { address })
		},
		get selectedAccount() {
			return requireState().selectedAccount
		},
		setRepPerEthPrice: value => {
			patchState({
				repPerEthPrice: value,
			})
			void callWorker('setRepPerEthPrice', { value })
		},
		setRepPerUsdcPrice: value => {
			patchState({
				repPerUsdcPrice: value,
			})
			void callWorker('setRepPerUsdcPrice', { value })
		},
		setQueryDelayMilliseconds: value => {
			patchState({
				queryDelayMilliseconds: value,
			})
			void callWorker('setQueryDelayMilliseconds', { value })
		},
		setTransactionDelayMilliseconds: value => {
			patchState({
				transactionDelayMilliseconds: value,
			})
			void callWorker('setTransactionDelayMilliseconds', { value })
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
		get transactionDelayMilliseconds() {
			return requireState().transactionDelayMilliseconds
		},
		waitUntilReady: async () => {
			await callWorker('waitUntilReady', undefined)
		},
	}

	return backend
}

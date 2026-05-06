import { createMemoryClient, type DumpStateResult } from 'tevm'
import { createCommon } from 'tevm/common'
import { createPublicClient, createWalletClient, custom, encodeFunctionData, parseTransaction, publicActions, recoverTransactionAddress, type Address, type Hash, type Hex } from 'viem'
import { getAddress } from 'viem'
import type { InjectedEthereum } from '../injectedEthereum.js'
import type { ChainBackend, CreateWriteClientCallbacks, ReadClient, WriteClient } from '../lib/chainBackend.js'
import { createSimulationProfile } from '../lib/networkProfile.js'
import type { SimulationController } from './controller.js'
import { bootstrapSimulationChain, predictSimulationTokenAddresses, updateZoltarGenesisRepToken } from './bootstrap.js'
import type { SimulationScenario } from './scenarios.js'

const QA_ACCOUNTS = [getAddress('0x00000000000000000000000000000000000000a1'), getAddress('0x00000000000000000000000000000000000000b2'), getAddress('0x00000000000000000000000000000000000000c3')] as const satisfies readonly Address[]

type MemoryClientLike = ReturnType<typeof createMemoryClient>

type EventName = 'accountsChanged' | 'chainChanged'
type RequestArguments = {
	method: string
	params?: unknown
}
type TevmTransactionRequest = Parameters<MemoryClientLike['tevmCall']>[0]
type TevmBlock = Awaited<ReturnType<MemoryClientLike['getBlock']>>

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

function emitListeners(listeners: ReturnType<typeof createListenerMap>, eventName: EventName | 'state') {
	for (const listener of listeners[eventName]) {
		listener()
	}
}

function createSimulationProvider({ getChainId, getQueryDelayMilliseconds, getSelectedAccount, memoryClient }: { getChainId: () => string; getQueryDelayMilliseconds: () => number; getSelectedAccount: () => Address; memoryClient: MemoryClientLike }): InjectedEthereum {
	const passthroughRequest = memoryClient.request as (parameters: RequestArguments) => Promise<unknown>
	const request = (async (parameters: RequestArguments) => {
		await delayMilliseconds(getQueryDelayMilliseconds())
		if (parameters.method === 'eth_accounts' || parameters.method === 'eth_requestAccounts') {
			return [getSelectedAccount()]
		}
		if (parameters.method === 'eth_chainId') {
			return getChainId()
		}
		return await passthroughRequest(parameters)
	}) as InjectedEthereum['request']

	const provider: InjectedEthereum = {
		on: () => undefined,
		removeListener: () => undefined,
		request,
	}

	return provider
}

function isMissingTransactionReceiptError(error: unknown) {
	if (!(error instanceof Error)) return false
	return error.message.includes('Transaction receipt with hash') && error.message.includes('could not be found')
}

function normalizeRequestedAccount(value: unknown, fallbackAccount: Address) {
	if (typeof value === 'string') return getAddress(value)
	if (typeof value === 'object' && value !== null && 'address' in value) {
		const address = value.address
		if (typeof address === 'string') return getAddress(address)
	}
	return fallbackAccount
}

function requireTransactionHash(hash: Hex | undefined, label: string): Hash {
	if (hash === undefined) {
		throw new Error(`Simulation ${label} did not return a transaction hash`)
	}
	return hash
}

function normalizeNonce(value: bigint | number | undefined) {
	if (value === undefined) return undefined
	return typeof value === 'bigint' ? value : BigInt(value)
}

function createTevmTransactionRequest({
	data,
	from,
	gas,
	gasPrice,
	maxFeePerGas,
	maxPriorityFeePerGas,
	nonce,
	to,
	value,
}: {
	data: Hex
	from: Address
	gas?: bigint | undefined
	gasPrice?: bigint | undefined
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
	nonce?: bigint | undefined
	to?: Address | null | undefined
	value?: bigint | undefined
}) {
	return {
		addToBlockchain: true,
		data,
		from,
		...(gas === undefined ? {} : { gas }),
		...(gasPrice === undefined ? {} : { gasPrice }),
		...(maxFeePerGas === undefined ? {} : { maxFeePerGas }),
		...(maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas }),
		...(nonce === undefined ? {} : { nonce }),
		...(to === undefined || to === null ? {} : { to }),
		...(value === undefined ? {} : { value }),
	} as TevmTransactionRequest
}

function clampTransactionDelayMilliseconds(value: number) {
	if (!Number.isFinite(value) || value <= 0) return 0
	return Math.min(Math.trunc(value), 30_000)
}

async function delayMilliseconds(milliseconds: number) {
	if (milliseconds <= 0) return
	await new Promise(resolve => {
		setTimeout(resolve, milliseconds)
	})
}

function getRequiredBlockNumber(block: TevmBlock) {
	if (block.number === undefined || block.number === null) {
		throw new Error('Simulation block number was unavailable')
	}
	return block.number
}

async function getSimulationChainState(memoryClient: MemoryClientLike) {
	const block = await memoryClient.getBlock()
	return {
		blockNumber: getRequiredBlockNumber(block),
		currentTimestamp: block.timestamp,
	}
}

async function mineSimulationBlockAtTimestamp(memoryClient: MemoryClientLike, timestamp: bigint) {
	const vm = await memoryClient.transport.tevm.getVm()
	const parentBlock = await vm.blockchain.getCanonicalHeadBlock()
	const builder = await vm.buildBlock({
		headerData: {
			timestamp,
		},
		parentBlock,
	})
	await builder.build()
}

function createWriteClient({
	accountAddress,
	callbacks,
	ensureImpersonated,
	getTransactionDelayMilliseconds,
	memoryClient,
	onSimulationReceiptResolved,
	onSimulationTransactionSubmitted,
	profile,
	provider,
}: {
	accountAddress: Address
	callbacks: CreateWriteClientCallbacks
	ensureImpersonated: (address: Address) => Promise<void>
	getTransactionDelayMilliseconds: () => number
	memoryClient: MemoryClientLike
	onSimulationReceiptResolved: () => Promise<void>
	onSimulationTransactionSubmitted: () => Promise<void>
	profile: ChainBackend['profile']
	provider: InjectedEthereum
}): WriteClient {
	const baseClient = createWalletClient({
		account: accountAddress,
		chain: profile.chain,
		transport: custom(provider),
	}).extend(publicActions) as WriteClient

	const sendRawTransaction: typeof baseClient.sendRawTransaction = async parameters => {
		const parsedTransaction = parseTransaction(parameters.serializedTransaction)
		const serializedTransaction = parameters.serializedTransaction as Parameters<typeof recoverTransactionAddress>[0]['serializedTransaction']
		const senderAddress = await recoverTransactionAddress({
			serializedTransaction,
		})
		const normalizedNonce = normalizeNonce(parsedTransaction.nonce)
		await ensureImpersonated(senderAddress)
		const result = await memoryClient.tevmCall(
			createTevmTransactionRequest({
				data: parsedTransaction.data ?? '0x',
				from: senderAddress,
				gas: parsedTransaction.gas,
				gasPrice: parsedTransaction.gasPrice,
				maxFeePerGas: parsedTransaction.maxFeePerGas,
				maxPriorityFeePerGas: parsedTransaction.maxPriorityFeePerGas,
				nonce: normalizedNonce,
				to: parsedTransaction.to,
				value: parsedTransaction.value,
			}),
		)
		const hash = requireTransactionHash(result.txHash, 'raw transaction')
		callbacks.onTransactionSubmitted?.(hash)
		await onSimulationTransactionSubmitted()
		return hash
	}

	const sendTransaction: typeof baseClient.sendTransaction = async parameters => {
		const senderAddress = normalizeRequestedAccount(parameters.account, accountAddress)
		const normalizedNonce = normalizeNonce(parameters.nonce)
		await ensureImpersonated(senderAddress)
		const result = await memoryClient.tevmCall(
			createTevmTransactionRequest({
				data: parameters.data ?? '0x',
				from: senderAddress,
				gas: parameters.gas,
				gasPrice: parameters.gasPrice,
				maxFeePerGas: parameters.maxFeePerGas,
				maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
				nonce: normalizedNonce,
				to: parameters.to,
				value: parameters.value,
			}),
		)
		const hash = requireTransactionHash(result.txHash, 'transaction')
		callbacks.onTransactionSubmitted?.(hash)
		await onSimulationTransactionSubmitted()
		return hash
	}

	const writeContract: typeof baseClient.writeContract = async parameters => {
		const senderAddress = normalizeRequestedAccount(parameters.account, accountAddress)
		const data = encodeFunctionData(parameters as Parameters<typeof encodeFunctionData>[0])
		return await sendTransaction({
			account: senderAddress,
			data,
			gas: parameters.gas,
			maxFeePerGas: parameters.maxFeePerGas,
			maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
			to: parameters.address,
			value: parameters.value,
		})
	}

	const waitForTransactionReceipt: typeof baseClient.waitForTransactionReceipt = async parameters => {
		await delayMilliseconds(getTransactionDelayMilliseconds())
		for (let attempt = 0; attempt < 3; attempt += 1) {
			try {
				const receipt = await baseClient.getTransactionReceipt({
					hash: parameters.hash,
				})
				await onSimulationReceiptResolved()
				return receipt
			} catch (error) {
				if (!isMissingTransactionReceiptError(error)) {
					throw error
				}
				await memoryClient.tevmMine()
			}
		}
		const receipt = await baseClient.getTransactionReceipt({
			hash: parameters.hash,
		})
		await onSimulationReceiptResolved()
		return receipt
	}

	return {
		...baseClient,
		installSimulationProxyDeployer: async ({ address, runtimeCode }) => {
			await memoryClient.setCode({
				address,
				bytecode: runtimeCode,
			})
		},
		patchSimulationGenesisRepToken: async ({ zoltarAddress }) => {
			await updateZoltarGenesisRepToken(memoryClient, zoltarAddress, profile.genesisRepTokenAddress)
		},
		sendRawTransaction,
		sendTransaction,
		waitForTransactionReceipt,
		writeContract,
	}
}

export async function createSimulationBackend({ scenario }: { scenario: SimulationScenario }): Promise<SimulationBackend> {
	const primaryAccount = QA_ACCOUNTS[0]
	if (primaryAccount === undefined) {
		throw new Error('No simulation QA accounts configured')
	}
	const predictedTokenAddresses = predictSimulationTokenAddresses(primaryAccount)
	const profile = createSimulationProfile(predictedTokenAddresses)
	const listeners = createListenerMap()
	const memoryClient = createMemoryClient({
		common: createCommon({
			...profile.chain,
		}),
		miningConfig: {
			type: 'auto',
		},
	})
	const impersonatedAccounts = new Set<string>()
	let baselineState: DumpStateResult | undefined = undefined
	let baselineBlockNumber = 0n
	let blockCountSinceReset = 0n
	let bootstrapError: string | undefined = undefined
	let bootstrapPromise: Promise<void> | undefined = undefined
	let bootstrapped = false
	let bootstrapping = false
	let currentTimestamp = 0n
	let queryDelayMilliseconds = 0
	let selectedAccount = primaryAccount
	let transactionCountSinceReset = 0n
	let transactionDelayMilliseconds = 1_000
	const provider = createSimulationProvider({
		getChainId: () => profile.chainIdHex,
		getQueryDelayMilliseconds: () => queryDelayMilliseconds,
		getSelectedAccount: () => selectedAccount,
		memoryClient,
	})
	const bootstrapProvider = createSimulationProvider({
		getChainId: () => profile.chainIdHex,
		getQueryDelayMilliseconds: () => 0,
		getSelectedAccount: () => selectedAccount,
		memoryClient,
	})

	const ensureImpersonated = async (address: Address) => {
		const normalizedAddress = address.toLowerCase()
		if (impersonatedAccounts.has(normalizedAddress)) return
		await memoryClient.impersonateAccount({ address })
		impersonatedAccounts.add(normalizedAddress)
	}

	for (const account of QA_ACCOUNTS) {
		await ensureImpersonated(account)
	}

	const refreshSimulationState = async () => {
		const chainState = await getSimulationChainState(memoryClient)
		currentTimestamp = chainState.currentTimestamp
		blockCountSinceReset = chainState.blockNumber >= baselineBlockNumber ? chainState.blockNumber - baselineBlockNumber : 0n
	}

	const createBootstrapReadClient = () =>
		createPublicClient({
			chain: profile.chain,
			transport: custom(bootstrapProvider),
		}) as ReadClient

	const createBootstrapWriteClient = (accountAddress: Address) =>
		createWriteClient({
			accountAddress,
			callbacks: {},
			ensureImpersonated,
			getTransactionDelayMilliseconds: () => 0,
			memoryClient,
			onSimulationReceiptResolved: async () => undefined,
			onSimulationTransactionSubmitted: async () => undefined,
			profile,
			provider: bootstrapProvider,
		})

	const backend: SimulationBackend = {
		accounts: QA_ACCOUNTS,
		advanceTime: async seconds => {
			const chainState = await getSimulationChainState(memoryClient)
			await mineSimulationBlockAtTimestamp(memoryClient, chainState.currentTimestamp + seconds)
			await refreshSimulationState()
			emitListeners(listeners, 'state')
		},
		bootstrap: async () => {
			if (bootstrapPromise !== undefined) return await bootstrapPromise
			bootstrapping = true
			bootstrapError = undefined
			emitListeners(listeners, 'state')
			bootstrapPromise = (async () => {
				try {
					await bootstrapSimulationChain({
						accounts: QA_ACCOUNTS,
						createReadClient: createBootstrapReadClient,
						createWriteClient: createBootstrapWriteClient,
						memoryClient,
						onBaselineState: state => {
							baselineState = state
						},
						primaryAccount,
						profile,
						scenario,
					})
					await refreshSimulationState()
					const chainState = await getSimulationChainState(memoryClient)
					baselineBlockNumber = chainState.blockNumber
					currentTimestamp = chainState.currentTimestamp
					blockCountSinceReset = 0n
					transactionCountSinceReset = 0n
					bootstrapped = true
				} catch (error) {
					bootstrapError = error instanceof Error ? error.message : 'Failed to bootstrap simulation scenario'
					throw error
				} finally {
					bootstrapping = false
					emitListeners(listeners, 'state')
				}
			})()
			return await bootstrapPromise
		},
		get bootstrapError() {
			return bootstrapError
		},
		createReadClient: () =>
			createPublicClient({
				chain: profile.chain,
				transport: custom(provider),
			}) as ReadClient,
		createWriteClient: (accountAddress, callbacks = {}) =>
			createWriteClient({
				accountAddress,
				callbacks,
				ensureImpersonated,
				getTransactionDelayMilliseconds: () => transactionDelayMilliseconds,
				memoryClient,
				onSimulationReceiptResolved: async () => {
					await refreshSimulationState()
					emitListeners(listeners, 'state')
				},
				onSimulationTransactionSubmitted: async () => {
					transactionCountSinceReset += 1n
					await refreshSimulationState()
					emitListeners(listeners, 'state')
				},
				profile,
				provider,
			}),
		get blockCountSinceReset() {
			return blockCountSinceReset
		},
		get currentTimestamp() {
			return currentTimestamp
		},
		get currentScenario() {
			return scenario
		},
		get isBootstrapped() {
			return bootstrapped
		},
		get isBootstrapping() {
			return bootstrapping
		},
		getAccounts: async () => [selectedAccount],
		getChainId: async () => profile.chainIdHex,
		getProvider: () => provider,
		hasWallet: () => true,
		id: 'simulation',
		isActive: true,
		mineBlock: async () => {
			await memoryClient.tevmMine()
			await refreshSimulationState()
			emitListeners(listeners, 'state')
		},
		profile,
		get queryDelayMilliseconds() {
			return queryDelayMilliseconds
		},
		requestAccounts: async () => [selectedAccount],
		reset: async () => {
			if (baselineState === undefined || baselineState === null) {
				throw new Error('Simulation baseline state has not been captured yet')
			}
			await memoryClient.tevmLoadState({ state: baselineState.state })
			impersonatedAccounts.clear()
			for (const account of QA_ACCOUNTS) {
				await ensureImpersonated(account)
			}
			selectedAccount = primaryAccount
			transactionCountSinceReset = 0n
			await refreshSimulationState()
			emitListeners(listeners, 'accountsChanged')
			emitListeners(listeners, 'state')
		},
		setTransactionDelayMilliseconds: value => {
			transactionDelayMilliseconds = clampTransactionDelayMilliseconds(value)
			emitListeners(listeners, 'state')
		},
		setQueryDelayMilliseconds: value => {
			queryDelayMilliseconds = clampTransactionDelayMilliseconds(value)
			emitListeners(listeners, 'state')
		},
		selectAccount: async address => {
			if (!QA_ACCOUNTS.includes(address)) {
				throw new Error(`Unknown simulation account: ${address}`)
			}
			selectedAccount = address
			await ensureImpersonated(address)
			emitListeners(listeners, 'accountsChanged')
			emitListeners(listeners, 'state')
		},
		selectedAccount,
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
			return transactionCountSinceReset
		},
		get transactionDelayMilliseconds() {
			return transactionDelayMilliseconds
		},
		waitUntilReady: async () => {
			await backend.bootstrap()
		},
	}

	Object.defineProperty(backend, 'selectedAccount', {
		get: () => selectedAccount,
	})

	return backend
}

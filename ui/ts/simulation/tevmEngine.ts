import { createMemoryClient } from 'tevm'
import { createCommon } from 'tevm/common'
import { createPublicClient, createWalletClient, custom, encodeFunctionData, parseTransaction, publicActions, recoverTransactionAddress, type Address, type Hash, type Hex } from 'viem'
import { getAddress } from 'viem'
import { getZoltarAddress } from '../contracts/deploymentHelpers.js'
import type { InjectedEthereum } from '../injectedEthereum.js'
import type { ChainBackend, CreateWriteClientCallbacks, ReadClient, WriteClient } from '../lib/chainBackend.js'
import { createSimulationProfile } from '../lib/networkProfile.js'
import { bootstrapSimulationChain, mintSimulationGenesisRep, predictSimulationTokenAddresses, updateZoltarGenesisRepToken } from './bootstrap.js'
import { advanceSimulationTime, getNextSimulationTimestamp, getSimulationChainTimestamp, mineNextSimulationBlock, minePendingSimulationTransactionAtTimestamp } from './clock.js'
import type { SimulationScenario } from './scenarios.js'
import type { SimulationWorkerState } from './tevmWorkerProtocol.js'
const QA_ACCOUNTS = [getAddress('0x00000000000000000000000000000000000000a1'), getAddress('0x00000000000000000000000000000000000000b2'), getAddress('0x00000000000000000000000000000000000000c3')] as const satisfies readonly Address[]
type MemoryClientLike = ReturnType<typeof createMemoryClient>
type RequestArguments = {
	method: string
	params?: unknown
}
type TevmTransactionRequest = Parameters<MemoryClientLike['tevmCall']>[0]
type TevmBlock = Awaited<ReturnType<MemoryClientLike['getBlock']>>
type SerializedTransaction = Parameters<typeof recoverTransactionAddress>[0]['serializedTransaction']
type SimulationSendTransactionRequest = {
	account?: unknown
	data?: Hex | undefined
	gas?: bigint | undefined
	gasPrice?: bigint | undefined
	maxFeePerGas?: bigint | undefined
	maxPriorityFeePerGas?: bigint | undefined
	nonce?: bigint | number | undefined
	to?: Address | null | undefined
	value?: bigint | undefined
}
const DEFAULT_SIMULATION_REP_PER_ETH_PRICE = 3n * 10n ** 18n
const DEFAULT_SIMULATION_REP_PER_USDC_PRICE = 10n ** 6n
function normalizeRpcBigInt(value: unknown) {
	if (typeof value === 'bigint') return value
	if (typeof value === 'number') return BigInt(value)
	if (typeof value === 'string') return BigInt(value)
	return undefined
}
function normalizeRpcAddress(value: unknown) {
	if (typeof value !== 'string') return undefined
	return getAddress(value)
}
function normalizeRpcTransactionRequest(value: Record<string, unknown>): SimulationSendTransactionRequest {
	return {
		account: (() => {
			if ('account' in value) return value['account']
			if ('from' in value) return value['from']

			return undefined
		})(),
		data: typeof value['data'] === 'string' ? (value['data'] as Hex) : undefined,
		gas: normalizeRpcBigInt(value['gas']),
		gasPrice: normalizeRpcBigInt(value['gasPrice']),
		maxFeePerGas: normalizeRpcBigInt(value['maxFeePerGas']),
		maxPriorityFeePerGas: normalizeRpcBigInt(value['maxPriorityFeePerGas']),
		nonce: normalizeRpcBigInt(value['nonce']),
		to: value['to'] === null ? null : normalizeRpcAddress(value['to']),
		value: normalizeRpcBigInt(value['value']),
	}
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
	if (hash === undefined) throw new Error(`Simulation ${label} did not return a transaction hash`)
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
		addToMempool: true,
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
function clampDelayMilliseconds(value: number) {
	if (!Number.isFinite(value) || value <= 0) return 0
	return Math.min(Math.trunc(value), 30000)
}
function createSimulationMemoryClient(profile: ReturnType<typeof createSimulationProfile>) {
	return createMemoryClient({
		common: createCommon({
			...profile.chain,
		}),
		miningConfig: {
			type: 'manual',
		},
	})
}
async function delayMilliseconds(milliseconds: number) {
	if (milliseconds <= 0) return
	await new Promise(resolve => {
		setTimeout(resolve, milliseconds)
	})
}
function getRequiredBlockNumber(block: TevmBlock) {
	if (block.number === undefined || block.number === null) throw new Error('Simulation block number was unavailable')
	return block.number
}
async function getSimulationChainState(memoryClient: MemoryClientLike) {
	const block = await memoryClient.getBlock()
	return {
		blockNumber: getRequiredBlockNumber(block),
		currentTimestamp: block.timestamp,
	}
}
function createSimulationProvider({ getChainId, getQueryDelayMilliseconds, getSelectedAccount, requestRpc }: { getChainId: () => string; getQueryDelayMilliseconds: () => number; getSelectedAccount: () => Address; requestRpc: (parameters: RequestArguments) => Promise<unknown> }): InjectedEthereum {
	const request = (async (parameters: RequestArguments) => {
		if (parameters.method === 'eth_accounts' || parameters.method === 'eth_requestAccounts') return [getSelectedAccount()]
		if (parameters.method === 'eth_chainId') return getChainId()
		await delayMilliseconds(getQueryDelayMilliseconds())
		return await requestRpc(parameters)
	}) as InjectedEthereum['request']
	return {
		on: () => undefined,
		removeListener: () => undefined,
		request,
	}
}
function withTransactionCallbacks(baseClient: WriteClient, callbacks: CreateWriteClientCallbacks): WriteClient {
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
	return {
		...baseClient,
		sendRawTransaction,
		sendTransaction,
		writeContract,
	}
}
type SimulationEngine = {
	accounts: readonly Address[]
	advanceTime(seconds: bigint): Promise<void>
	bootstrap(): Promise<void>
	getAccounts(): Promise<readonly Address[]>
	getChainId(): Promise<string>
	getProfile(): ChainBackend['profile']
	getState(): SimulationWorkerState
	installSimulationProxyDeployer(parameters: { address: Address; runtimeCode: Hex }): Promise<void>
	mintRep(amount: bigint): Promise<void>
	mineBlock(): Promise<void>
	patchSimulationGenesisRepToken(parameters: { repAddress: Address; zoltarAddress: Address }): Promise<void>
	request(parameters: RequestArguments): Promise<unknown>
	reset(): Promise<void>
	selectAccount(address: Address): Promise<void>
	setRepPerEthPrice(value: bigint): void
	setRepPerUsdcPrice(value: bigint): void
	setQueryDelayMilliseconds(value: number): void
	setTransactionDelayMilliseconds(value: number): void
	subscribe(handler: () => void): () => void
	waitForTransactionReceipt(hash: Hash): Promise<Awaited<ReturnType<ReadClient['getTransactionReceipt']>>>
	waitUntilReady(): Promise<void>
}
export async function createSimulationEngine({ scenario }: { scenario: SimulationScenario }): Promise<SimulationEngine> {
	const primaryAccount = QA_ACCOUNTS[0]
	if (primaryAccount === undefined) throw new Error('No simulation QA accounts configured')
	const predictedTokenAddresses = predictSimulationTokenAddresses(primaryAccount)
	const profile = createSimulationProfile(predictedTokenAddresses)
	let memoryClient = createSimulationMemoryClient(profile)
	const stateListeners = new Set<() => void>()
	const impersonatedAccounts = new Set<string>()
	let baselineTransactionCount = 0n
	let bootstrapError: string | undefined = undefined
	let bootstrapLabel: string | undefined = undefined
	let bootstrapProgress: number | undefined = undefined
	let blockCountSinceReset = 0n
	let bootstrapPromise: Promise<void> | undefined = undefined
	let bootstrapped = false
	let bootstrapping = false
	let currentTimestamp = 0n
	let queryDelayMilliseconds = 0
	let repPerEthPrice = DEFAULT_SIMULATION_REP_PER_ETH_PRICE
	let repPerUsdcPrice = DEFAULT_SIMULATION_REP_PER_USDC_PRICE
	let selectedAccount = primaryAccount
	let transactionCountSinceReset = 0n
	let transactionDelayMilliseconds = 1000
	const emitState = () => {
		for (const listener of stateListeners) {
			listener()
		}
	}
	const ensureImpersonated = async (address: Address) => {
		const normalizedAddress = address.toLowerCase()
		if (impersonatedAccounts.has(normalizedAddress)) return
		await memoryClient.impersonateAccount({ address })
		impersonatedAccounts.add(normalizedAddress)
	}
	const initializeSimulationAccounts = async () => {
		for (const account of QA_ACCOUNTS) {
			await ensureImpersonated(account)
		}
	}
	const mineSubmittedTransaction = async (hash: Hash) => {
		const chainTimestamp = await getSimulationChainTimestamp(memoryClient)
		await minePendingSimulationTransactionAtTimestamp(memoryClient, hash, getNextSimulationTimestamp(chainTimestamp))
	}
	const refreshSimulationState = async () => {
		const chainState = await getSimulationChainState(memoryClient)
		currentTimestamp = chainState.currentTimestamp
		blockCountSinceReset = chainState.blockNumber
	}
	const sendRawTransactionInternal = async (serializedTransaction: SerializedTransaction) => {
		const parsedTransaction = parseTransaction(serializedTransaction)
		const recoveredAddress = await recoverTransactionAddress({
			serializedTransaction,
		})
		await ensureImpersonated(recoveredAddress)
		const result = await memoryClient.tevmCall(
			createTevmTransactionRequest({
				data: parsedTransaction.data ?? '0x',
				from: recoveredAddress,
				gas: parsedTransaction.gas,
				gasPrice: parsedTransaction.gasPrice,
				maxFeePerGas: parsedTransaction.maxFeePerGas,
				maxPriorityFeePerGas: parsedTransaction.maxPriorityFeePerGas,
				nonce: normalizeNonce(parsedTransaction.nonce),
				to: parsedTransaction.to,
				value: parsedTransaction.value,
			}),
		)
		const hash = requireTransactionHash(result.txHash, 'raw transaction')
		await mineSubmittedTransaction(hash)
		transactionCountSinceReset += 1n
		await refreshSimulationState()
		emitState()
		return hash
	}
	const sendTransactionInternal = async ({
		account,
		data,
		gas,
		gasPrice,
		maxFeePerGas,
		maxPriorityFeePerGas,
		nonce,
		to,
		value,
	}: {
		account?: unknown
		data?: Hex | undefined
		gas?: bigint | undefined
		gasPrice?: bigint | undefined
		maxFeePerGas?: bigint | undefined
		maxPriorityFeePerGas?: bigint | undefined
		nonce?: bigint | number | undefined
		to?: Address | null | undefined
		value?: bigint | undefined
	}) => {
		const senderAddress = normalizeRequestedAccount(account, selectedAccount)
		await ensureImpersonated(senderAddress)
		const result = await memoryClient.tevmCall(
			createTevmTransactionRequest({
				data: data ?? '0x',
				from: senderAddress,
				gas,
				gasPrice,
				maxFeePerGas,
				maxPriorityFeePerGas,
				nonce: normalizeNonce(nonce),
				to,
				value,
			}),
		)
		const hash = requireTransactionHash(result.txHash, 'transaction')
		await mineSubmittedTransaction(hash)
		transactionCountSinceReset += 1n
		await refreshSimulationState()
		emitState()
		return hash
	}
	const requestRpc = async (parameters: RequestArguments) => {
		if (parameters.method === 'eth_sendRawTransaction') {
			const params = Array.isArray(parameters.params) ? parameters.params : []
			const serializedTransaction = params[0]
			if (typeof serializedTransaction !== 'string') throw new Error('Simulation raw transaction payload was invalid')
			return await sendRawTransactionInternal(serializedTransaction as SerializedTransaction)
		}
		if (parameters.method === 'eth_sendTransaction') {
			const params = Array.isArray(parameters.params) ? parameters.params : []
			const request = params[0]
			if (typeof request !== 'object' || request === null) throw new Error('Simulation transaction payload was invalid')
			return await sendTransactionInternal(normalizeRpcTransactionRequest(request as Record<string, unknown>))
		}
		return await (memoryClient.request as (parameters: RequestArguments) => Promise<unknown>)(parameters)
	}
	const provider = createSimulationProvider({
		getChainId: () => profile.chainIdHex,
		getQueryDelayMilliseconds: () => queryDelayMilliseconds,
		getSelectedAccount: () => selectedAccount,
		requestRpc,
	})
	const bootstrapProvider = createSimulationProvider({
		getChainId: () => profile.chainIdHex,
		getQueryDelayMilliseconds: () => 0,
		getSelectedAccount: () => selectedAccount,
		requestRpc,
	})
	const receiptClient = createPublicClient({
		chain: profile.chain,
		transport: custom(provider),
	}) as ReadClient
	const createWriteClientForProvider = ({ accountAddress, callbacks, currentProvider, getTransactionDelay, onReceiptResolved }: { accountAddress: Address; callbacks: CreateWriteClientCallbacks; currentProvider: InjectedEthereum; getTransactionDelay: () => number; onReceiptResolved: () => Promise<void> }) => {
		const baseClient = createWalletClient({
			account: accountAddress,
			chain: profile.chain,
			transport: custom(currentProvider),
		}).extend(publicActions) as WriteClient
		const sendRawTransaction: typeof baseClient.sendRawTransaction = async parameters => {
			const hash = await sendRawTransactionInternal(parameters.serializedTransaction as SerializedTransaction)
			callbacks.onTransactionSubmitted?.(hash)
			return hash
		}
		const sendTransaction: typeof baseClient.sendTransaction = async parameters => {
			const senderAddress = normalizeRequestedAccount(parameters.account, accountAddress)
			const hash = await sendTransactionInternal({
				...parameters,
				account: senderAddress,
			})
			callbacks.onTransactionSubmitted?.(hash)
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
			await delayMilliseconds(getTransactionDelay())
			for (let attempt = 0; attempt < 3; attempt += 1) {
				try {
					const receipt = await receiptClient.getTransactionReceipt({
						hash: parameters.hash,
					})
					await onReceiptResolved()
					return receipt
				} catch (error) {
					if (!isMissingTransactionReceiptError(error)) throw error
					await mineNextSimulationBlock(memoryClient)
				}
			}
			const receipt = await receiptClient.getTransactionReceipt({
				hash: parameters.hash,
			})
			await onReceiptResolved()
			return receipt
		}
		return withTransactionCallbacks(
			{
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
			},
			callbacks,
		)
	}
	await initializeSimulationAccounts()
	const createBootstrapReadClient = () =>
		createPublicClient({
			chain: profile.chain,
			transport: custom(bootstrapProvider),
		}) as ReadClient
	const createBootstrapWriteClient = (accountAddress: Address) =>
		createWriteClientForProvider({
			accountAddress,
			callbacks: {},
			currentProvider: bootstrapProvider,
			getTransactionDelay: () => 0,
			onReceiptResolved: async () => undefined,
		})
	const bootstrap = async () => {
		if (bootstrapPromise !== undefined) return await bootstrapPromise
		bootstrapping = true
		bootstrapError = undefined
		bootstrapLabel = 'Starting simulation bootstrap'
		bootstrapProgress = 0
		emitState()
		bootstrapPromise = (async () => {
			try {
				await bootstrapSimulationChain({
					accounts: QA_ACCOUNTS,
					createReadClient: createBootstrapReadClient,
					createWriteClient: createBootstrapWriteClient,
					memoryClient,
					onProgress: progress => {
						bootstrapLabel = progress.label
						bootstrapProgress = progress.value
						emitState()
					},
					primaryAccount,
					profile,
					scenario,
				})
				await refreshSimulationState()
				baselineTransactionCount = transactionCountSinceReset
				bootstrapLabel = 'Simulation scenario ready'
				bootstrapProgress = 1
				bootstrapped = true
			} catch (error) {
				bootstrapError = error instanceof Error ? error.message : 'Failed to bootstrap simulation scenario'
				throw error
			} finally {
				bootstrapping = false
				if (bootstrapped) {
					bootstrapLabel = undefined
					bootstrapProgress = undefined
				}
				emitState()
			}
		})()
		return await bootstrapPromise
	}
	const getState = (): SimulationWorkerState => ({
		bootstrapError,
		bootstrapLabel,
		bootstrapProgress,
		blockCountSinceReset,
		currentScenario: scenario,
		currentTimestamp,
		isBootstrapped: bootstrapped,
		isBootstrapping: bootstrapping,
		queryDelayMilliseconds,
		repPerEthPrice,
		repPerUsdcPrice,
		selectedAccount,
		transactionCountSinceReset,
		transactionDelayMilliseconds,
	})
	return {
		accounts: QA_ACCOUNTS,
		advanceTime: async seconds => {
			await advanceSimulationTime(memoryClient, seconds)
			await refreshSimulationState()
			emitState()
		},
		bootstrap,
		getAccounts: async () => [selectedAccount],
		getChainId: async () => profile.chainIdHex,
		getProfile: () => profile,
		getState,
		installSimulationProxyDeployer: async ({ address, runtimeCode }) => {
			await memoryClient.setCode({
				address,
				bytecode: runtimeCode,
			})
		},
		mintRep: async amount => {
			if (!bootstrapped) {
				throw new Error('Simulation scenario must be bootstrapped before minting REP')
			}

			const repCode = await memoryClient.getCode({
				address: profile.genesisRepTokenAddress,
			})
			if (repCode === undefined || repCode === '0x') {
				throw new Error('Simulation REP token is unavailable')
			}

			const zoltarAddress = getZoltarAddress()
			await mintSimulationGenesisRep({
				accountAddress: selectedAccount,
				amount,
				memoryClient,
				repAddress: profile.genesisRepTokenAddress,
				zoltarAddress,
			})
			emitState()
		},
		mineBlock: async () => {
			await mineNextSimulationBlock(memoryClient)
			await refreshSimulationState()
			emitState()
		},
		patchSimulationGenesisRepToken: async ({ zoltarAddress }) => {
			await updateZoltarGenesisRepToken(memoryClient, zoltarAddress, profile.genesisRepTokenAddress)
		},
		request: async parameters => await requestRpc(parameters),
		reset: async () => {
			bootstrapError = undefined
			bootstrapLabel = 'Resetting simulation scenario'
			bootstrapProgress = 0
			memoryClient = createSimulationMemoryClient(profile)
			impersonatedAccounts.clear()
			await initializeSimulationAccounts()
			await bootstrapSimulationChain({
				accounts: QA_ACCOUNTS,
				createReadClient: createBootstrapReadClient,
				createWriteClient: createBootstrapWriteClient,
				memoryClient,
				onProgress: progress => {
					bootstrapLabel = progress.label
					bootstrapProgress = progress.value
					emitState()
				},
				primaryAccount,
				profile,
				scenario,
			})
			selectedAccount = primaryAccount
			transactionCountSinceReset = baselineTransactionCount
			repPerEthPrice = DEFAULT_SIMULATION_REP_PER_ETH_PRICE
			repPerUsdcPrice = DEFAULT_SIMULATION_REP_PER_USDC_PRICE
			await refreshSimulationState()
			bootstrapLabel = undefined
			bootstrapProgress = undefined
			emitState()
		},
		selectAccount: async address => {
			if (!QA_ACCOUNTS.includes(address)) throw new Error(`Unknown simulation account: ${address}`)
			selectedAccount = address
			await ensureImpersonated(address)
			emitState()
		},
		setRepPerEthPrice: value => {
			if (value <= 0n) throw new Error('Simulation REP/ETH price must be greater than zero')
			repPerEthPrice = value
			emitState()
		},
		setRepPerUsdcPrice: value => {
			if (value <= 0n) throw new Error('Simulation REP/USDC price must be greater than zero')
			repPerUsdcPrice = value
			emitState()
		},
		setQueryDelayMilliseconds: value => {
			queryDelayMilliseconds = clampDelayMilliseconds(value)
			emitState()
		},
		setTransactionDelayMilliseconds: value => {
			transactionDelayMilliseconds = clampDelayMilliseconds(value)
			emitState()
		},
		subscribe: handler => {
			stateListeners.add(handler)
			return () => {
				stateListeners.delete(handler)
			}
		},
		waitForTransactionReceipt: async hash => {
			const writeClient = createWriteClientForProvider({
				accountAddress: selectedAccount,
				callbacks: {},
				currentProvider: provider,
				getTransactionDelay: () => transactionDelayMilliseconds,
				onReceiptResolved: async () => {
					await refreshSimulationState()
					emitState()
				},
			})
			return await writeClient.waitForTransactionReceipt({ hash })
		},
		waitUntilReady: async () => {
			await bootstrap()
		},
	}
}

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
import { serializeSavedSimulationStateEnvelope, type SavedSimulationStateEnvelopeV1, type SimulationInitialization, type SimulationSource } from './savedStates.js'
import type { SimulationWorkerState } from './tevmWorkerProtocol.js'
const QA_ACCOUNTS = [getAddress('0x00000000000000000000000000000000000000a1'), getAddress('0x00000000000000000000000000000000000000b2'), getAddress('0x00000000000000000000000000000000000000c3')] as const satisfies readonly Address[]
type MemoryClientLike = ReturnType<typeof createMemoryClient>
type DumpedTevmState = Awaited<ReturnType<MemoryClientLike['tevmDumpState']>>['state']
type DumpedTevmAccountState = DumpedTevmState[string]
type TemporarySimulationAccountCopy = {
	address: Address
	mode: 'full' | 'storage'
}
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
	exportState(name: string): Promise<string>
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

function getInitializationScenario(initialization: SimulationInitialization): SimulationScenario {
	return initialization.kind === 'scenario' ? initialization.scenario : initialization.envelope.baseScenario
}

function getSimulationSource(initialization: SimulationInitialization): SimulationSource {
	return initialization.kind === 'scenario'
		? {
				kind: 'scenario',
				scenario: initialization.scenario,
			}
		: {
				baseScenario: initialization.envelope.baseScenario,
				kind: 'saved-state',
				name: initialization.envelope.name,
				savedAt: initialization.envelope.savedAt,
				stateId: initialization.stateId,
			}
}

async function requireSuccessfulLoadState(memoryClient: MemoryClientLike, state: DumpedTevmState) {
	const result = await memoryClient.tevmLoadState({ state })
	if (result.errors === undefined || result.errors.length === 0) return
	throw new Error(result.errors.map(error => error.message).join(', '))
}

async function requireSuccessfulDumpState(memoryClient: MemoryClientLike): Promise<DumpedTevmState> {
	const result = await memoryClient.tevmDumpState()
	if (result.errors === undefined || result.errors.length === 0) return result.state
	throw new Error(result.errors.map(error => error.message).join(', '))
}

function getDumpedAccountState(state: DumpedTevmState, address: Address) {
	const normalizedAddress = address.toLowerCase()
	const matchingEntry = Object.entries(state).find(([candidateAddress]) => candidateAddress.toLowerCase() === normalizedAddress)
	return matchingEntry?.[1]
}

function normalizeDumpedStorage(storage: NonNullable<DumpedTevmAccountState['storage']>): Record<Hex, Hex> {
	const normalizedStorage: Record<Hex, Hex> = {}
	for (const [key, value] of Object.entries(storage)) {
		normalizedStorage[key as Hex] = value as Hex
	}
	return normalizedStorage
}

async function applyDumpedAccountState(memoryClient: MemoryClientLike, address: Address, state: DumpedTevmState) {
	const accountState = getDumpedAccountState(state, address)
	if (accountState === undefined) throw new Error(`Missing simulation account state for ${address}`)

	const setAccountResult = await memoryClient.tevmSetAccount({
		address,
		balance: BigInt(accountState.balance),
		...(accountState.deployedBytecode === undefined ? {} : { deployedBytecode: accountState.deployedBytecode }),
		nonce: BigInt(accountState.nonce),
		...(accountState.storage === undefined ? {} : { state: normalizeDumpedStorage(accountState.storage) }),
	})
	if (setAccountResult.errors !== undefined && setAccountResult.errors.length > 0) {
		throw new Error(setAccountResult.errors.map(error => error.message).join(', '))
	}
}

async function applyDumpedStorageState(memoryClient: MemoryClientLike, address: Address, state: DumpedTevmState) {
	const accountState = getDumpedAccountState(state, address)
	if (accountState === undefined) throw new Error(`Missing simulation account state for ${address}`)
	if (accountState.storage === undefined) throw new Error(`Missing simulation storage state for ${address}`)

	for (const [index, value] of Object.entries(accountState.storage)) {
		await memoryClient.setStorageAt({
			address,
			index: index as Hex,
			value: value as Hex,
		})
	}
}

export async function createSimulationEngine({ initialization }: { initialization: SimulationInitialization }): Promise<SimulationEngine> {
	const primaryAccount = QA_ACCOUNTS[0]
	if (primaryAccount === undefined) throw new Error('No simulation QA accounts configured')
	const predictedTokenAddresses = predictSimulationTokenAddresses(primaryAccount)
	const profile = createSimulationProfile(predictedTokenAddresses)
	const baseScenario = getInitializationScenario(initialization)
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
	const simulationSource = getSimulationSource(initialization)
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
	const createMemoryBackedWriteClient = ({ accountAddress, memoryClientInstance }: { accountAddress: Address; memoryClientInstance: MemoryClientLike }): WriteClient => {
		const readClient = createPublicClient({
			chain: profile.chain,
			transport: custom({
				request: async parameters => await (memoryClientInstance.request as (parameters: RequestArguments) => Promise<unknown>)(parameters),
			}),
		})
		const sendTransaction = async ({ account, data, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, to, value }: SimulationSendTransactionRequest) => {
			const senderAddress = normalizeRequestedAccount(account, accountAddress)
			await memoryClientInstance.impersonateAccount({ address: senderAddress })
			const result = await memoryClientInstance.tevmCall(
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
			const hash = requireTransactionHash(result.txHash, 'temporary simulation transaction')
			const chainTimestamp = await getSimulationChainTimestamp(memoryClientInstance)
			await minePendingSimulationTransactionAtTimestamp(memoryClientInstance, hash, getNextSimulationTimestamp(chainTimestamp))
			return hash
		}
		const writeContract: WriteClient['writeContract'] = async parameters =>
			await sendTransaction({
				account: parameters.account,
				data: encodeFunctionData(parameters as Parameters<typeof encodeFunctionData>[0]),
				gas: parameters.gas,
				maxFeePerGas: parameters.maxFeePerGas,
				maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
				to: parameters.address,
				value: parameters.value,
			})

		return {
			account: accountAddress,
			getCode: async (parameters: Parameters<typeof readClient.getCode>[0]) => await readClient.getCode(parameters),
			readContract: async (parameters: Parameters<typeof readClient.readContract>[0]) => await readClient.readContract(parameters as never),
			sendTransaction,
			waitForTransactionReceipt: async (parameters: Parameters<typeof readClient.getTransactionReceipt>[0]) => await readClient.getTransactionReceipt({ hash: parameters.hash }),
			writeContract,
		} as never
	}
	const applyTemporarySimulationAccountChanges = async ({ accountsToCopy, mutate }: { accountsToCopy: readonly TemporarySimulationAccountCopy[]; mutate: (context: { createWriteClient: (accountAddress: Address) => WriteClient; memoryClient: MemoryClientLike }) => Promise<void> }) => {
		const baseSnapshot = await requireSuccessfulDumpState(memoryClient)
		const temporaryMemoryClient = createSimulationMemoryClient(profile)
		await requireSuccessfulLoadState(temporaryMemoryClient, baseSnapshot)
		await mutate({
			createWriteClient: accountAddress =>
				createMemoryBackedWriteClient({
					accountAddress,
					memoryClientInstance: temporaryMemoryClient,
				}),
			memoryClient: temporaryMemoryClient,
		})
		const mutatedSnapshot = await requireSuccessfulDumpState(temporaryMemoryClient)
		for (const { address, mode } of accountsToCopy) {
			if (mode === 'storage') {
				await applyDumpedStorageState(memoryClient, address, mutatedSnapshot)
				continue
			}
			await applyDumpedAccountState(memoryClient, address, mutatedSnapshot)
		}
	}
	const restoreSavedStateEnvelope = async (envelope: SavedSimulationStateEnvelopeV1, progressLabel: string) => {
		bootstrapError = undefined
		bootstrapLabel = progressLabel
		bootstrapProgress = 0
		memoryClient = createSimulationMemoryClient(profile)
		impersonatedAccounts.clear()
		await initializeSimulationAccounts()
		await requireSuccessfulLoadState(memoryClient, envelope.state.snapshot as DumpedTevmState)
		await initializeSimulationAccounts()
		queryDelayMilliseconds = clampDelayMilliseconds(envelope.state.queryDelayMilliseconds)
		repPerEthPrice = envelope.state.repPerEthPrice
		repPerUsdcPrice = envelope.state.repPerUsdcPrice
		transactionDelayMilliseconds = clampDelayMilliseconds(envelope.state.transactionDelayMilliseconds)
		transactionCountSinceReset = envelope.state.transactionCountSinceReset
		const nextSelectedAccount = QA_ACCOUNTS.find(account => account.toLowerCase() === envelope.state.selectedAccount.toLowerCase())
		if (nextSelectedAccount === undefined) throw new Error(`Unknown saved simulation account: ${envelope.state.selectedAccount}`)
		selectedAccount = nextSelectedAccount
		await ensureImpersonated(selectedAccount)
		await refreshSimulationState()
		baselineTransactionCount = envelope.state.transactionCountSinceReset
		bootstrapLabel = 'Simulation scenario ready'
		bootstrapProgress = 1
		bootstrapped = true
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
	})
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
					await applyTemporarySimulationAccountChanges({
						accountsToCopy: [{ address: zoltarAddress, mode: 'storage' }],
						mutate: async ({ createWriteClient, memoryClient: temporaryMemoryClient }) => {
							await updateZoltarGenesisRepToken({
								createWriteClient,
								memoryClient: temporaryMemoryClient,
								repAddress: profile.genesisRepTokenAddress,
								zoltarAddress,
							})
						},
					})
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
		})
	const createBootstrapWriteClient = (accountAddress: Address) =>
		createWriteClientForProvider({
			accountAddress,
			callbacks: {},
			currentProvider: bootstrapProvider,
			getTransactionDelay: () => 0,
			onReceiptResolved: async () => undefined,
		})
	const bootstrapBuiltInScenario = async (scenario: SimulationScenario) => {
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
	}
	const bootstrap = async () => {
		if (bootstrapPromise !== undefined) return await bootstrapPromise
		bootstrapping = true
		bootstrapError = undefined
		bootstrapLabel = initialization.kind === 'scenario' ? 'Starting simulation bootstrap' : 'Loading saved simulation state'
		bootstrapProgress = 0
		emitState()
		bootstrapPromise = (async () => {
			try {
				if (initialization.kind === 'scenario') {
					await bootstrapBuiltInScenario(initialization.scenario)
				} else {
					await restoreSavedStateEnvelope(initialization.envelope, 'Loading saved simulation state')
				}
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
		currentScenario: baseScenario,
		currentTimestamp,
		currentSource: simulationSource,
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
		exportState: async name => {
			if (!bootstrapped) throw new Error('Simulation scenario must be bootstrapped before exporting state')
			const snapshot = await memoryClient.tevmDumpState()
			if (snapshot.errors !== undefined && snapshot.errors.length > 0) {
				throw new Error(snapshot.errors.map(error => error.message).join(', '))
			}
			const normalizedName = name.trim()
			if (normalizedName === '') throw new Error('Saved simulation state name is required')
			return serializeSavedSimulationStateEnvelope({
				baseScenario,
				name: normalizedName,
				savedAt: new Date().toISOString(),
				state: {
					blockCountSinceReset,
					currentTimestamp,
					queryDelayMilliseconds,
					repPerEthPrice,
					repPerUsdcPrice,
					selectedAccount,
					snapshot: snapshot.state,
					transactionCountSinceReset,
					transactionDelayMilliseconds,
				},
				version: 1,
			})
		},
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
			const zoltarCode = await memoryClient.getCode({
				address: zoltarAddress,
			})
			const accountsToCopy: readonly TemporarySimulationAccountCopy[] =
				zoltarCode === undefined || zoltarCode === '0x'
					? [{ address: profile.genesisRepTokenAddress, mode: 'full' }]
					: [
							{ address: profile.genesisRepTokenAddress, mode: 'full' },
							{ address: zoltarAddress, mode: 'storage' },
						]
			await applyTemporarySimulationAccountChanges({
				accountsToCopy,
				mutate: async ({ createWriteClient, memoryClient: temporaryMemoryClient }) => {
					await mintSimulationGenesisRep({
						accountAddress: selectedAccount,
						amount,
						createWriteClient,
						memoryClient: temporaryMemoryClient,
						repAddress: profile.genesisRepTokenAddress,
						zoltarAddress,
					})
				},
			})
			await refreshSimulationState()
			emitState()
		},
		mineBlock: async () => {
			await mineNextSimulationBlock(memoryClient)
			await refreshSimulationState()
			emitState()
		},
		patchSimulationGenesisRepToken: async ({ zoltarAddress }) => {
			await applyTemporarySimulationAccountChanges({
				accountsToCopy: [{ address: zoltarAddress, mode: 'storage' }],
				mutate: async ({ createWriteClient, memoryClient: temporaryMemoryClient }) => {
					await updateZoltarGenesisRepToken({
						createWriteClient,
						memoryClient: temporaryMemoryClient,
						repAddress: profile.genesisRepTokenAddress,
						zoltarAddress,
					})
				},
			})
		},
		request: async parameters => await requestRpc(parameters),
		reset: async () => {
			bootstrapError = undefined
			bootstrapLabel = 'Resetting simulation scenario'
			bootstrapProgress = 0
			bootstrapping = true
			emitState()
			try {
				if (initialization.kind === 'scenario') {
					memoryClient = createSimulationMemoryClient(profile)
					impersonatedAccounts.clear()
					await initializeSimulationAccounts()
					await bootstrapBuiltInScenario(initialization.scenario)
					selectedAccount = primaryAccount
					transactionCountSinceReset = baselineTransactionCount
					repPerEthPrice = DEFAULT_SIMULATION_REP_PER_ETH_PRICE
					repPerUsdcPrice = DEFAULT_SIMULATION_REP_PER_USDC_PRICE
					queryDelayMilliseconds = 0
					transactionDelayMilliseconds = 1000
					await refreshSimulationState()
				} else {
					await restoreSavedStateEnvelope(initialization.envelope, 'Resetting saved simulation state')
				}
				bootstrapLabel = undefined
				bootstrapProgress = undefined
			} finally {
				bootstrapping = false
				emitState()
			}
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

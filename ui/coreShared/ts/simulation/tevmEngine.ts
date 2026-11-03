import { createPublicClient, createWalletClient, custom, encodeFunctionData, getAddress, parseTransaction, publicActions, recoverTransactionAddress, type Address, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { InjectedEthereum } from '../wallet/injectedEthereum.js'
import type { ChainBackend, CreateWriteClientCallbacks, ReadClient, WriteClient } from '../wallet/chainBackend.js'
import { withTransactionCallbacks } from './writeClientCallbacks.js'
import { createSimulationProfile } from '../wallet/networkProfile.js'
import type { GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import { bootstrapSimulationChain, mintSimulationGenesisRep, predictSimulationTokenAddresses, updateZoltarGenesisRepToken, type BootstrapScenarioApplyParameters } from './bootstrap.js'
import { advanceSimulationTime, advanceNextSimulationBlock, initializeSimulationClock, type TevmLikeClient } from './clock.js'
import { applyDumpedAccountState, applyDumpedStorageState, formatTevmErrors, requireSuccessfulDumpState, requireSuccessfulLoadState, type DumpedTevmState } from './dumpedState.js'
import { createSimulationChain, type SimulationChain, type SimulationTransactionParameters } from './simulationChain.js'
import type { SimulationScenario } from './scenarios.js'
import { getSimulationSource, parseSavedSimulationStateEnvelope, serializeSavedSimulationStateEnvelope, type SavedSimulationStateEnvelopeV1, type SimulationInitialization } from './savedStates.js'
import { getBundledSimulationSnapshotKey } from './scenarioSnapshots.js'
import { createSimulationProvider, type SimulationProviderRequest } from './simulationProvider.js'
import type { SimulationBootstrapParameters, SimulationWorkerState } from './tevmWorkerProtocol.js'
const QA_ACCOUNTS = [getAddress('0x00000000000000000000000000000000000000a1'), getAddress('0x00000000000000000000000000000000000000b2'), getAddress('0x00000000000000000000000000000000000000c3')] as const satisfies readonly Address[]
type MemoryClientLike = TevmLikeClient
type TemporarySimulationAccountCopy = {
	address: Address
	mode: 'full' | 'storage'
}
type RequestArguments = SimulationProviderRequest
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
function normalizeNonce(value: bigint | number | undefined) {
	if (value === undefined) return undefined
	return typeof value === 'bigint' ? value : BigInt(value)
}
async function submitSimulationTransaction(chain: SimulationChain, from: Address, { data, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, to, value }: SimulationSendTransactionRequest, label: string) {
	const blockGasLimit = (await chain.memoryClient.getBlock()).gasLimit
	return await chain.sendTransaction({ data: data ?? '0x', from, gas: gas ?? blockGasLimit, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce: normalizeNonce(nonce), to, value }, label)
}
function clampDelayMilliseconds(value: number) {
	if (!Number.isFinite(value) || value <= 0) return 0
	return Math.min(Math.trunc(value), 30000)
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
type SimulationEngine = {
	accounts: readonly Address[]
	advanceTime(seconds: bigint): Promise<void>
	bootstrap(parameters?: SimulationBootstrapParameters): Promise<void>
	exportState(name: string): Promise<string>
	getAccounts(): Promise<readonly Address[]>
	getChainId(): Promise<string>
	getProfile(): ChainBackend['profile']
	getState(): SimulationWorkerState
	installSimulationProxyDeployer(parameters: { address: Address; runtimeCode: Hex }): Promise<void>
	mintRep(amount: bigint): Promise<void>
	advanceBlock(): Promise<void>
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

export type SimulationEngineDependencies = {
	applyScenario?: (parameters: BootstrapScenarioApplyParameters) => Promise<boolean>
	/** The snapshot source key compiled into this bundle; defaults to the build-time define, absent outside bundles. */
	getBundledSnapshotKey?: () => string | undefined
	getDeploymentSteps: (profile: ReturnType<typeof createSimulationProfile>) => readonly import('../types/contracts.js').DeploymentStep[]
	getZoltarAddress: (profile: ReturnType<typeof createSimulationProfile>) => Address
}

export async function createSimulationEngine({ initialization, dependencies, genesisOutcome = 'yes' }: { initialization: SimulationInitialization; dependencies: SimulationEngineDependencies; genesisOutcome?: GenesisOutcome }): Promise<SimulationEngine> {
	const primaryAccount = QA_ACCOUNTS[0]
	if (primaryAccount === undefined) throw new Error('No simulation QA accounts configured')
	const predictedTokenAddresses = predictSimulationTokenAddresses(primaryAccount, genesisOutcome)
	const profile = createSimulationProfile({ ...predictedTokenAddresses, genesisOutcome })
	const baseScenario = getInitializationScenario(initialization)
	let chain = await createSimulationChain(profile)
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
	/** The prepared state a scenario bootstrap restored, so a reset restores it again instead of seeding. */
	let scenarioSnapshot: SavedSimulationStateEnvelopeV1 | undefined = undefined
	let selectedAccount = primaryAccount
	const simulationSource = getSimulationSource(initialization)
	let transactionCountSinceReset = 0n
	let transactionDelayMilliseconds = 1000
	const emitState = () => {
		for (const listener of stateListeners) {
			listener()
		}
	}
	const ensureImpersonated = async (address: Address, targetChain = chain) => {
		const normalizedAddress = address.toLowerCase()
		if (impersonatedAccounts.has(normalizedAddress)) return
		await targetChain.memoryClient.impersonateAccount({ address })
		impersonatedAccounts.add(normalizedAddress)
	}
	const initializeSimulationAccounts = async (targetChain = chain) => {
		for (const account of QA_ACCOUNTS) {
			await ensureImpersonated(account, targetChain)
		}
	}
	const refreshSimulationState = async () => {
		const chainState = await getSimulationChainState(chain.memoryClient)
		currentTimestamp = chainState.currentTimestamp
		blockCountSinceReset = chainState.blockNumber
	}
	const createMemoryBackedWriteClient = ({ accountAddress, chainInstance }: { accountAddress: Address; chainInstance: SimulationChain }): WriteClient => {
		const readClient = createPublicClient({
			chain: profile.chain,
			transport: custom({
				request: async parameters => await chainInstance.request(parameters),
			}),
		})
		const sendTransaction = async (request: SimulationSendTransactionRequest) => {
			const senderAddress = normalizeRequestedAccount(request.account, accountAddress)
			await chainInstance.memoryClient.impersonateAccount({ address: senderAddress })
			return await submitSimulationTransaction(chainInstance, senderAddress, request, 'temporary simulation transaction')
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
			readContract: async (parameters: Parameters<typeof readClient.readContract>[0]) => await readClient.readContract(parameters),
			sendTransaction,
			waitForTransactionReceipt: async (parameters: Parameters<typeof readClient.getTransactionReceipt>[0]) => await readClient.getTransactionReceipt({ hash: parameters.hash }),
			writeContract,
		} as never
	}
	// One locked unit on the chain current when the change starts, so nothing lands on the copied accounts between the
	// dump and the write-back and a reset meanwhile cannot redirect the write-back; the temporary chain carries its own lock.
	const applyTemporarySimulationAccountChanges = async ({
		accountsToCopy,
		chain: activeChain,
		mutate,
	}: {
		accountsToCopy: readonly TemporarySimulationAccountCopy[]
		chain: SimulationChain
		mutate: (context: { createWriteClient: (accountAddress: Address) => WriteClient; memoryClient: MemoryClientLike }) => Promise<void>
	}) =>
		await activeChain.withLock(async () => {
			const baseSnapshot = await requireSuccessfulDumpState(activeChain.memoryClient)
			const temporaryChain = await createSimulationChain(profile)
			await requireSuccessfulLoadState(temporaryChain.memoryClient, baseSnapshot)
			await mutate({
				createWriteClient: accountAddress =>
					createMemoryBackedWriteClient({
						accountAddress,
						chainInstance: temporaryChain,
					}),
				memoryClient: temporaryChain.memoryClient,
			})
			const mutatedSnapshot = await requireSuccessfulDumpState(temporaryChain.memoryClient)
			for (const { address, mode } of accountsToCopy) {
				if (mode === 'storage') {
					await applyDumpedStorageState(activeChain.memoryClient, address, mutatedSnapshot)
					continue
				}
				await applyDumpedAccountState(activeChain.memoryClient, address, mutatedSnapshot)
			}
		})
	const installSimulationProxyDeployer = async ({ address, runtimeCode }: { address: Address; runtimeCode: Hex }) => {
		const activeChain = chain
		await activeChain.withLock(async () => {
			await activeChain.memoryClient.setCode({
				address,
				bytecode: runtimeCode,
			})
		})
	}
	const patchSimulationGenesisRepToken = async ({ zoltarAddress }: { zoltarAddress: Address }) => {
		await applyTemporarySimulationAccountChanges({
			accountsToCopy: [{ address: zoltarAddress, mode: 'storage' }],
			chain,
			mutate: async ({ createWriteClient, memoryClient: temporaryMemoryClient }) => {
				await updateZoltarGenesisRepToken({
					createWriteClient,
					memoryClient: temporaryMemoryClient,
					repAddress: profile.genesisRepTokenAddress,
					zoltarAddress,
				})
			},
		})
	}
	const restoreSavedStateEnvelope = async (envelope: SavedSimulationStateEnvelopeV1, progressLabel: string) => {
		if ((envelope.genesisOutcome ?? 'yes') !== genesisOutcome) throw new Error('The saved state belongs to another genesis universe.')
		bootstrapError = undefined
		bootstrapLabel = progressLabel
		bootstrapProgress = 0
		emitState()
		// The restored chain becomes the engine's chain only once it is complete; work that slipped past the seeding gate keeps using the old one.
		const restored = await createSimulationChain(profile)
		impersonatedAccounts.clear()
		await initializeSimulationAccounts(restored)
		await requireSuccessfulLoadState(restored.memoryClient, envelope.state.snapshot as DumpedTevmState)
		await initializeSimulationAccounts(restored)
		if (envelope.state.blocks !== undefined && envelope.state.blocks.length > 0) {
			// The saved blocks bring back logs, receipts and numbering; one fresh block ties the loaded state to the head.
			await restored.restoreHistory(envelope.state.blocks)
			await advanceNextSimulationBlock(restored.memoryClient)
		} else {
			// Loading state leaves the chain at genesis time; the saved contracts expect the clock they were saved under.
			await initializeSimulationClock(restored.memoryClient, envelope.state.currentTimestamp)
		}
		chain = restored
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
	const recordSubmittedTransaction = async (hash: Hash) => {
		transactionCountSinceReset += 1n
		await refreshSimulationState()
		emitState()
		return hash
	}
	const sendRawTransactionInternal = async (serializedTransaction: SerializedTransaction) => {
		const parsedTransaction = parseTransaction(serializedTransaction)
		const recoveredAddress = await recoverTransactionAddress({
			serializedTransaction,
		})
		await ensureImpersonated(recoveredAddress)
		const hash = await chain.sendTransaction(
			{
				data: parsedTransaction.data ?? '0x',
				from: recoveredAddress,
				gas: parsedTransaction.gas,
				gasPrice: parsedTransaction.gasPrice,
				maxFeePerGas: parsedTransaction.maxFeePerGas,
				maxPriorityFeePerGas: parsedTransaction.maxPriorityFeePerGas,
				nonce: normalizeNonce(parsedTransaction.nonce),
				to: parsedTransaction.to,
				value: parsedTransaction.value,
			} satisfies SimulationTransactionParameters,
			'raw transaction',
		)
		return await recordSubmittedTransaction(hash)
	}
	const sendTransactionInternal = async (request: SimulationSendTransactionRequest) => {
		const senderAddress = normalizeRequestedAccount(request.account, selectedAccount)
		await ensureImpersonated(senderAddress)
		return await recordSubmittedTransaction(await submitSimulationTransaction(chain, senderAddress, request, 'transaction'))
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
		return await chain.request(parameters)
	}
	const requestFromOutside = async (parameters: RequestArguments) => {
		await awaitSeeding()
		return await requestRpc(parameters)
	}
	const provider = createSimulationProvider({
		getChainId: () => profile.chainIdHex,
		getQueryDelayMilliseconds: () => queryDelayMilliseconds,
		getSelectedAccount: () => selectedAccount,
		requestRpc: requestFromOutside,
	})
	const bootstrapProvider = createSimulationProvider({
		getChainId: () => profile.chainIdHex,
		getQueryDelayMilliseconds: () => 0,
		getSelectedAccount: () => selectedAccount,
		requestRpc,
	})
	// Receipt polling serves seeding as well as the UI, so it must not wait for seeding to finish.
	const receiptClient = createPublicClient({
		chain: profile.chain,
		transport: custom(
			createSimulationProvider({
				getChainId: () => profile.chainIdHex,
				getQueryDelayMilliseconds: () => queryDelayMilliseconds,
				getSelectedAccount: () => selectedAccount,
				requestRpc,
			}),
		),
	})
	// Seeding writes to the chain directly; work that arrives from outside the engine waits until it has finished.
	let seeding: Promise<void> | undefined = undefined
	const awaitSeeding = async () => {
		if (seeding !== undefined) await seeding.catch(() => undefined)
	}
	const createWriteClientForProvider = ({
		accountAddress,
		callbacks,
		currentProvider,
		getTransactionDelay,
		onReceiptResolved,
		waitsForSeeding,
	}: {
		accountAddress: Address
		callbacks: CreateWriteClientCallbacks
		currentProvider: InjectedEthereum
		getTransactionDelay: () => number
		onReceiptResolved: () => Promise<void>
		waitsForSeeding: boolean
	}) => {
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
				// A reset can start during the delay above or while the receipt is looked up below.
				if (waitsForSeeding) await awaitSeeding()
				const activeChain = chain
				try {
					const receipt = await receiptClient.getTransactionReceipt({
						hash: parameters.hash,
					})
					await onReceiptResolved()
					return receipt
				} catch (error) {
					if (!isMissingTransactionReceiptError(error)) throw error
					// A chain swapped underneath the lookup is being seeded; the next gated attempt reads the finished one.
					if (chain === activeChain) await advanceNextSimulationBlock(activeChain.memoryClient)
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
				installSimulationProxyDeployer,
				patchSimulationGenesisRepToken,
				sendRawTransaction,
				sendTransaction,
				waitForTransactionReceipt,
				writeContract,
			},
			callbacks,
		)
	}
	await initializeSimulationAccounts()
	const createBootstrapReadClient = () => createPublicClient({ chain: profile.chain, transport: custom(bootstrapProvider) })
	const createBootstrapWriteClient = (accountAddress: Address) =>
		createWriteClientForProvider({
			accountAddress,
			callbacks: {},
			currentProvider: bootstrapProvider,
			getTransactionDelay: () => 0,
			onReceiptResolved: async () => undefined,
			waitsForSeeding: false,
		})
	const bootstrapBuiltInScenario = async (scenario: SimulationScenario) => {
		await bootstrapSimulationChain({
			accounts: QA_ACCOUNTS,
			...(dependencies.applyScenario === undefined ? {} : { applyScenario: dependencies.applyScenario }),
			createReadClient: createBootstrapReadClient,
			createWriteClient: createBootstrapWriteClient,
			getDeploymentSteps: dependencies.getDeploymentSteps,
			zoltarAddress: dependencies.getZoltarAddress(profile),
			memoryClient: chain.memoryClient,
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
	/** Returns the prepared envelope when it was made for this scenario, universe and these sources; anything else seeds live instead. */
	const parseScenarioSnapshot = (scenario: SimulationScenario, { scenarioSnapshot: serialized, scenarioSnapshotKey }: SimulationBootstrapParameters) => {
		if (serialized === undefined) return undefined
		try {
			const bundledKey = (dependencies.getBundledSnapshotKey ?? getBundledSimulationSnapshotKey)()
			if (bundledKey !== undefined && scenarioSnapshotKey !== undefined && bundledKey !== scenarioSnapshotKey) throw new Error('The prepared state was generated for other sources')
			const envelope = parseSavedSimulationStateEnvelope(serialized)
			if (envelope.baseScenario !== scenario) throw new Error(`The prepared state belongs to the ${envelope.baseScenario} scenario`)
			if ((envelope.genesisOutcome ?? 'yes') !== genesisOutcome) throw new Error('The prepared state belongs to another genesis universe')
			return envelope
		} catch (error) {
			console.warn(`[simulation] Ignoring the prepared ${scenario} state: ${error instanceof Error ? error.message : String(error)}`)
			return undefined
		}
	}
	/** Seeds the scenario on the current chain, or on a fresh one when resetting, unless a prepared state restores it. */
	const bootstrapScenario = async (scenario: SimulationScenario, resetChain: boolean) => {
		if (scenarioSnapshot !== undefined) {
			await restoreSavedStateEnvelope(scenarioSnapshot, 'Loading prepared simulation scenario')
			return
		}
		if (resetChain) {
			chain = await createSimulationChain(profile)
			impersonatedAccounts.clear()
			await initializeSimulationAccounts()
		}
		await bootstrapBuiltInScenario(scenario)
	}
	const bootstrap = async (parameters?: SimulationBootstrapParameters) => {
		if (bootstrapPromise !== undefined) return await bootstrapPromise
		bootstrapping = true
		bootstrapError = undefined
		bootstrapLabel = initialization.kind === 'scenario' ? 'Starting simulation bootstrap' : 'Loading saved simulation state'
		bootstrapProgress = 0
		emitState()
		bootstrapPromise = (async () => {
			try {
				if (initialization.kind === 'scenario') {
					scenarioSnapshot = parseScenarioSnapshot(initialization.scenario, parameters ?? {})
					await bootstrapScenario(initialization.scenario, false)
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
		seeding = bootstrapPromise
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
			await awaitSeeding()
			await advanceSimulationTime(chain.memoryClient, seconds)
			await refreshSimulationState()
			emitState()
		},
		bootstrap,
		exportState: async name => {
			await awaitSeeding()
			if (!bootstrapped) throw new Error('Simulation scenario must be bootstrapped before exporting state')
			// One locked unit on one chain, so the dumped state and the exported blocks describe the same chain.
			const activeChain = chain
			const { blocks, snapshot } = await activeChain.withLock(async () => ({ blocks: await activeChain.exportHistory(), snapshot: await activeChain.memoryClient.tevmDumpState() }))
			if (snapshot.errors !== undefined && snapshot.errors.length > 0) throw new Error(formatTevmErrors(snapshot.errors))
			const normalizedName = name.trim()
			if (normalizedName === '') throw new Error('Saved simulation state name is required')
			return serializeSavedSimulationStateEnvelope({
				baseScenario,
				genesisOutcome,
				name: normalizedName,
				savedAt: new Date().toISOString(),
				state: {
					blocks,
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
		installSimulationProxyDeployer,
		mintRep: async amount => {
			await awaitSeeding()
			if (!bootstrapped) {
				throw new Error('Simulation scenario must be bootstrapped before minting REP')
			}
			const activeChain = chain
			const repCode = await activeChain.memoryClient.getCode({
				address: profile.genesisRepTokenAddress,
			})
			if (repCode === undefined || repCode === '0x') {
				throw new Error('Simulation REP token is unavailable')
			}

			const zoltarAddress = dependencies.getZoltarAddress(profile)
			const zoltarCode = await activeChain.memoryClient.getCode({
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
				chain: activeChain,
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
		advanceBlock: async () => {
			await awaitSeeding()
			await advanceNextSimulationBlock(chain.memoryClient)
			await refreshSimulationState()
			emitState()
		},
		patchSimulationGenesisRepToken,
		request: async parameters => await requestFromOutside(parameters),
		reset: async () => {
			bootstrapError = undefined
			bootstrapLabel = 'Resetting simulation scenario'
			bootstrapProgress = 0
			bootstrapping = true
			emitState()
			const resetting = (async () => {
				if (initialization.kind === 'scenario') {
					await bootstrapScenario(initialization.scenario, true)
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
			})()
			seeding = resetting
			try {
				await resetting
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
				waitsForSeeding: true,
			})
			return await writeClient.waitForTransactionReceipt({ hash })
		},
		waitUntilReady: async () => {
			await bootstrap()
		},
	}
}

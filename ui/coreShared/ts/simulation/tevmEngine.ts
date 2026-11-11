import type { SimulationEngine } from './simulationEngineTypes.js'
import { parseScenarioSnapshot } from './preparedScenarioSnapshot.js'
import {
	getSimulationChainState,
	normalizeNonce,
	applyTemporarySimulationAccountChanges,
	normalizeRpcTransactionRequest,
	isMissingTransactionReceiptError,
	normalizeRequestedAccount,
	submitSimulationTransaction,
	clampDelayMilliseconds,
	delayMilliseconds,
	type SimulationSendTransactionRequest,
	type TemporarySimulationAccountCopy,
} from './simulationTransactions.js'
import { createPublicClient, createWalletClient, custom, encodeFunctionData, getAddress, parseTransaction, publicActions, recoverTransactionAddress, type Address, type Hash, type Hex } from '@zoltar/core-shared/evm/ethereum'
import type { InjectedEthereum } from '../wallet/injectedEthereum.js'
import type { CreateWriteClientCallbacks, WriteClient } from '../wallet/chainBackend.js'
import { withTransactionCallbacks } from './writeClientCallbacks.js'
import { createSimulationProfile } from '../wallet/networkProfile.js'
import type { GenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'
import { bootstrapSimulationChain, mintSimulationGenesisRep, predictSimulationTokenAddresses, updateZoltarGenesisRepToken, type BootstrapScenarioApplyParameters } from './bootstrap.js'
import { advanceSimulationTime, advanceNextSimulationBlock, initializeSimulationClock } from './clock.js'
import { formatTevmErrors, requireSuccessfulLoadState, type DumpedTevmState } from './dumpedState.js'
import { createSimulationChain, type SimulationTransactionParameters } from './simulationChain.js'
import type { SimulationScenario } from './scenarios.js'
import { getSimulationSource, serializeSavedSimulationStateEnvelope, type SavedSimulationStateEnvelopeV1, type SimulationInitialization } from './savedStates.js'
import { getBundledSimulationSnapshotKey } from './scenarioSnapshots.js'
import { createSimulationProvider, type SimulationProviderRequest } from './simulationProvider.js'
import type { SimulationBootstrapParameters, SimulationWorkerState } from './tevmWorkerProtocol.js'
const QA_ACCOUNTS = [getAddress('0x00000000000000000000000000000000000000a1'), getAddress('0x00000000000000000000000000000000000000b2'), getAddress('0x00000000000000000000000000000000000000c3')] as const satisfies readonly Address[]
type RequestArguments = SimulationProviderRequest
type SerializedTransaction = Parameters<typeof recoverTransactionAddress>[0]['serializedTransaction']
const DEFAULT_SIMULATION_REP_PER_ETH_PRICE = 3n * 10n ** 18n
const DEFAULT_SIMULATION_REP_PER_USDC_PRICE = 10n ** 6n
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
		await applyTemporarySimulationAccountChanges(profile, {
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
					scenarioSnapshot = parseScenarioSnapshot(initialization.scenario, genesisOutcome, dependencies.getBundledSnapshotKey ?? getBundledSimulationSnapshotKey, parameters ?? {})
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
			await applyTemporarySimulationAccountChanges(profile, {
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

#!/usr/bin/env bun

import { createPublicClient, createWalletClient, defineChain, getAddress, http, parseTransaction, privateKeyToAccount, readContractAtBlock, type Account, type Chain, type Transport, type WalletClient } from '@zoltar/bot-shared/ethereum'
import { checkConnectivity, endpointLabel, readRpcChainId } from '@zoltar/bot-shared/monitoring/connectivity'
import { quorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { pollUntilStopped } from '@zoltar/bot-shared/monitoring/resilience'
import { signerCandidate } from '@zoltar/bot-shared/config/signer'
import { submitSignedTransaction } from '@zoltar/bot-shared/execution/transaction-submission'
import { sendRawTransactionToRpc } from '@zoltar/bot-shared/monitoring/connectivity'
import { loadSettings, parseDesiredPools, parseStrategy, saveSettings, serializedSettings, type DesiredPoolSettings, type OperatorSettings } from '#config/settings'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { stagedOperationOutcome } from '#core/staged-outcome'
import { dryRunCandidate, executeLiquidation, executeOriginPoolDeployment, executeVaultMigration, maintainVault, validateReceiptExpectation } from '#execution/liquidation-executor'
import { scanPools } from '#monitoring/pool-monitor'
import { assertIntentSender, clearMarketEvidenceForConfigurationChange, commitReconciledIntent, initialRuntimeState, loadDurableState, operatorSnapshot, recordActivity, recoveredIntentCanBeResubmitted, resolveRecoveredIntentJournal, saveDurableState, type PoolObservation } from '#state/operator-state'
import { evaluateCandidate, liquidationExecutionAllowed, selectAllowedCandidate } from '#core/strategy'
import { ambiguousRecoveryAction, PRIVATE_INTENT_FINALITY_BLOCKS, requireRecoveredTransactionSuccess, shouldStopAfterSuccessfulCycle } from '#core/cycle-control'
import { inheritedChildPoolSelections, selectVaultMigration, validateApprovedUniverseSelection } from '#core/fork-migration'
import { createConfigurationMutationGate } from '#core/configuration-gate'
import { commitSignerMutation } from '#core/signer-mutation'
import { acquireLiquidatorExecutionLocksForShutdown, createLiquidatorShutdownController, liquidatorDashboardLifecycle } from '#core/process-lock'
import { parseTransactionReconciliation, validateReconciliationIntentChain, verifyFinalizedReplacement } from '#core/transaction-reconciliation'
import { centralizedMarketConfigurationAllowsExecution, centralizedMarketConsensusObservations, centralizedPriceAllowsExecution, marketConsensusSettings, observeCentralizedMarkets, parseCentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { observeConstantProductMarkets } from '@zoltar/bot-shared/monitoring/constant-product-markets'
import { clearOrphanedDexEvidenceForHeadReplacement, discardDexMarketObservations, estimateMarketConsensus, marketConsensusAllowsExecution, marketObservationsForAsset, requireCanonicalBlock, requireCanonicalDexEvidence } from '@zoltar/bot-shared/monitoring/market-consensus'
import { securityPoolFactoryAbi } from '#contracts/abi'

const constantProductPairAbi = [
	{ inputs: [], name: 'token0', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
	{ inputs: [], name: 'token1', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
	{ inputs: [], name: 'getReserves', outputs: [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }], stateMutability: 'view', type: 'function' },
] as const

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

function chainFor(settings: OperatorSettings) {
	return defineChain({
		id: settings.network.chainId,
		name: settings.network.name,
		nativeCurrency: {
			decimals: 18,
			name: 'Ether',
			symbol: 'ETH',
		},
		rpcUrls: {
			default: {
				http: [settings.connectivity.readRpcUrl],
			},
		},
	})
}

async function canonicalBlockHash(settings: OperatorSettings, blockNumber: bigint) {
	const currentChain = chainFor(settings)
	const observations = await Promise.all(
		[settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(async endpoint => {
			const block = await createPublicClient({ chain: currentChain, transport: http(endpoint) }).getBlock({ blockNumber })
			if (block.hash === undefined) throw new Error('Canonical block is missing its hash')
			return { endpoint, value: block.hash }
		}),
	)
	return quorumValue('market evidence canonical block', observations)
}

async function desiredPoolStatus(settings: OperatorSettings, desired: DesiredPoolSettings) {
	const currentChain = chainFor(settings)
	const observations = await Promise.all(
		[settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls].map(async endpoint => {
			const client = createPublicClient({ chain: currentChain, transport: http(endpoint) })
			const originId = await client.readContract({
				abi: securityPoolFactoryAbi,
				address: settings.deployment.securityPoolFactory,
				args: [desired.universeId, desired.questionId, desired.statoblastSecurityMultiplierBps, desired.initialReportPriorityFeeAttoEthPerGas],
				functionName: 'getOriginId',
			})
			return {
				endpoint,
				value: getAddress(
					await client.readContract({
						abi: securityPoolFactoryAbi,
						address: settings.deployment.securityPoolFactory,
						args: [originId, desired.universeId],
						functionName: 'getSecurityPool',
					}),
				),
			}
		}),
	)
	const address = quorumValue('desired origin security pool', observations)
	return { address, desired }
}

function selectedCandidate(pools: readonly PoolObservation[], settings: OperatorSettings, allowed: (pool: PoolObservation) => boolean) {
	const candidates = pools.flatMap(pool => pool.candidates)
	const candidate = selectAllowedCandidate(candidates, settings.strategy.candidatePriority, candidate => {
		const pool = pools.find(pool => pool.address.toLowerCase() === candidate.pool.address.toLowerCase())
		return pool !== undefined && allowed(pool)
	})
	if (candidate === undefined) return undefined
	const pool = pools.find(pool => pool.address.toLowerCase() === candidate.pool.address.toLowerCase())
	if (pool === undefined) throw new Error('Selected candidate pool disappeared from the scan')
	return { candidate, pool }
}

function marketConfigurations(settings: OperatorSettings) {
	return [settings.centralizedMarkets, ...settings.childMarketConfigurations]
}

function marketConfigurationForPool(pool: PoolObservation, settings: OperatorSettings) {
	return marketConfigurations(settings).find(configuration => configuration.assetAddress.toLowerCase() === pool.repToken.toLowerCase())
}

function marketPriceAllowsExecution(pool: PoolObservation, settings: OperatorSettings, state: ReturnType<typeof initialRuntimeState>) {
	const configuration = marketConfigurationForPool(pool, settings)
	if (configuration === undefined || !centralizedMarketConfigurationAllowsExecution(configuration)) return false
	const centralizedMarket = state.centralizedMarketsByAsset.get(pool.repToken.toLowerCase())
	const marketConsensus = state.marketConsensusByAsset.get(pool.repToken.toLowerCase())
	if (configuration.venueConsensus === undefined) return configuration.requiredForExecution ? false : centralizedPriceAllowsExecution(pool.lastPrice, centralizedMarket, configuration, pool.repToken)
	return marketConsensusAllowsExecution(
		pool.lastPrice,
		marketConsensus,
		{
			maximumDeviationBps: configuration.maximumDexDeviationBps,
			maximumObservationAgeMilliseconds: configuration.maximumObservationAgeMilliseconds,
			requiredForExecution: configuration.requiredForExecution,
		},
		pool.repToken,
		settings.network.chainId,
	)
}

async function canonicalMarketPriceAllowsExecution(pool: PoolObservation, settings: OperatorSettings, state: ReturnType<typeof initialRuntimeState>, readCanonicalHash: (blockNumber: bigint) => Promise<`0x${string}` | undefined>) {
	if (!marketPriceAllowsExecution(pool, settings, state)) return false
	const marketConsensus = state.marketConsensusByAsset.get(pool.repToken.toLowerCase())
	try {
		await requireCanonicalDexEvidence(marketConsensus, readCanonicalHash)
		return true
	} catch (error) {
		void error
		state.marketObservations = discardDexMarketObservations(state.marketObservations)
		state.marketConsensus = undefined
		state.marketConsensusByAsset.clear()
		return false
	}
}

async function recoverPendingTransactions(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, state: ReturnType<typeof initialRuntimeState>) {
	const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
	for (const intent of [...state.pendingTransactions]) {
		assertIntentSender(intent.sender, wallet.account.address)
		if (parseTransaction(intent.serializedTransaction).chainId !== BigInt(settings.network.chainId)) {
			throw new Error(`Pending transaction ${intent.hash} was signed for a different chain`)
		}
		const clients = endpoints.map(endpoint => ({ client: createPublicClient({ chain: wallet.chain, transport: http(endpoint) }), endpoint }))
		const receiptResults = await Promise.all(
			clients.map(async ({ client, endpoint }) => {
				try {
					const receipt = await client.getTransactionReceipt({ hash: intent.hash })
					return {
						endpoint,
						receipt,
						value: {
							hash: receipt.transactionHash,
							logs: receipt.logs.map(log => ({ address: log.address, data: log.data, topics: log.topics })),
							status: receipt.status,
						},
					}
				} catch (error) {
					if (error instanceof Error && error.message.includes('could not be found')) return { endpoint, receipt: undefined, value: undefined }
					throw error
				}
			}),
		)
		const receiptEvidence = quorumValue(
			`receipt ${intent.hash}`,
			receiptResults.map(({ endpoint, value }) => ({ endpoint, value })),
		)
		if (receiptEvidence !== undefined) {
			const receipt = receiptResults.find(result => result.receipt !== undefined && result.receipt.transactionHash.toLowerCase() === receiptEvidence.hash.toLowerCase())?.receipt
			if (receipt === undefined) throw new Error(`Quorum receipt ${intent.hash} was not available for semantic validation`)
			const receiptOutcome = receipt.status === 'success' ? validateReceiptExpectation(receipt, intent.receiptExpectation) : { queuedOperationId: undefined }
			if (receiptOutcome.queuedOperationId !== undefined && intent.receiptExpectation.type === 'pending-liquidation') {
				state.pendingStagedOperations.push({
					coordinator: intent.receiptExpectation.coordinator,
					operationId: receiptOutcome.queuedOperationId,
					queuedBlock: receipt.blockNumber,
					target: intent.receiptExpectation.target,
				})
			}
			resolveRecoveredIntentJournal(state, intent.hash, receiptEvidence.status)
			recordActivity(state, {
				hash: intent.hash,
				kind: intent.kind,
				message: receiptEvidence.status === 'success' ? `Recovered confirmation: ${intent.label}` : `Recovered revert: ${intent.label}`,
				status: receiptEvidence.status === 'success' ? 'confirmed' : 'failed',
			})
			await saveDurableState(settings.runtime.stateFile, state)
			requireRecoveredTransactionSuccess(receiptEvidence.status, intent.hash)
			continue
		}
		const nonce = quorumValue(`pending signer nonce for ${intent.hash}`, await Promise.all(clients.map(async ({ client, endpoint }) => ({ endpoint, value: await client.getTransactionCount({ address: intent.sender, blockTag: 'pending' }) }))))
		if (nonce > intent.nonce) {
			throw new Error(`Transaction ${intent.hash} has no receipt but signer nonce ${intent.nonce.toString()} was consumed; manual reconciliation is required`)
		}
		const blocks = await Promise.all(clients.map(async ({ client }) => await client.getBlockNumber()))
		const recoveryAction = ambiguousRecoveryAction(intent, blocks)
		if (recoveryAction === 'expire-private') {
			await canonicalBlockHash(settings, intent.maxBlockNumber + PRIVATE_INTENT_FINALITY_BLOCKS)
			state.pendingTransactions = state.pendingTransactions.filter(value => value.hash.toLowerCase() !== intent.hash.toLowerCase())
			recordActivity(state, { hash: intent.hash, kind: intent.kind, message: `Private price-dependent intent expired after canonical finality without inclusion: ${intent.label}`, status: 'failed' })
			await saveDurableState(settings.runtime.stateFile, state)
			continue
		}
		if (recoveryAction === 'retain') {
			const recovery = intent.mode === 'public' ? 'manual reconciliation or a later receipt is required' : `private validity and ${PRIVATE_INTENT_FINALITY_BLOCKS.toString()} canonical confirmation blocks must pass`
			throw new Error(`Price-dependent transaction ${intent.hash} remains ambiguous; ${recovery}`)
		}
		if (!recoveredIntentCanBeResubmitted(intent)) throw new Error(`Price-dependent transaction ${intent.hash} cannot be resubmitted without fresh market evidence`)
		if (wallet.account.signMessage === undefined) throw new Error('Execution signer cannot authenticate transaction recovery')
		await submitSignedTransaction({
			address: intent.sender,
			hash: intent.hash,
			maxBlockNumber: intent.maxBlockNumber,
			publicRpcUrls: settings.connectivity.publicRpcUrls,
			publicSubmit: sendRawTransactionToRpc,
			serializedTransaction: intent.serializedTransaction,
			settings: settings.submission,
			signMessage: wallet.account.signMessage,
		})
		return true
	}
	return false
}

async function reconcilePendingStagedOperations(settings: OperatorSettings, wallet: WalletClient<Transport, Chain, Account>, state: ReturnType<typeof initialRuntimeState>) {
	const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
	const clients = endpoints.map(endpoint => ({ client: createPublicClient({ chain: wallet.chain, transport: http(endpoint) }), endpoint }))
	for (const pending of [...state.pendingStagedOperations]) {
		const heads = await Promise.all(clients.map(async ({ client }) => await client.getBlockNumber()))
		const toBlock = heads.reduce((minimum, head) => (head < minimum ? head : minimum))
		const observations = await Promise.all(
			clients.map(async ({ client, endpoint }) => {
				const logs = await client.getLogs({ address: pending.coordinator, fromBlock: pending.queuedBlock, toBlock })
				return {
					endpoint,
					value: logs.flatMap(log => {
						const outcome = stagedOperationOutcome(log, pending.operationId)
						return outcome === undefined ? [] : [{ ...outcome, blockHash: log.blockHash, blockNumber: log.blockNumber, transactionHash: log.transactionHash }]
					}),
				}
			}),
		)
		const outcomes = quorumValue(`staged operation ${pending.operationId.toString()}`, observations)
		if (outcomes.length === 0) continue
		const outcome = outcomes[0]
		if (outcome === undefined || outcomes.length !== 1 || outcome.operation !== 0n || outcome.operationId !== pending.operationId || typeof outcome.success !== 'boolean' || typeof outcome.errorMessage !== 'string') {
			throw new Error(`Coordinator returned an invalid outcome for staged operation ${pending.operationId.toString()}`)
		}
		state.pendingStagedOperations = state.pendingStagedOperations.filter(operation => operation.coordinator.toLowerCase() !== pending.coordinator.toLowerCase() || operation.operationId !== pending.operationId)
		recordActivity(state, {
			details: `coordinator=${pending.coordinator} operation=${pending.operationId.toString()} target=${pending.target}`,
			kind: 'liquidation',
			message: outcome.success ? 'Staged liquidation settled successfully' : `Staged liquidation failed: ${outcome.errorMessage}`,
			status: outcome.success ? 'confirmed' : 'failed',
		})
		await saveDurableState(settings.runtime.stateFile, state)
		if (!outcome.success) throw new Error(`Staged liquidation ${pending.operationId.toString()} failed: ${outcome.errorMessage}`)
	}
}

async function main() {
	if (process.argv.length > 2) {
		throw new Error('The liquidator accepts no command-line arguments; use its operator file or dashboard')
	}
	let loaded = await loadSettings()
	let settings = loaded.settings
	let settingsRevision = loaded.revision
	let activePrivateKey = settings.privateKey
	let executionAccount: Account | undefined
	if (settings.runtime.execute) {
		if (activePrivateKey === undefined) throw new Error('Live execution requires a configured signer')
		executionAccount = privateKeyToAccount(activePrivateKey)
	}
	using shutdown = createLiquidatorShutdownController()
	const acquiredExecutionLocks = await acquireLiquidatorExecutionLocksForShutdown(settings.runtime.stateFile, settings.network.chainId, executionAccount?.address, shutdown)
	if (acquiredExecutionLocks === undefined) return
	await using executionLocks = acquiredExecutionLocks
	let settingsQueue = Promise.resolve()
	const chain = chainFor(settings)
	let client = createPublicClient({
		chain,
		transport: http(settings.connectivity.readRpcUrl),
	})
	let wallet =
		activePrivateKey === undefined
			? undefined
			: createWalletClient({
					account: privateKeyToAccount(activePrivateKey),
					chain,
					transport: http(settings.connectivity.readRpcUrl),
				})
	const state = initialRuntimeState(settings.paused, wallet?.account.address)
	const durable = await loadDurableState(settings.runtime.stateFile)
	state.activities = durable.activities
	state.lastScannedBlock = durable.lastScannedBlock === undefined ? undefined : BigInt(durable.lastScannedBlock)
	state.pendingStagedOperations = durable.pendingStagedOperations
	state.pendingTransactions = durable.pendingTransactions
	const persistSettings = async (update: (current: OperatorSettings) => OperatorSettings) => {
		let result: Promise<void> = Promise.resolve()
		settingsQueue = settingsQueue.then(async () => {
			const next = update(settings)
			settingsRevision = await saveSettings(loaded.path, next, settingsRevision)
			settings = next
		})
		result = settingsQueue
		await result
	}
	const configurationMutationGate = createConfigurationMutationGate(() => state.scanning)
	const observeConfiguredDex = async (configuration: ReturnType<typeof marketConfigurations>[number], block: { hash: `0x${string}`; number: bigint; timestamp: bigint }) =>
		observeConstantProductMarkets(configuration, getAddress(configuration.assetAddress), settings.deployment.weth, async pair => {
			const [token0, token1, reserves] = await Promise.all([
				readContractAtBlock(client.transport, { abi: constantProductPairAbi, address: pair, functionName: 'token0' }, block.number),
				readContractAtBlock(client.transport, { abi: constantProductPairAbi, address: pair, functionName: 'token1' }, block.number),
				readContractAtBlock(client.transport, { abi: constantProductPairAbi, address: pair, functionName: 'getReserves' }, block.number),
			])
			if (!Array.isArray(reserves) || typeof reserves[0] !== 'bigint' || typeof reserves[1] !== 'bigint' || typeof token0 !== 'string' || typeof token1 !== 'string') throw new Error('Constant-product pair returned malformed state')
			return { blockHash: block.hash, blockNumber: block.number, blockTimestamp: block.timestamp, chainId: settings.network.chainId, reserve0: reserves[0], reserve1: reserves[1], token0: getAddress(token0), token1: getAddress(token1) }
		})
	const dashboard = settings.runtime.ui
		? startDashboardServer(settings.runtime.uiPort, {
				getConfiguration: () => serializedSettings(settings, true),
				getState: () => operatorSnapshot(state, settings.runtime.execute, marketConfigurations(settings)),
				hostname: settings.runtime.uiHost,
				reconcileTransaction: value =>
					configurationMutationGate.run(async () => {
						if (!state.paused) throw new Error('Pause the bot before reconciling a replacement transaction')
						const request = parseTransactionReconciliation(value)
						const intent = state.pendingTransactions.find(candidate => candidate.hash.toLowerCase() === request.intentHash.toLowerCase())
						if (intent === undefined) throw new Error('Pending transaction intent was not found')
						validateReconciliationIntentChain(intent.serializedTransaction, settings.network.chainId)
						const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
						const observations = await Promise.all(
							endpoints.map(async endpoint => {
								const rpc = createPublicClient({ chain, transport: http(endpoint) })
								try {
									const [receipt, transaction] = await Promise.all([rpc.getTransactionReceipt({ hash: request.replacementHash }), rpc.getTransaction({ hash: request.replacementHash })])
									if (receipt.blockHash === null) throw new Error('Replacement receipt is missing its block hash')
									if (receipt.transactionHash.toLowerCase() !== request.replacementHash.toLowerCase() || transaction.hash.toLowerCase() !== request.replacementHash.toLowerCase()) throw new Error('Replacement RPC returned another transaction')
									return {
										endpoint,
										value: {
											blockHash: receipt.blockHash,
											blockNumber: receipt.blockNumber,
											from: transaction.from,
											hash: transaction.hash,
											nonce: transaction.nonce,
											status: receipt.status,
										},
									}
								} catch (error) {
									if (error instanceof Error && error.message.includes('could not be found')) return { endpoint, value: undefined }
									throw error
								}
							}),
						)
						const replacement = await verifyFinalizedReplacement(intent, request.replacementHash, PRIVATE_INTENT_FINALITY_BLOCKS, {
							canonicalBlockHash: async blockNumber => await canonicalBlockHash(settings, blockNumber),
							currentHeads: async () => await Promise.all(endpoints.map(async endpoint => await createPublicClient({ chain, transport: http(endpoint) }).getBlockNumber())),
							replacement: async () => quorumValue(`replacement transaction ${request.replacementHash}`, observations),
						})
						await commitReconciledIntent(settings.runtime.stateFile, state, intent.hash, {
							details: `original=${intent.hash} replacement=${replacement.hash} nonce=${intent.nonce.toString()} replacementStatus=${replacement.status}`,
							hash: replacement.hash,
							kind: 'recovery',
							message: `Finalized replacement reconciled: ${intent.label}`,
							status: 'confirmed',
						})
						return { intentHash: intent.hash, replacementHash: replacement.hash, replacementStatus: replacement.status }
					}),
				testMarketSources: () =>
					configurationMutationGate.run(async () => {
						let block: Awaited<ReturnType<typeof client.getBlock>>
						try {
							block = await client.getBlock()
						} catch (error) {
							console.error(`marketSourceTestBlock=${errorMessage(error)}`)
							throw new Error('Market source test could not read the configured network')
						}
						if (block.hash === undefined || block.number === undefined) throw new Error('Market source test block is missing canonical identity')
						const results = []
						for (const configuration of marketConfigurations(settings)) {
							const asset = getAddress(configuration.assetAddress)
							const centralized = await observeCentralizedMarkets(configuration, asset, settings.network.chainId)
							const dex = await observeConfiguredDex(configuration, { hash: block.hash, number: block.number, timestamp: block.timestamp })
							results.push({
								assetId: asset,
								sources: [
									...configuration.sources.map(source => {
										const observed = centralized?.observations.some(observation => observation.exchangeId === source.exchangeId) === true
										return {
											id: source.exchangeId,
											kind: 'cex' as const,
											market: source.repMarket,
											reason: observed ? undefined : (centralized?.reasons.find(reason => reason.startsWith(`${source.exchangeId} `)) ?? 'Observation was stale, shallow, or unavailable'),
											status: observed ? ('observed' as const) : ('failed' as const),
										}
									}),
									...(configuration.venueConsensus?.dexSources.map(source => {
										const observed = dex.observations.some(observation => observation.sourceId === source.sourceId)
										return { id: source.sourceId, kind: 'dex' as const, market: source.pair, reason: observed ? undefined : (dex.reasons.find(reason => reason.startsWith(`${source.sourceId} `)) ?? 'Observation unavailable'), status: observed ? ('observed' as const) : ('failed' as const) }
									}) ?? []),
								],
							})
						}
						recordActivity(state, { details: `${results.reduce((total, result) => total + result.sources.filter(source => source.status === 'observed').length, 0).toString()} source(s) responded`, kind: 'configuration', message: 'Read-only market source test completed', status: 'info' })
						await saveDurableState(settings.runtime.stateFile, state)
						return { assets: results, blockNumber: block.number.toString(), observedAt: new Date().toISOString() }
					}),
				setPaused: async value => {
					if (typeof value !== 'object' || value === null || Array.isArray(value)) {
						throw new Error('Pause request must be an object')
					}
					const paused = Reflect.get(value, 'paused')
					if (typeof paused !== 'boolean') throw new Error('paused must be a boolean')
					if (paused) {
						state.paused = true
						await persistSettings(current => ({ ...current, paused: true }))
					} else {
						await configurationMutationGate.run(async () => {
							await persistSettings(current => ({ ...current, paused: false }))
							state.paused = false
						})
					}
					recordActivity(state, {
						kind: 'configuration',
						message: paused ? 'Operator paused' : 'Operator resumed',
						status: 'info',
					})
					return { paused }
				},
				setApprovedUniverses: value =>
					configurationMutationGate.run(async () => {
						if (!Array.isArray(value) || value.some(universe => typeof universe !== 'string' || !/^(?:0|[1-9]\d*)$/.test(universe))) {
							throw new Error('Approved universes must be an array of non-negative integer strings')
						}
						const approvedUniverses = [...new Set(value.map(universe => BigInt(String(universe))))]
						if (approvedUniverses.some(universe => universe >= 2n ** 248n)) throw new Error('Approved universe must fit in uint248')
						validateApprovedUniverseSelection(state.universes, approvedUniverses)
						await persistSettings(current => ({ ...current, approvedUniverses }))
						for (const universe of state.universes) universe.approved = approvedUniverses.includes(universe.id)
						for (const pool of state.pools) pool.approvedUniverse = approvedUniverses.includes(pool.universeId)
						recordActivity(state, {
							details: approvedUniverses.map(universe => universe.toString()).join(', '),
							kind: 'configuration',
							message: 'Truthful universe selection saved',
							status: 'info',
						})
						return serializedSettings(settings, true)
					}),
				setMarketConfiguration: value =>
					configurationMutationGate.run(async () => {
						if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Market configuration must be an object')
						const rootValue = Reflect.get(value, 'root')
						const childrenValue = Reflect.get(value, 'children')
						const desiredPools = parseDesiredPools(
							Reflect.get(value, 'desiredPools') ??
								settings.desiredPools.map(pool => ({
									initialReportPriorityFeeAttoEthPerGas: pool.initialReportPriorityFeeAttoEthPerGas.toString(),
									questionId: pool.questionId.toString(),
									statoblastSecurityMultiplierBps: pool.statoblastSecurityMultiplierBps.toString(),
									universeId: pool.universeId.toString(),
								})),
						)
						const centralizedMarkets = parseCentralizedMarketSettings(rootValue ?? value)
						if (childrenValue !== undefined && !Array.isArray(childrenValue)) throw new Error('Market configuration children must be an array')
						const childMarketConfigurations = (childrenValue ?? []).map(parseCentralizedMarketSettings)
						if (centralizedMarkets.assetChainId !== settings.network.chainId) throw new Error('Market consensus configuration targets another chain')
						if (childMarketConfigurations.some(configuration => configuration.assetChainId !== settings.network.chainId)) throw new Error('Child market configuration targets another chain')
						const configuredAssets = [centralizedMarkets, ...childMarketConfigurations].map(configuration => configuration.assetAddress.toLowerCase())
						if (new Set(configuredAssets).size !== configuredAssets.length) throw new Error('Market configurations must target distinct REP assets')
						const rootUniverse = state.universes.find(universe => universe.parentId === undefined)
						if (rootUniverse !== undefined && centralizedMarkets.assetAddress.toLowerCase() !== rootUniverse.repToken.toLowerCase()) throw new Error('Market consensus configuration targets another REP asset')
						const knownChildRep = new Set(state.universes.filter(universe => universe.parentId !== undefined).map(universe => universe.repToken.toLowerCase()))
						if (knownChildRep.size > 0 && childMarketConfigurations.some(configuration => !knownChildRep.has(configuration.assetAddress.toLowerCase()))) throw new Error('Child market configuration targets an unknown universe REP asset')
						await persistSettings(current => ({ ...current, centralizedMarkets, childMarketConfigurations, desiredPools }))
						clearMarketEvidenceForConfigurationChange(state)
						recordActivity(state, {
							details: `${(centralizedMarkets.sources.length + childMarketConfigurations.reduce((total, configuration) => total + configuration.sources.length, 0)).toString()} CEX source(s) across ${(childMarketConfigurations.length + 1).toString()} REP asset(s)`,
							kind: 'configuration',
							message: 'Market consensus configuration saved',
							status: 'info',
						})
						return serializedSettings(settings, true)
					}),
				setSelectedPools: value =>
					configurationMutationGate.run(async () => {
						if (!Array.isArray(value) || value.some(address => typeof address !== 'string')) {
							throw new Error('Selected pools must be an array of addresses')
						}
						const selectedPools = [
							...new Map(
								value.map(raw => {
									if (typeof raw !== 'string') throw new Error('Selected pools must contain addresses')
									const address = getAddress(raw)
									return [address.toLowerCase(), address] as const
								}),
							).values(),
						]
						await persistSettings(current => ({ ...current, selectedPools }))
						recordActivity(state, {
							details: selectedPools.join(', '),
							kind: 'configuration',
							message: 'Pool selection saved',
							status: 'info',
						})
						return serializedSettings(settings, true)
					}),
				setSigner: value =>
					configurationMutationGate.run(async () => {
						if (typeof value !== 'object' || value === null || Array.isArray(value)) {
							throw new Error('Signer request must be an object')
						}
						const rawPrivateKey = Reflect.get(value, 'privateKey')
						const rememberSigner = Reflect.get(value, 'rememberSigner')
						if (typeof rawPrivateKey !== 'string' || typeof rememberSigner !== 'boolean') {
							throw new Error('Signer request requires privateKey and rememberSigner')
						}
						const candidate = signerCandidate(rawPrivateKey.trim() === '' ? null : rawPrivateKey)
						const commit = () =>
							commitSignerMutation(
								candidate,
								rememberSigner,
								async signer => persistSettings(current => ({ ...current, privateKey: signer.privateKey })),
								signer => {
									activePrivateKey = signer.privateKey
									wallet =
										activePrivateKey === undefined
											? undefined
											: createWalletClient({
													account: privateKeyToAccount(activePrivateKey),
													chain,
													transport: http(settings.connectivity.readRpcUrl),
												})
									state.wallet = wallet?.account.address
								},
							)
						if (settings.runtime.execute && candidate.address !== undefined && executionLocks !== undefined) await executionLocks.withSignerReservation(candidate.address, commit)
						else await commit()
						recordActivity(state, {
							kind: 'configuration',
							message: candidate.address === undefined ? 'Active signer cleared' : `Signer ${candidate.address} activated${rememberSigner ? ' and saved' : ''}`,
							status: 'info',
						})
						return { wallet: candidate.address }
					}),
				setStrategy: value =>
					configurationMutationGate.run(async () => {
						const strategy = parseStrategy(value)
						await persistSettings(current => ({ ...current, strategy }))
						recordActivity(state, {
							kind: 'configuration',
							message: 'Liquidation strategy saved',
							status: 'info',
						})
						return serializedSettings(settings, true)
					}),
			})
		: undefined
	await using dashboardLifecycle = dashboard === undefined ? undefined : liquidatorDashboardLifecycle(dashboard)
	void dashboardLifecycle
	if (dashboard !== undefined) {
		console.log(`dashboard=${dashboard.url}`)
	}
	const actualChainId = await client.getChainId()
	if (actualChainId !== settings.network.chainId) {
		throw new Error(`Read RPC chain ${actualChainId.toString()} does not match configured chain ${settings.network.chainId.toString()}`)
	}
	await checkConnectivity(settings.connectivity, settings.network.chainId)
	for (const rpcUrl of settings.connectivity.quorumRpcUrls) {
		const chainId = await readRpcChainId(rpcUrl)
		if (chainId !== settings.network.chainId) {
			throw new Error(`${endpointLabel(rpcUrl)} returned chain ${chainId.toString()}`)
		}
	}
	recordActivity(state, {
		details: `chain=${settings.network.chainId.toString()} factory=${settings.deployment.securityPoolFactory}`,
		kind: 'scan',
		message: 'Liquidator started',
		status: 'info',
	})
	let lastDryRunKey: string | undefined
	await pollUntilStopped(
		async () => {
			if (shutdown.isRequested()) return true
			if (configurationMutationGate.isActive()) return false
			state.scanning = true
			state.error = undefined
			try {
				const currentChain = chainFor(settings)
				client = createPublicClient({
					chain: currentChain,
					transport: http(settings.connectivity.readRpcUrl),
				})
				const primary = await scanPools(client, settings, state.wallet)
				if (settings.runtime.execute) {
					const observations = [
						{
							endpoint: settings.connectivity.readRpcUrl,
							value: { pools: primary.pools, universes: primary.universes },
						},
					]
					for (const rpcUrl of settings.connectivity.quorumRpcUrls) {
						const quorumClient = createPublicClient({
							chain: currentChain,
							transport: http(rpcUrl),
						})
						const observation = await scanPools(quorumClient, settings, state.wallet)
						observations.push({
							endpoint: rpcUrl,
							value: { pools: observation.pools, universes: observation.universes },
						})
					}
					quorumValue('liquidation execution snapshot', observations)
				}
				const scannedBlock = await client.getBlock()
				if (scannedBlock.hash === undefined || scannedBlock.number === undefined) throw new Error('Latest block is missing canonical identity')
				const scannedBlockHash = scannedBlock.hash
				const scannedBlockNumber = scannedBlock.number
				const replacedMarketHead = await clearOrphanedDexEvidenceForHeadReplacement({ hash: state.lastScannedBlockHash, number: state.lastScannedBlock }, { hash: scannedBlockHash, number: scannedBlockNumber }, state, previousBlockNumber => canonicalBlockHash(settings, previousBlockNumber))
				state.lastScannedBlock = scannedBlockNumber
				state.lastScannedBlockHash = scannedBlockHash
				state.lastScannedTimestamp = scannedBlock.timestamp
				if (replacedMarketHead) {
					recordActivity(state, {
						details: `block=${scannedBlockNumber.toString()}`,
						kind: 'scan',
						message: 'DEX market evidence reset after canonical head replacement',
						status: 'info',
					})
					state.lastScanAt = new Date().toISOString()
					await saveDurableState(settings.runtime.stateFile, state)
					return shouldStopAfterSuccessfulCycle(settings.runtime.once)
				}
				state.pools = primary.pools
				state.universes = primary.universes
				state.walletRepByToken = primary.walletRepByToken
				const rootUniverse = state.universes.find(universe => universe.parentId === undefined)
				if (rootUniverse === undefined) throw new Error('Universe scan did not return the root REP asset')
				const universeRep = new Set(state.universes.map(universe => universe.repToken.toLowerCase()))
				const activeMarketConfigurations = marketConfigurations(settings).filter(configuration => universeRep.has(configuration.assetAddress.toLowerCase()))
				state.centralizedMarketsByAsset.clear()
				state.marketConsensusByAsset.clear()
				const newMarketObservations = []
				for (const configuration of activeMarketConfigurations) {
					const asset = getAddress(configuration.assetAddress)
					const centralizedMarket = await observeCentralizedMarkets(configuration, asset, settings.network.chainId)
					if (centralizedMarket !== undefined) state.centralizedMarketsByAsset.set(asset.toLowerCase(), centralizedMarket)
					newMarketObservations.push(...centralizedMarketConsensusObservations(centralizedMarket))
					const dexMarkets = await observeConfiguredDex(configuration, { hash: scannedBlockHash, number: scannedBlockNumber, timestamp: scannedBlock.timestamp })
					newMarketObservations.push(...dexMarkets.observations)
				}
				try {
					await requireCanonicalBlock(scannedBlockNumber, scannedBlockHash, async blockNumber => (await client.getBlock({ blockNumber })).hash)
				} catch (error) {
					state.marketObservations = discardDexMarketObservations(state.marketObservations)
					state.marketConsensus = undefined
					state.marketConsensusByAsset.clear()
					throw error
				}
				const observedAt = Date.now()
				const maximumMarketAge = activeMarketConfigurations.reduce((maximum, configuration) => Math.max(maximum, configuration.maximumObservationAgeMilliseconds), 0)
				state.marketObservations = [...state.marketObservations, ...newMarketObservations].filter(observation => observation.observedAt <= observedAt && observedAt - observation.observedAt <= maximumMarketAge).slice(-2_000)
				for (const configuration of activeMarketConfigurations) {
					if (configuration.venueConsensus === undefined) continue
					const assetObservations = marketObservationsForAsset(state.marketObservations, configuration.assetAddress, settings.network.chainId)
					const estimate = estimateMarketConsensus(assetObservations, marketConsensusSettings(configuration), configuration.assetAddress, settings.network.chainId, observedAt)
					state.marketConsensusByAsset.set(configuration.assetAddress.toLowerCase(), estimate)
				}
				state.centralizedMarket = state.centralizedMarketsByAsset.get(rootUniverse.repToken.toLowerCase())
				state.marketConsensus = state.marketConsensusByAsset.get(rootUniverse.repToken.toLowerCase())
				validateApprovedUniverseSelection(state.universes, settings.approvedUniverses)
				const desiredPoolStatuses = await Promise.all(settings.desiredPools.map(desired => desiredPoolStatus(settings, desired)))
				const deployedDesiredPools = desiredPoolStatuses.filter(status => status.address !== getAddress('0x0000000000000000000000000000000000000000'))
				const desiredSelections = deployedDesiredPools.filter(status => !settings.selectedPools.some(pool => pool.toLowerCase() === status.address.toLowerCase()))
				if (desiredSelections.length > 0) {
					await persistSettings(current => ({ ...current, selectedPools: [...current.selectedPools, ...desiredSelections.map(status => status.address)] }))
					for (const pool of state.pools) {
						if (desiredSelections.some(status => status.address.toLowerCase() === pool.address.toLowerCase())) pool.selected = true
					}
				}
				const inheritedSelections = inheritedChildPoolSelections(state.pools, settings.selectedPools)
				if (inheritedSelections.length > 0) {
					await persistSettings(current => ({
						...current,
						selectedPools: [...current.selectedPools, ...inheritedSelections.map(pool => pool.address)],
					}))
					for (const pool of inheritedSelections) pool.selected = true
				}
				state.lastScanAt = new Date().toISOString()
				if (state.wallet !== undefined) {
					state.walletAttoEth = await client.getBalance({ address: state.wallet })
				}
				state.status = state.paused ? 'paused' : settings.runtime.execute ? 'running' : 'dry-run'
				if (!state.paused && settings.runtime.execute) {
					if (wallet === undefined) throw new Error('Live execution requires an active signer')
					await reconcilePendingStagedOperations(settings, wallet, state)
					if (await recoverPendingTransactions(settings, wallet, state)) {
						await saveDurableState(settings.runtime.stateFile, state)
						return shouldStopAfterSuccessfulCycle(settings.runtime.once)
					}
					const missingDesiredPool = desiredPoolStatuses.find(status => status.address === getAddress('0x0000000000000000000000000000000000000000') && settings.approvedUniverses.includes(status.desired.universeId))
					if (missingDesiredPool !== undefined && settings.strategy.allowAutomaticPoolCreation) {
						await executeOriginPoolDeployment(wallet, settings, state, missingDesiredPool.desired)
						await saveDurableState(settings.runtime.stateFile, state)
						return shouldStopAfterSuccessfulCycle(settings.runtime.once)
					}
					const migration = selectVaultMigration(state.pools, state.universes, settings, scannedBlock.timestamp)
					if (migration !== undefined) {
						const childPool = migration.childPool
						if (childPool !== undefined && !settings.selectedPools.some(pool => pool.toLowerCase() === childPool.address.toLowerCase())) {
							await persistSettings(current => ({
								...current,
								selectedPools: [...current.selectedPools, childPool.address],
							}))
						}
						await executeVaultMigration(wallet, settings, state, migration)
						await saveDurableState(settings.runtime.stateFile, state)
						return shouldStopAfterSuccessfulCycle(settings.runtime.once)
					}
					for (const pool of state.pools) {
						if (await maintainVault(wallet, settings, state, pool, () => canonicalMarketPriceAllowsExecution(pool, settings, state, blockNumber => canonicalBlockHash(settings, blockNumber)))) {
							await saveDurableState(settings.runtime.stateFile, state)
							return shouldStopAfterSuccessfulCycle(settings.runtime.once)
						}
					}
					const selected = selectedCandidate(state.pools, settings, pool => settings.selectedPools.some(selectedPool => selectedPool.toLowerCase() === pool.address.toLowerCase()) && liquidationExecutionAllowed(pool.lastPrice, marketPriceAllowsExecution(pool, settings, state)))
					if (selected !== undefined) {
						const currentCandidate = evaluateCandidate(selected.candidate.pool, selected.candidate.target, selected.pool.botVault, settings.strategy)
						if (currentCandidate === undefined) return shouldStopAfterSuccessfulCycle(settings.runtime.once)
						await executeLiquidation(wallet, settings, state, selected.pool, currentCandidate, () => canonicalMarketPriceAllowsExecution(selected.pool, settings, state, blockNumber => canonicalBlockHash(settings, blockNumber)))
					}
				} else if (!state.paused) {
					const selected = selectedCandidate(state.pools, settings, pool => marketPriceAllowsExecution(pool, settings, state))
					if (selected !== undefined) {
						const dryRunKey = `${selected.pool.address}:${selected.candidate.target.address}:${selected.candidate.coverageCommitmentToTransferAttoEth.toString()}:${selected.pool.lastPrice.toString()}`
						if (dryRunKey !== lastDryRunKey) {
							dryRunCandidate(state, selected.candidate)
							lastDryRunKey = dryRunKey
						}
					}
				}
				await saveDurableState(settings.runtime.stateFile, state)
				return shouldStopAfterSuccessfulCycle(settings.runtime.once)
			} catch (error) {
				state.error = errorMessage(error)
				state.status = 'error'
				if (settings.runtime.execute) {
					state.paused = true
					await persistSettings(current => ({ ...current, paused: true })).catch(settingsError => {
						state.error = `${state.error}; failed to persist safety pause: ${errorMessage(settingsError)}`
					})
				}
				recordActivity(state, {
					details: state.error,
					kind: 'error',
					message: settings.runtime.execute ? 'Live execution paused after a failed cycle' : 'Scan cycle failed',
					status: 'failed',
				})
				await saveDurableState(settings.runtime.stateFile, state).catch(() => undefined)
				throw error
			} finally {
				state.scanning = false
			}
		},
		() => shutdown.wait(settings.runtime.pollMilliseconds),
		settings.runtime.once,
		error => console.error(`liquidator=${errorMessage(error)}`),
	)
}

main().catch(error => {
	console.error(errorMessage(error))
	process.exitCode = 1
})

#!/usr/bin/env bun

import { createPublicClient, createWalletClient, getAddress, privateKeyToAccount, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, readRpcChainId } from '@zoltar/bot-shared/monitoring/connectivity'
import { availableSettledValues, settledQuorumValue } from '@zoltar/bot-shared/monitoring/read-quorum'
import { ConnectivityDegradedError, operationalFailureDisposition, pollUntilStopped, retryDelayMilliseconds } from '@zoltar/bot-shared/monitoring/resilience'
import { availableExecutionObservations, liquidationExecutionSnapshotObservation } from '#monitoring/execution-quorum'
import { signerCandidate } from '@zoltar/bot-shared/config/signer'
import { assertSettingsProfileIsolation, loadSettings, parseDesiredPools, parseStrategy, saveSettings, serializedSettings, switchSettingsNetworkProfile, type OperatorSettings } from '#config/settings'
import { startDashboardServer } from '#dashboard/dashboard-server'
import { dryRunCandidate, executeLiquidation, executeOriginPoolDeployment, executeVaultMigration, maintainVault, TransactionAwaitingCanonicalFinality } from '#execution/liquidation-executor'
import { createPoolMonitorIndex, scanPools } from '#monitoring/pool-monitor'
import { assertIntentSender, clearMarketEvidenceForConfigurationChange, commitReconciledIntent, initialRuntimeState, loadDurableState, operatorSnapshot, recordActivity, saveDurableState } from '#state/operator-state'
import { evaluateCandidate, liquidationExecutionAllowed } from '#core/strategy'
import { PRIVATE_INTENT_FINALITY_BLOCKS, recoveryWorkBlocksExecution, shouldStopAfterSuccessfulCycle } from '#core/cycle-control'
import { inheritedChildPoolSelections, selectVaultMigration, validateApprovedUniverseSelection } from '#core/fork-migration'
import { createConfigurationMutationGate } from '#core/configuration-gate'
import { commitSignerMutation } from '#core/signer-mutation'
import { parseTransactionReconciliation, validateReconciliationIntentChain, verifyFinalizedReplacement } from '#core/transaction-reconciliation'
import { acquireLiquidatorProcessLocks, acquireLiquidatorProcessLocksForShutdown, createLiquidatorShutdownController, liquidatorDashboardLifecycle, LiquidatorProcessLockAcquisitionError, type LiquidatorProcessLocks, type LiquidatorShutdownController } from '#core/process-locks'
import { createSettingsUpdateQueue } from '#core/settings-update-queue'
import { updateNetworkConnectivity } from '#core/network-connectivity'
import { centralizedMarketConsensusObservations, marketConsensusSettings, observeCentralizedMarkets, parseCentralizedMarketSettings } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { observeConstantProductMarkets, readConstantProductPairWithQuorum, requireCurrentConstantProductMarketEvidence } from '@zoltar/bot-shared/monitoring/constant-product-markets'
import { clearOrphanedDexEvidenceForHeadReplacement, discardDexMarketObservations, estimateMarketConsensus, marketObservationsForAsset, requireCanonicalBlock } from '@zoltar/bot-shared/monitoring/market-consensus'
import { canonicalBlockHash, chainFor, desiredPoolStatus } from '#monitoring/operator-chain'
import { canonicalMarketPriceAllowsExecution, marketConfigurations, marketPriceAllowsExecution, selectedCandidate } from '#core/candidate-selection'
import { reconcilePendingStagedOperations, recoverPendingTransactions } from '#execution/recovery'
import { createSystemDeploymentGate } from '#core/deployment-gate'

const constantProductPairAbi = [
	{ inputs: [], name: 'token0', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
	{ inputs: [], name: 'token1', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
	{ inputs: [], name: 'getReserves', outputs: [{ type: 'uint112' }, { type: 'uint112' }, { type: 'uint32' }], stateMutability: 'view', type: 'function' },
] as const

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

async function preflightNetworkProfile(target: OperatorSettings) {
	if (target.networkConfigured) {
		await checkConnectivity(target.connectivity, target.network.chainId)
		for (const rpcUrl of target.connectivity.quorumRpcUrls) {
			const chainId = await readRpcChainId(rpcUrl)
			if (chainId !== target.network.chainId) throw new Error(`${endpointLabel(rpcUrl)} returned chain ${chainId.toString()}`)
		}
		await checkSubmissionEndpoints(target.submission, target.network.chainId)
	}
	const locks = await acquireLiquidatorProcessLocks({
		chainId: target.network.chainId,
		execute: target.runtime.execute,
		privateKey: target.privateKey,
		stateFile: target.runtime.stateFile,
	})
	try {
		const durable = await loadDurableState(target.runtime.stateFile, target.network.chainId)
		const configuredSigner = target.privateKey === undefined ? undefined : privateKeyToAccount(target.privateKey).address
		for (const intent of durable.pendingTransactions) {
			validateReconciliationIntentChain(intent.serializedTransaction, target.network.chainId)
			if (configuredSigner !== undefined) assertIntentSender(intent.sender, configuredSigner)
		}
	} finally {
		await locks.release()
	}
}

async function runOperator(loaded: Awaited<ReturnType<typeof loadSettings>>, processLocks: LiquidatorProcessLocks, shutdown: LiquidatorShutdownController) {
	let settings = loaded.settings
	let settingsRevision = loaded.revision
	let activePrivateKey = settings.privateKey
	const queueSettingsUpdate = createSettingsUpdateQueue()
	let chain = chainFor(settings)
	let readPool = createRpcEndpointPool([settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls])
	const createPrimaryClient = () => createPublicClient({ chain, transport: readPool.transport })
	let client = createPrimaryClient()
	let wallet =
		activePrivateKey === undefined
			? undefined
			: createWalletClient({
					account: privateKeyToAccount(activePrivateKey),
					chain,
					transport: readPool.transport,
				})
	const state = initialRuntimeState(settings.paused, wallet?.account.address, settings.network.chainId)
	let poolMonitorIndexes = new Map<string, ReturnType<typeof createPoolMonitorIndex>>()
	const poolMonitorIndexFor = (endpoint: string) => {
		const key = `${settings.network.chainId.toString()}:${settings.deployment.securityPoolFactory.toLowerCase()}:${endpoint}`
		const existing = poolMonitorIndexes.get(key)
		if (existing !== undefined) return existing
		const created = createPoolMonitorIndex()
		poolMonitorIndexes.set(key, created)
		return created
	}
	const durable = await loadDurableState(settings.runtime.stateFile, settings.network.chainId)
	state.activities = durable.activities
	state.lastScannedBlock = durable.lastScannedBlock === undefined ? undefined : BigInt(durable.lastScannedBlock)
	state.pendingStagedOperations = durable.pendingStagedOperations
	state.pendingTransactions = durable.pendingTransactions
	const persistSettings = async (update: (current: OperatorSettings) => OperatorSettings) => {
		return await queueSettingsUpdate(async () => {
			const next = update(settings)
			settingsRevision = await saveSettings(loaded.path, next, settingsRevision)
			settings = next
			return next
		})
	}
	let profileSwitchRequested = false
	const configurationMutationGate = createConfigurationMutationGate(
		() => state.scanning,
		() => profileSwitchRequested,
	)
	let wakeProfileSwitchWait: (() => void) | undefined
	const requestProfileSwitch = () => {
		profileSwitchRequested = true
		wakeProfileSwitchWait?.()
	}
	const waitForProfileSwitchOrDelay = async (milliseconds: number) => {
		if (profileSwitchRequested) return
		await Promise.race([
			shutdown.wait(milliseconds),
			new Promise<void>(resolve => {
				wakeProfileSwitchWait = resolve
				if (profileSwitchRequested) resolve()
			}),
		])
		wakeProfileSwitchWait = undefined
	}
	const readConfiguredDexPair = async (pair: Address, block: Readonly<{ hash: Hash; number: bigint }>) =>
		readConstantProductPairWithQuorum({
			block,
			chainId: settings.network.chainId,
			endpoints: [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls],
			pair,
			readBlock: async (endpoint, blockNumber) => {
				const pairClient = createPublicClient({ chain, transport: readPool.transportFor(endpoint) })
				const endpointBlock = await pairClient.getBlock({ blockNumber })
				return { hash: endpointBlock.hash, number: endpointBlock.number, timestamp: endpointBlock.timestamp }
			},
			readPairAtBlock: async (endpoint, quorumPair, blockHash) => {
				const pairClient = createPublicClient({ chain, transport: readPool.transportFor(endpoint) })
				const [token0, token1, reserves] = await Promise.all([
					pairClient.readContract({ abi: constantProductPairAbi, address: quorumPair, blockHash, functionName: 'token0' }),
					pairClient.readContract({ abi: constantProductPairAbi, address: quorumPair, blockHash, functionName: 'token1' }),
					pairClient.readContract({ abi: constantProductPairAbi, address: quorumPair, blockHash, functionName: 'getReserves' }),
				])
				return { reserve0: reserves[0], reserve1: reserves[1], token0, token1 }
			},
			requirement: settings.connectivity.rpcQuorum,
		})
	const observeConfiguredDex = async (configuration: ReturnType<typeof marketConfigurations>[number], block: { hash: Hash; number: bigint; timestamp: bigint }) =>
		observeConstantProductMarkets(configuration, getAddress(configuration.assetAddress), settings.deployment.weth, async pair => readConfiguredDexPair(getAddress(pair), block))
	const requireCurrentDexEvidence = async (configuration: ReturnType<typeof marketConfigurations>[number], estimate: Parameters<typeof requireCurrentConstantProductMarketEvidence>[3]) =>
		requireCurrentConstantProductMarketEvidence(configuration, getAddress(configuration.assetAddress), settings.deployment.weth, estimate, readConfiguredDexPair)
	const dashboard = settings.runtime.ui
		? startDashboardServer(settings.runtime.uiPort, {
				getConfiguration: () => serializedSettings(settings, true),
				getState: () => {
					state.rpcEndpointHealth = readPool.snapshot()
					return { ...operatorSnapshot(state, settings.runtime.execute, marketConfigurations(settings)), network: settings.network.name }
				},
				hostname: settings.runtime.uiHost,
				isNetworkConfigured: () => settings.networkConfigured,
				loopbackPublished: process.env['ZOLTAR_BOT_DASHBOARD_LOOPBACK_PUBLISHED'] === 'true',
				password: process.env['ZOLTAR_BOT_DASHBOARD_PASSWORD'],
				switchNetworkProfile: value =>
					configurationMutationGate.run(async () => {
						if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Chain profile request must be an object')
						const network = Reflect.get(value, 'network')
						if (network !== 'mainnet' && network !== 'sepolia') throw new Error('Chain profile must be mainnet or sepolia')
						if (network === settings.network.name) return serializedSettings(settings, true)
						const switched = await switchSettingsNetworkProfile(loaded.path, network, new URL('../../config/operator.example.json', import.meta.url).pathname, preflightNetworkProfile)
						state.paused = true
						requestProfileSwitch()
						return serializedSettings(switched.settings, true)
					}),
				reconcileTransaction: value =>
					configurationMutationGate.run(async () => {
						if (!state.paused) throw new Error('Pause the bot before reconciling a replacement transaction')
						const request = parseTransactionReconciliation(value)
						const intent = state.pendingTransactions.find(candidate => candidate.hash.toLowerCase() === request.intentHash.toLowerCase())
						if (intent === undefined) throw new Error('Pending transaction intent was not found')
						validateReconciliationIntentChain(intent.serializedTransaction, settings.network.chainId)
						const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
						const replacementEvidence = await settledQuorumValue(
							`replacement transaction ${request.replacementHash}`,
							endpoints.map(async endpoint => {
								const rpc = createPublicClient({ chain, transport: readPool.transportFor(endpoint) })
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
							settings.connectivity.rpcQuorum,
						)
						const replacement = await verifyFinalizedReplacement(intent, request.replacementHash, PRIVATE_INTENT_FINALITY_BLOCKS, {
							canonicalBlockHash: async blockNumber => await canonicalBlockHash(settings, blockNumber, readPool),
							currentHeads: async () => {
								const settled = await Promise.allSettled(endpoints.map(async endpoint => await createPublicClient({ chain, transport: readPool.transportFor(endpoint) }).getBlockNumber()))
								const heads = availableSettledValues(settled)
								if (heads.length < settings.connectivity.rpcQuorum) throw new ConnectivityDegradedError('Replacement reconciliation does not satisfy the configured RPC quorum requirement')
								return heads
							},
							replacement: async () => replacementEvidence,
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
					if (!paused && !settings.networkConfigured) throw new Error('Configure the chain and RPC endpoints before resuming')
					if (paused) {
						state.paused = true
						await configurationMutationGate.run(async () => persistSettings(current => ({ ...current, paused: true })))
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
				setNetworkConnectivity: value =>
					configurationMutationGate.run(async () => {
						const next = await updateNetworkConnectivity({
							apply: applied => {
								chain = chainFor(applied)
								readPool = createRpcEndpointPool([applied.connectivity.readRpcUrl, ...applied.connectivity.quorumRpcUrls])
								poolMonitorIndexes = new Map()
								client = createPrimaryClient()
								wallet = activePrivateKey === undefined ? undefined : createWalletClient({ account: privateKeyToAccount(activePrivateKey), chain, transport: readPool.transport })
								clearMarketEvidenceForConfigurationChange(state)
							},
							persist: persistSettings,
							settings,
							value,
						})
						recordActivity(state, { details: `chain=${next.network.chainId.toString()} readRpc=${endpointLabel(next.connectivity.readRpcUrl)}`, kind: 'configuration', message: 'Chain and RPC configuration saved', status: 'info' })
						return serializedSettings(next, true)
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
						const nextSignerLock = await processLocks.acquireSigner(candidate.address)
						try {
							await commitSignerMutation(
								candidate,
								rememberSigner,
								async signer => {
									await persistSettings(current => ({ ...current, privateKey: signer.privateKey }))
								},
								signer => {
									activePrivateKey = signer.privateKey
									wallet =
										activePrivateKey === undefined
											? undefined
											: createWalletClient({
													account: privateKeyToAccount(activePrivateKey),
													chain,
													transport: readPool.transport,
												})
									state.wallet = wallet?.account.address
								},
							)
						} catch (error) {
							try {
								await processLocks.discardSigner(candidate.address, nextSignerLock)
							} catch (cleanupError) {
								throw new AggregateError([error, cleanupError], 'Signer update failed and its provisional lock could not be released')
							}
							throw error
						}
						await processLocks.commitSigner(candidate.address, nextSignerLock)
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
						if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Strategy settings must be an object')
						const logLookbackBlocks = Number(Reflect.get(value, 'logLookbackBlocks'))
						const historicalLogRecovery = Reflect.get(value, 'historicalLogRecovery')
						if (!Number.isSafeInteger(logLookbackBlocks) || logLookbackBlocks < 1 || logLookbackBlocks > 256) throw new Error('Latest log blocks must be an integer from 1 through 256')
						if (typeof historicalLogRecovery !== 'boolean') throw new Error('Historical log recovery must be enabled or disabled explicitly')
						await persistSettings(current => ({ ...current, runtime: { ...current.runtime, historicalLogRecovery, logLookbackBlocks }, strategy }))
						recordActivity(state, {
							kind: 'configuration',
							message: 'Liquidation strategy saved',
							status: 'info',
						})
						return serializedSettings(settings, true)
					}),
			})
		: undefined
	await using _dashboardLifecycle = dashboard === undefined ? undefined : liquidatorDashboardLifecycle(dashboard)
	if (dashboard !== undefined) {
		console.log(`dashboard=${dashboard.url}`)
	}
	try {
		if (!settings.networkConfigured) {
			recordActivity(state, { details: 'Set the chain and RPC endpoints in the dashboard', kind: 'configuration', message: 'Liquidator waiting for network configuration', status: 'info' })
		} else {
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
			await checkSubmissionEndpoints(settings.submission, settings.network.chainId)
		}
	} catch (error) {
		if (operationalFailureDisposition(error) === 'safety-paused') {
			dashboard?.stop()
			throw error
		}
		state.error = errorMessage(error)
		state.status = 'connectivity-degraded'
		recordActivity(state, { details: state.error, kind: 'error', message: 'Startup connectivity is degraded; retrying in the background', status: 'failed' })
	}
	recordActivity(state, {
		details: `chain=${settings.network.chainId.toString()} factory=${settings.deployment.securityPoolFactory}`,
		kind: 'scan',
		message: 'Liquidator started',
		status: 'info',
	})
	let lastDryRunKey: string | undefined
	let missingDeploymentAddress: string | undefined
	const checkSystemDeployment = createSystemDeploymentGate()
	await pollUntilStopped(
		async () => {
			if (shutdown.isRequested()) return true
			if (profileSwitchRequested) return true
			if (configurationMutationGate.isActive()) return false
			if (!settings.networkConfigured) return false
			state.scanning = true
			state.error = undefined
			try {
				const currentChain = chainFor(settings)
				chain = currentChain
				client = createPrimaryClient()
				const deploymentStatus = await checkSystemDeployment(client, settings.network.chainId, settings.deployment)
				if (!deploymentStatus.deployed) {
					state.status = state.paused ? 'paused' : 'starting'
					if (missingDeploymentAddress !== deploymentStatus.address) {
						recordActivity(state, {
							details: `chain=${settings.network.chainId.toString()} contract=${deploymentStatus.address}`,
							kind: 'deployment',
							message: `${deploymentStatus.name} is not deployed; waiting before checking again`,
							status: 'info',
						})
						missingDeploymentAddress = deploymentStatus.address
					}
					return 'deferred'
				}
				missingDeploymentAddress = undefined
				let primary
				if (settings.runtime.execute) {
					const endpoints = [settings.connectivity.readRpcUrl, ...settings.connectivity.quorumRpcUrls]
					const settled = await Promise.allSettled(
						endpoints.map(async endpoint => {
							const endpointClient = createPublicClient({ chain: currentChain, transport: readPool.transportFor(endpoint) })
							return { client: endpointClient, endpoint, scan: await scanPools(endpointClient, settings, state.wallet, poolMonitorIndexFor(endpoint)) }
						}),
					)
					const available = availableExecutionObservations('liquidation execution snapshot', settled, liquidationExecutionSnapshotObservation, settings.connectivity.rpcQuorum)
					const selected = available[0]
					if (selected === undefined) throw new Error('Liquidation execution snapshot is unavailable')
					client = selected.client
					primary = selected.scan
				} else {
					primary = await scanPools(client, settings, state.wallet, poolMonitorIndexFor(settings.connectivity.readRpcUrl))
				}
				const scannedBlock = primary.block
				const scannedBlockHash = scannedBlock.hash
				const scannedBlockNumber = scannedBlock.number
				const replacedMarketHead = await clearOrphanedDexEvidenceForHeadReplacement({ hash: state.lastScannedBlockHash, number: state.lastScannedBlock }, { hash: scannedBlockHash, number: scannedBlockNumber }, state, previousBlockNumber => canonicalBlockHash(settings, previousBlockNumber, readPool))
				state.lastScannedBlock = scannedBlockNumber
				state.lastScannedBlockHash = scannedBlockHash
				state.lastScannedTimestamp = scannedBlock.timestamp
				console.log(`observedBlock=${scannedBlockNumber.toString()} blockAgeSeconds=${(BigInt(Math.floor(Date.now() / 1_000)) - scannedBlock.timestamp).toString()}`)
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
					let dexMarkets: Awaited<ReturnType<typeof observeConfiguredDex>>
					try {
						dexMarkets = await observeConfiguredDex(configuration, { hash: scannedBlockHash, number: scannedBlockNumber, timestamp: scannedBlock.timestamp })
					} catch (error) {
						state.marketObservations = discardDexMarketObservations(state.marketObservations)
						state.marketConsensus = undefined
						state.marketConsensusByAsset.clear()
						throw error
					}
					newMarketObservations.push(...dexMarkets.observations)
				}
				try {
					await requireCanonicalBlock(scannedBlockNumber, scannedBlockHash, async blockNumber => await canonicalBlockHash(settings, blockNumber, readPool))
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
				const desiredPoolStatuses = await Promise.all(settings.desiredPools.map(desired => desiredPoolStatus(settings, desired, readPool)))
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
					const activeWallet = wallet
					if (
						await recoveryWorkBlocksExecution(
							state,
							() => recoverPendingTransactions(settings, activeWallet, state, readPool),
							() => reconcilePendingStagedOperations(settings, activeWallet, state, readPool),
						)
					) {
						await saveDurableState(settings.runtime.stateFile, state)
						return shouldStopAfterSuccessfulCycle(settings.runtime.once)
					}
					const missingDesiredPool = desiredPoolStatuses.find(status => status.address === getAddress('0x0000000000000000000000000000000000000000') && settings.approvedUniverses.includes(status.desired.universeId))
					if (missingDesiredPool !== undefined && settings.strategy.allowAutomaticPoolCreation) {
						await executeOriginPoolDeployment(wallet, settings, state, missingDesiredPool.desired, readPool)
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
						await executeVaultMigration(wallet, settings, state, migration, readPool)
						await saveDurableState(settings.runtime.stateFile, state)
						return shouldStopAfterSuccessfulCycle(settings.runtime.once)
					}
					for (const pool of state.pools) {
						if (await maintainVault(wallet, settings, state, readPool, pool, () => canonicalMarketPriceAllowsExecution(pool, settings, state, blockNumber => canonicalBlockHash(settings, blockNumber, readPool), requireCurrentDexEvidence))) {
							await saveDurableState(settings.runtime.stateFile, state)
							return shouldStopAfterSuccessfulCycle(settings.runtime.once)
						}
					}
					const selected = selectedCandidate(state.pools, settings, pool => settings.selectedPools.some(selectedPool => selectedPool.toLowerCase() === pool.address.toLowerCase()) && liquidationExecutionAllowed(pool.lastPrice, marketPriceAllowsExecution(pool, settings, state)))
					if (selected !== undefined) {
						const currentCandidate = evaluateCandidate(selected.candidate.pool, selected.candidate.target, selected.pool.botVault, settings.strategy)
						if (currentCandidate === undefined) return shouldStopAfterSuccessfulCycle(settings.runtime.once)
						await executeLiquidation(wallet, settings, state, readPool, selected.pool, currentCandidate, () => canonicalMarketPriceAllowsExecution(selected.pool, settings, state, blockNumber => canonicalBlockHash(settings, blockNumber, readPool), requireCurrentDexEvidence))
					}
				} else if (!state.paused) {
					const selected = selectedCandidate(state.pools, settings, pool => marketPriceAllowsExecution(pool, settings, state))
					if (selected !== undefined) {
						const dryRunKey = `${selected.pool.address}:${selected.candidate.target.address}:${selected.candidate.requestedDebtAttoEth.toString()}:${selected.pool.lastPrice.toString()}`
						if (dryRunKey !== lastDryRunKey) {
							dryRunCandidate(state, selected.candidate)
							lastDryRunKey = dryRunKey
						}
					}
				}
				await saveDurableState(settings.runtime.stateFile, state)
				return shouldStopAfterSuccessfulCycle(settings.runtime.once)
			} catch (error) {
				if (error instanceof TransactionAwaitingCanonicalFinality) {
					state.status = 'running'
					await saveDurableState(settings.runtime.stateFile, state)
					return shouldStopAfterSuccessfulCycle(settings.runtime.once)
				}
				state.error = errorMessage(error)
				const disposition = operationalFailureDisposition(error)
				state.status = disposition === 'connectivity-degraded' ? 'connectivity-degraded' : 'error'
				if (settings.runtime.execute && disposition === 'safety-paused') {
					state.paused = true
					await persistSettings(current => ({ ...current, paused: true })).catch(settingsError => {
						state.error = `${state.error}; failed to persist safety pause: ${errorMessage(settingsError)}`
					})
				}
				recordActivity(state, {
					details: state.error,
					kind: 'error',
					message: disposition === 'connectivity-degraded' ? 'RPC connectivity degraded; execution remains blocked until recovery' : settings.runtime.execute ? 'Live execution paused after a safety fault' : 'Scan cycle failed',
					status: 'failed',
				})
				await saveDurableState(settings.runtime.stateFile, state).catch(() => undefined)
				throw error
			} finally {
				state.scanning = false
			}
		},
		consecutiveFailures => waitForProfileSwitchOrDelay(retryDelayMilliseconds(settings.runtime.pollMilliseconds, consecutiveFailures)),
		settings.runtime.once,
		error => console.error(`liquidator=${errorMessage(error)}`),
	)
	return profileSwitchRequested
}

async function main() {
	if (process.argv.length > 2) throw new Error('The liquidator accepts no command-line arguments; use its operator file or dashboard')
	using shutdown = createLiquidatorShutdownController()
	for (;;) {
		const loaded = await loadSettings()
		await assertSettingsProfileIsolation(loaded.path, loaded.settings)
		let locks: LiquidatorProcessLocks
		try {
			const acquired = await acquireLiquidatorProcessLocksForShutdown(
				{
					chainId: loaded.settings.network.chainId,
					execute: loaded.settings.runtime.execute,
					privateKey: loaded.settings.privateKey,
					stateFile: loaded.settings.runtime.stateFile,
				},
				shutdown,
			)
			if (acquired === undefined) return
			locks = acquired
		} catch (error) {
			if (error instanceof LiquidatorProcessLockAcquisitionError) {
				await error.releaseProcessLocks()
				throw error.acquisitionCause
			}
			throw error
		}
		try {
			if (!(await runOperator(loaded, locks, shutdown))) return
		} finally {
			await locks.release()
		}
	}
}

if (import.meta.main) {
	main().catch(error => {
		console.error(errorMessage(error))
		process.exitCode = 1
	})
}

import { bigintToSafeNumber, createContextualPublicClient, createWalletClient, privateKeyToAccount, type Address, type Chain, type PublicClient, type TransactionLog, type Transport, zeroAddress } from '#ethereum'
import { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC, OPEN_ORACLE_REPORT_SUBMITTED_TOPIC } from '@zoltar/shared/openOracle'
import { constantProductPairAbi } from '#contracts/abi'
import { advanceCursorAfterSuccessfulHead, cursorForHeadScan, fetchLogsWithAdaptiveRanges, finalityAnchorRequiresReset, initialCursor, latestLogRange, newestFirstScanRanges, operatorStatusAfterPause, withFinalityAnchor, type SyncCursor } from '#monitoring/block-sync'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel } from '#monitoring/connectivity'
import type { Configuration } from '#config/configuration'
import type { DeploymentSettings } from '#config/deployment-settings'
import { createSignerOperationGate } from '#execution/signer-operation-gate'
import { canonicalBlockHashWithQuorum, executionFailureDecision, executionTokenAllowed, selectBestExecution } from '#execution/execution-orchestration'
import { appendExecutionHistoryIfMissing, clearPollFailureMetadata, decimalSignedEth, ensureExecutionHistoryWritable, gameCapitalSnapshot, loadExecutionHistory, recordOperation, type OperatorState, type OpportunitySnapshot } from '#state/operator-state'
import { applyCoordinatorReports, applyLogs, compareLogs, logBlockNumber, reportId, type ActiveReport } from '#monitoring/oracle-log-state'
import { appendPriceHistory, createTokenCatalogTracker, discoverAugurRepTokens, loadPriceHistory, loadTokenMarkets, missingPricePoints, pricePoints } from '#monitoring/market-monitor'
import { centralizedMarketConfigurationAllowsExecution, centralizedMarketConsensusObservations, centralizedPriceAllowsExecution, centralizedPriceDeviationBps, marketConsensusSettings, observeCentralizedMarkets } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { clearOrphanedDexEvidenceForHeadReplacement, discardDexMarketObservations, estimateMarketConsensus, marketConsensusAllowsExecution, marketConsensusDeviationBps, requireCanonicalBlock, requireCanonicalDexEvidence, type MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import { observeConstantProductMarkets, readConstantProductPairWithQuorum } from '@zoltar/bot-shared/monitoring/constant-product-markets'
import { archivedUtcDayGasSpentWeth, loadPositionJournalState, savePositionJournalState, type ExclusiveProcessLock, type PositionRecord } from '#state/position-store'
import { availableSettledValues, quorumValue, settledQuorumValue } from '#monitoring/read-quorum'
import { ConnectivityDegradedError, operationalFailureDisposition, pollUntilStopped, retryDelayMilliseconds } from '#monitoring/resilience'
import { rpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'
import { positionConsumesRisk } from '#core/safety-controls'
import type { NetworkConfiguration } from '#config/network'
import { transactionLogLevel, type TrackTransaction } from '#execution/transaction-tracker'
import type { ExecutionCandidate } from '#core/operator-types'
import { errorMessage } from '#core/rpc-validation'
import { candidateRiskMismatch, poolsForToken } from '#monitoring/opportunity-evaluation'
import { dateFromBlockTimestamp, pendingCoordinatorReports, pendingCoordinatorReportsWithQuorum } from '#execution/recovery-support'
import { reconcileExpiredAttemptsWithQuorum, processPositionLifecycle } from '#execution/position-lifecycle'
import type { ExecutionLockManager } from '#execution/execution-locks'
import { loadCoordinatorPolicies, loadCoordinatorPoliciesWithQuorum, authenticatedExecutionToken, authenticateConfiguredDeployments, retainReportsAndLogs } from '#config/runtime-deployment'
import { executeDispute, loadBalances } from '#execution/dispute-execution'
import { inspectReport } from '#monitoring/report-inspection'
import { acquireScanSignerOperation, deploymentUpdateMustWait, startOperatorControlPlane } from './operator-control-plane.ts'
import { executorDeploymentIntentPath, loadExecutorDeploymentIntentForChain } from '#execution/executor-deployment-store'
import { assertStoredExecutorDeploymentIntent } from '#execution/create2-executor'
import { applyQueuedExecutionSettings, applyQueuedSigner, resetReportScanState } from './operator-execution-state.ts'

const REORG_OVERLAP_BLOCKS = 12n
const MAX_LOG_SCAN_RANGE = 256n

type SuccessfulPollState = Pick<OperatorState, 'consecutivePollFailures' | 'lastError' | 'lastPollFailureAt' | 'lastRetryAt' | 'nextRetryAt' | 'paused' | 'retryInProgress' | 'status'>

export function completeSuccessfulPoll(state: SuccessfulPollState, nextError: string | undefined, stopAfterPoll: boolean) {
	clearPollFailureMetadata(state)
	state.lastError = nextError
	state.status = operatorStatusAfterPause(state.paused, true, nextError !== undefined)
	return stopAfterPoll
}

export function completeUnconfiguredPoll(state: SuccessfulPollState) {
	const stop = completeSuccessfulPoll(state, undefined, false)
	state.status = 'paused'
	return stop
}

export async function runOperator(config: Configuration, lockManager: ExecutionLockManager | undefined, initialSignerLock: ExclusiveProcessLock | undefined) {
	if (config.lookbackBlocks < 0n || config.lookbackBlocks > MAX_LOG_SCAN_RANGE) throw new Error('lookbackBlocks must be from 0 through 256')
	if (!Number.isSafeInteger(config.uiPort) || config.uiPort < 1 || config.uiPort > 65_535) throw new Error('ui-port must be an integer from 1 to 65535')
	if (config.ui && config.once) throw new Error('runtime.ui cannot be combined with runtime.once')
	if (config.execute && config.privateKey === undefined && !config.ui) throw new Error('Execution requires a saved privateKey unless runtime.ui is enabled to unlock the signer')
	if (config.execute && lockManager === undefined) throw new Error('Execution requires exclusive journal and signer lock management')
	if (config.execute) await ensureExecutionHistoryWritable(config.historyFile)
	let positionJournal = await loadPositionJournalState(config.positionFile, config.network.chain.id)
	let positions = positionJournal.positions
	if (config.execute) positionJournal = await savePositionJournalState(config.positionFile, positionJournal, config.network.chain.id)
	let readPool = createRpcEndpointPool([config.connectivity.readRpcUrl, ...config.quorumRpcUrls])
	let clientRpcUrl: string | undefined
	let wakeProfileSwitchWait: (() => void) | undefined
	const createClient = (rpcUrl?: string) => createContextualPublicClient(config.network.chain, readPool, config.execute ? rpcUrl : undefined)
	const contextualRpcRead = async <Value>(_method: string, request: (requestClient: PublicClient<Transport, Chain>) => Promise<Value>, explicitRpcUrl: string | undefined = clientRpcUrl) => await request(createClient(explicitRpcUrl))
	const contextualLogRead = async <Value>(request: (requestClient: PublicClient<Transport, Chain>) => Promise<Value>) => await request(createContextualPublicClient(config.network.chain, readPool))
	const createWallet = () =>
		config.privateKey === undefined
			? undefined
			: createWalletClient({
					account: privateKeyToAccount(config.privateKey),
					chain: config.network.chain,
					transport: readPool.transport,
				})
	let client = createClient()
	let readClients = [createClient(config.connectivity.readRpcUrl), ...config.quorumRpcUrls.map(url => createClient(url))]
	let wallet = createWallet()
	let coordinatorPolicies: Awaited<ReturnType<typeof loadCoordinatorPolicies>> = []
	let startupValidated = !config.networkConfigured
	const executionHistory = await loadExecutionHistory(config.historyFile, config.network.chain.id)
	for (const position of positions) {
		const record = position.historyOutbox
		if (record !== undefined && !executionHistory.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) executionHistory.unshift(record)
	}
	const state: OperatorState = {
		activeReportCount: 0,
		consecutivePollFailures: 0,
		balances: undefined,
		blockNumber: undefined,
		blockTimestamp: undefined,
		centralizedMarket: undefined,
		marketConsensus: undefined,
		marketObservations: [],
		executionHistory,
		endpointChecks: [],
		rpcEndpointHealth: readPool.snapshot(),
		gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
		lastError: undefined,
		lastPollAt: undefined,
		lastPollFailureAt: undefined,
		lastRetryAt: undefined,
		nextRetryAt: undefined,
		retryInProgress: false,
		opportunities: [],
		positions,
		positionArchive: positionJournal.archived,
		operationLog: [],
		paused: config.paused,
		status: config.networkConfigured ? 'syncing' : 'paused',
		tokenAddresses: config.tokenAddresses,
		tokenMarkets: [],
		priceHistory: await loadPriceHistory(config.priceHistoryFile, config.network.chain.id),
		reportPaths: [],
		transactionActivity: [],
	}
	const fixedState: {
		deployment: DeploymentSettings
		execute: boolean
		executor: Address | undefined
		expectedChainId: number
		explorerUrl: string
		network: NetworkConfiguration['name']
		networkConfigured: boolean
		openOracle: Address
		queuedWallet: Address | null | undefined
		savedWallet: Address | undefined
		wallet: Address | undefined
	} = {
		deployment: {
			coordinatorAddresses: config.coordinatorAddresses,
			deploymentManifest: config.deploymentManifest,
			executor: config.executor,
			openOracle: config.openOracle,
			quorumRpcUrls: config.quorumRpcUrls,
			rep: config.network.rep,
			uniswapFactory: config.network.factory,
			uniswapQuoter: config.network.quoter,
			uniswapRouter: config.router,
			uniswapV2Router: config.v2Router,
			uniswapV4PoolManager: config.v4PoolManager,
			uniswapV4Quoter: config.v4Quoter,
			weth: config.network.weth,
		},
		execute: config.execute,
		executor: config.executor,
		expectedChainId: config.network.chain.id,
		explorerUrl: config.network.explorerUrl,
		network: config.network.name,
		networkConfigured: config.networkConfigured,
		openOracle: config.openOracle,
		queuedWallet: undefined,
		savedWallet: config.persistedPrivateKey === undefined ? undefined : privateKeyToAccount(config.persistedPrivateKey).address,
		wallet: wallet?.account.address,
	}
	let activeSignerLock = initialSignerLock
	const signerOperationGate = createSignerOperationGate()
	let cursor: SyncCursor | undefined
	const executorIntentPath = executorDeploymentIntentPath(config.settingsFile, config.network.name)
	const pendingExecutorDeployment = await loadExecutorDeploymentIntentForChain(executorIntentPath, config.network.chain.id)
	if (pendingExecutorDeployment !== undefined) await assertStoredExecutorDeploymentIntent(pendingExecutorDeployment, config.network.chain.id)
	const deploymentRecovery = {
		pending: pendingExecutorDeployment !== undefined,
	}
	if (pendingExecutorDeployment !== undefined) {
		state.paused = true
		state.status = 'paused'
		recordOperation(state, {
			category: 'configuration',
			details: pendingExecutorDeployment.transactionHash,
			level: 'error',
			message: 'Execution paused for pending executor deployment recovery',
			reason: 'Retry the executor deployment to reconcile its durable signed transaction before resuming',
			reportId: undefined,
		})
	}
	const trackTransaction: TrackTransaction = activity => {
		state.transactionActivity = [activity, ...state.transactionActivity.filter(existing => existing.originalHash.toLowerCase() !== activity.originalHash.toLowerCase())].slice(0, 100)
		recordOperation(state, {
			category: 'transaction',
			details: activity.failedTargets.map(target => `${target.target}: ${target.error ?? 'failed'}`).join('; ') || undefined,
			level: transactionLogLevel(activity.status),
			message: `${activity.kind} ${activity.status}`,
			reason: `Transaction ${activity.hash}`,
			reportId: activity.reportId,
		})
	}
	const controlPlane = startOperatorControlPlane({
		config,
		deploymentRecovery,
		fixedState,
		getCursor: () => cursor,
		lockManager,
		onNetworkProfileSwitch: () => wakeProfileSwitchWait?.(),
		signerOperationGate,
		state,
	})
	const { dashboard, pending } = controlPlane
	const waitForProfileSwitchOrDelay = async (milliseconds: number) => {
		if (pending.profileSwitch) return
		await Promise.race([
			Bun.sleep(milliseconds),
			new Promise<void>(resolve => {
				wakeProfileSwitchWait = resolve
				if (pending.profileSwitch) resolve()
			}),
		])
		wakeProfileSwitchWait = undefined
	}
	const reports = new Map<bigint, ActiveReport>()
	const persistPosition = async (position: PositionRecord) => {
		const nextPositions = [position, ...positions.filter(existing => existing.reportId !== position.reportId)]
		positionJournal = await savePositionJournalState(config.positionFile, { archived: positionJournal.archived, positions: nextPositions }, config.network.chain.id)
		positions = positionJournal.positions
		state.positions = positions
		state.positionArchive = positionJournal.archived
	}
	const flushHistoryOutboxes = async () => {
		for (const position of positions.filter(candidate => candidate.historyOutbox !== undefined)) {
			const record = position.historyOutbox
			if (record === undefined) continue
			if (!state.executionHistory.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) state.executionHistory.unshift(record)
			await appendExecutionHistoryIfMissing(config.historyFile, record, config.network.chain.id)
			await persistPosition({ ...position, historyOutbox: undefined })
		}
	}
	let cachedLogs: TransactionLog[] = []
	let catalogForScan = createTokenCatalogTracker((configured, observed) => discoverAugurRepTokens(client, config.network.chain.id, configured, observed))
	recordOperation(state, {
		category: 'scan',
		details: config.coordinatorAddresses.length === 0 ? undefined : `Approved coordinators: ${config.coordinatorAddresses.join(', ')}`,
		level: 'info',
		message: config.networkConfigured ? 'Operator started' : 'Operator waiting for network configuration',
		reason: config.networkConfigured ? `${config.network.name} chain ${config.network.chain.id.toString()}` : 'Set the chain and RPC endpoints in the dashboard',
		reportId: undefined,
	})
	console.log(
		config.networkConfigured
			? `network=${config.network.name} chain=${config.network.chain.id.toString()} mode=${config.execute ? 'execute' : 'dry-run'} submission=${config.submission.mode} oracle=${config.openOracle} coordinators=${config.coordinatorAddresses.join(',') || 'none'} rpc=${endpointLabel(config.connectivity.readRpcUrl)}`
			: 'network=unconfigured mode=paused configure the chain and RPC endpoints in the dashboard',
	)
	try {
		await pollUntilStopped(
			async consecutiveFailures => {
				if (pending.profileSwitch) return true
				state.consecutivePollFailures = consecutiveFailures
				const scanIntentLock = await acquireScanSignerOperation(signerOperationGate, deploymentRecovery, executorIntentPath)
				if (scanIntentLock === undefined) return 'deferred'
				state.nextRetryAt = undefined
				state.retryInProgress = consecutiveFailures > 0
				if (state.retryInProgress) state.lastRetryAt = new Date().toISOString()
				try {
					let executionActivationPending = false
					state.rpcEndpointHealth = readPool.snapshot()
					const deploymentSettingsDeferred = pending.deployment !== undefined && deploymentUpdateMustWait(fixedState.deployment, pending.deployment, positions)
					const networkInitializationPending = pending.network !== undefined
					if (deploymentSettingsDeferred) {
						state.paused = true
						state.status = 'paused'
						if (!state.operationLog.some(entry => entry.message === 'Deployment update waiting for open positions'))
							recordOperation(state, {
								category: 'configuration',
								details: undefined,
								level: 'warning',
								message: 'Deployment update waiting for open positions',
								reason: 'OpenOracle, executor, REP, and WETH identities remain unchanged until every risk-consuming position is closed',
								reportId: undefined,
							})
					} else if (!networkInitializationPending) {
						const appliedSettings = applyQueuedExecutionSettings(config, state, pending)
						if (appliedSettings.reportScanReset) {
							const reset = resetReportScanState<TransactionLog>(state, reports)
							cursor = reset.cursor
							cachedLogs = reset.cachedLogs
						}
					}
					if (!deploymentSettingsDeferred && pending.execute !== undefined) {
						executionActivationPending = pending.execute && !fixedState.execute
						if (executionActivationPending) {
							if (lockManager === undefined) throw new Error('Execution requires exclusive journal and signer lock management')
							await ensureExecutionHistoryWritable(config.historyFile)
							positionJournal = await savePositionJournalState(config.positionFile, { archived: positionJournal.archived, positions }, config.network.chain.id)
							positions = positionJournal.positions
							state.positions = positions
							state.positionArchive = positionJournal.archived
							config.execute = true
							state.paused = true
							startupValidated = false
						} else {
							config.execute = pending.execute
							fixedState.execute = pending.execute
							pending.execute = undefined
						}
					}
					if (!deploymentSettingsDeferred && pending.deployment !== undefined) {
						const deployment = pending.deployment
						pending.deployment = undefined
						config.coordinatorAddresses = [...deployment.coordinatorAddresses]
						config.deploymentManifest = deployment.deploymentManifest
						config.executor = deployment.executor
						config.openOracle = deployment.openOracle
						config.quorumRpcUrls = [...deployment.quorumRpcUrls]
						config.router = deployment.uniswapRouter
						config.v2Router = deployment.uniswapV2Router
						config.v4PoolManager = deployment.uniswapV4PoolManager
						config.v4Quoter = deployment.uniswapV4Quoter
						fixedState.deployment = deployment
						fixedState.executor = deployment.executor
						fixedState.openOracle = deployment.openOracle
						config.network.factory = deployment.uniswapFactory
						config.network.quoter = deployment.uniswapQuoter
						config.network.rep = deployment.rep
						config.network.weth = deployment.weth
						readPool = createRpcEndpointPool([config.connectivity.readRpcUrl, ...config.quorumRpcUrls])
						state.rpcEndpointHealth = readPool.snapshot()
						client = createClient()
						clientRpcUrl = undefined
						readClients = [createClient(config.connectivity.readRpcUrl), ...config.quorumRpcUrls.map(url => createClient(url))]
						wallet = createWallet()
						startupValidated = false
						cursor = undefined
						reports.clear()
						cachedLogs = []
						state.activeReportCount = 0
						state.opportunities = []
						state.reportPaths = []
						state.tokenMarkets = []
						state.marketObservations = []
						state.marketConsensus = undefined
						catalogForScan = createTokenCatalogTracker((configured, observed) => discoverAugurRepTokens(client, config.network.chain.id, configured, observed))
					}
					if (!deploymentSettingsDeferred && networkInitializationPending) {
						const appliedSettings = applyQueuedExecutionSettings(config, state, pending)
						if (appliedSettings.reportScanReset) {
							const reset = resetReportScanState<TransactionLog>(state, reports)
							cursor = reset.cursor
							cachedLogs = reset.cachedLogs
						}
						const network = pending.network
						if (network === undefined) throw new Error('Queued network initialization is missing its network identity')
						config.network = network
						config.networkConfigured = true
						fixedState.network = network.name
						fixedState.expectedChainId = network.chain.id
						fixedState.explorerUrl = network.explorerUrl
						fixedState.networkConfigured = true
						pending.network = undefined
					}
					if (!deploymentSettingsDeferred && pending.connectivity !== undefined) {
						config.connectivity = pending.connectivity
						pending.connectivity = undefined
						readPool = createRpcEndpointPool([config.connectivity.readRpcUrl, ...config.quorumRpcUrls])
						state.rpcEndpointHealth = readPool.snapshot()
						client = createClient()
						clientRpcUrl = undefined
						readClients = [createClient(config.connectivity.readRpcUrl), ...config.quorumRpcUrls.map(url => createClient(url))]
						wallet = createWallet()
						startupValidated = false
					}
					if (!deploymentSettingsDeferred && pending.signerUpdate) {
						const appliedSigner = await applyQueuedSigner({
							activeSignerLock,
							config,
							createWallet,
							fixedState,
							lockManager,
							pending,
							state,
							walletAddress: current => current?.account.address,
						})
						activeSignerLock = appliedSigner.activeSignerLock
						wallet = appliedSigner.wallet
					}
					if (executionActivationPending) {
						readPool = createRpcEndpointPool([config.connectivity.readRpcUrl, ...config.quorumRpcUrls])
						state.rpcEndpointHealth = readPool.snapshot()
						client = createClient()
						clientRpcUrl = undefined
						readClients = [createClient(config.connectivity.readRpcUrl), ...config.quorumRpcUrls.map(url => createClient(url))]
						wallet = createWallet()
					}
					if (!config.networkConfigured) return completeUnconfiguredPoll(state)
					if (!startupValidated) {
						if (config.execute) {
							const chainReads = readClients.map(async (_, index) => {
								const endpoint = index === 0 ? endpointLabel(config.connectivity.readRpcUrl) : endpointLabel(config.quorumRpcUrls[index - 1] ?? '')
								const rpcUrl = index === 0 ? config.connectivity.readRpcUrl : (config.quorumRpcUrls[index - 1] ?? '')
								return {
									endpoint,
									index,
									value: await contextualRpcRead('eth_chainId', requestClient => requestClient.getChainId(), rpcUrl),
								}
							})
							const observedChainId = await settledQuorumValue('configured chain id', chainReads)
							if (observedChainId !== config.network.chain.id)
								throw new Error(`Read RPC quorum ${[config.connectivity.readRpcUrl, ...config.quorumRpcUrls].map(endpointLabel).join(', ')} returned chain ${observedChainId.toString()} while calling eth_chainId; expected ${config.network.name} chain ${config.network.chain.id.toString()}`)
							const availableChainRead = (await Promise.allSettled(chainReads)).find(result => result.status === 'fulfilled')
							const availableClient = availableChainRead === undefined ? undefined : readClients[availableChainRead.value.index]
							if (availableClient === undefined) throw new Error('Configured chain validation requires an available read RPC endpoint')
							client = availableClient
							clientRpcUrl = availableChainRead === undefined ? undefined : ([config.connectivity.readRpcUrl, ...config.quorumRpcUrls][availableChainRead.value.index] ?? undefined)
						}
						coordinatorPolicies = config.execute ? await loadCoordinatorPoliciesWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls].map(endpointLabel), config) : await loadCoordinatorPolicies(client, config)
						await authenticateConfiguredDeployments(readClients, config)
						if (config.execute && config.executor !== undefined) {
							const executor = config.executor
							const executorCode = await contextualRpcRead('eth_getCode', requestClient => requestClient.getCode({ address: executor }))
							if (executorCode === undefined || executorCode === '0x') throw new Error(`Configured executor ${executor} has no contract code on ${config.network.name}`)
						}
						state.endpointChecks = [...(config.execute ? [] : await checkConnectivity(config.connectivity, config.network.chain.id)), ...(await checkSubmissionEndpoints(config.submission, config.network.chain.id))]
						startupValidated = true
						if (executionActivationPending) {
							fixedState.execute = true
							pending.execute = undefined
							state.paused = config.paused
						}
					}
					let nextError: string | undefined
					if (positions.some(position => position.historyOutbox !== undefined)) {
						try {
							await flushHistoryOutboxes()
						} catch (error) {
							const message = `Confirmed dispute history is not durable: ${errorMessage(error)}`
							nextError = message
							console.error(`historyPersistenceFailed=${message}`)
						}
					}
					let fixedHeadNumber: bigint | undefined
					if (config.execute) {
						const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
						const settledHeads = await Promise.allSettled(
							readClients.map(async (_, index) => {
								const endpoint = endpointLabel(endpoints[index] ?? '')
								return {
									endpoint,
									head: await contextualRpcRead('eth_blockNumber', requestClient => requestClient.getBlockNumber(), endpoints[index]),
									index,
								}
							}),
						)
						const availableHeads = availableSettledValues(settledHeads)
						const quorumRequirement = rpcQuorumRequirement()
						if (availableHeads.length < quorumRequirement) {
							const failures = settledHeads.flatMap(result => (result.status === 'rejected' ? [errorMessage(result.reason)] : []))
							throw new ConnectivityDegradedError(`Canonical head does not satisfy the configured RPC quorum requirement: ${failures.join('; ')}`)
						}
						const sharedHead = availableHeads.reduce((minimum, observation) => (observation.head < minimum ? observation.head : minimum), availableHeads[0]?.head ?? 0n)
						const settledBlocks = await Promise.allSettled(
							availableHeads.map(async observation => {
								const readClient = readClients[observation.index]
								if (readClient === undefined) throw new Error('Canonical head reader is unavailable')
								const fixedBlock = await contextualRpcRead(
									'eth_getBlockByNumber',
									async requestClient => {
										const value = await requestClient.getBlock({
											blockNumber: sharedHead,
										})
										if (value.hash === undefined) throw new Error('Canonical head block is missing its hash')
										return { ...value, hash: value.hash }
									},
									endpoints[observation.index],
								)
								return {
									block: fixedBlock,
									endpoint: observation.endpoint,
									index: observation.index,
								}
							}),
						)
						const availableBlocks = availableSettledValues(settledBlocks)
						if (availableBlocks.length < quorumRequirement) {
							const failures = settledBlocks.flatMap(result => (result.status === 'rejected' ? [errorMessage(result.reason)] : []))
							throw new ConnectivityDegradedError(`Canonical head does not satisfy the configured RPC quorum requirement: ${failures.join('; ')}`)
						}
						quorumValue(
							`canonical head ${sharedHead.toString()}`,
							availableBlocks.map(observation => ({
								endpoint: observation.endpoint,
								value: observation.block.hash,
							})),
							quorumRequirement,
						)
						const selected = availableBlocks[0]
						if (selected === undefined) throw new Error('Canonical head does not satisfy the configured RPC quorum requirement')
						const selectedClient = readClients[selected.index]
						if (selectedClient === undefined) throw new Error('Canonical head does not satisfy the configured RPC quorum requirement')
						client = selectedClient
						clientRpcUrl = endpoints[selected.index]
						fixedHeadNumber = sharedHead
					}
					await contextualRpcRead('eth_chainId', async requestClient => {
						const value = await requestClient.getChainId()
						if (value !== config.network.chain.id) throw new Error(`Read RPC chain mismatch: expected ${config.network.chain.id.toString()}, received ${value.toString()}`)
					})
					const block = await contextualRpcRead('eth_getBlockByNumber', async requestClient => {
						const value =
							fixedHeadNumber === undefined
								? await requestClient.getBlock()
								: await requestClient.getBlock({
										blockNumber: fixedHeadNumber,
									})
						if (value.number === undefined) throw new Error('Latest block is missing its number')
						if (value.hash === undefined) throw new Error('Latest block is missing its hash')
						return { ...value, hash: value.hash, number: value.number }
					})
					const blockNumber = block.number
					console.log(`observedBlock=${blockNumber.toString()} blockAgeSeconds=${(BigInt(Math.floor(Date.now() / 1_000)) - block.timestamp).toString()}`)
					const blockHash = block.hash
					const finalityAnchorForHead = async () => {
						const number = blockNumber > REORG_OVERLAP_BLOCKS ? blockNumber - REORG_OVERLAP_BLOCKS : 0n
						const anchor = await contextualRpcRead('eth_getBlockByNumber', async requestClient => {
							const value = await requestClient.getBlock({ blockNumber: number })
							if (value.hash == null) throw new Error('Finality anchor block is missing its canonical hash')
							return { ...value, hash: value.hash }
						})
						return { hash: anchor.hash, number }
					}
					if (cursor?.finalityAnchorNumber !== undefined && cursor.finalityAnchorHash !== undefined) {
						const anchorNumber = cursor.finalityAnchorNumber
						let observedAnchorHash: string | undefined
						if (anchorNumber <= blockNumber) {
							const anchor = await contextualRpcRead('eth_getBlockByNumber', async requestClient => {
								const value = await requestClient.getBlock({
									blockNumber: anchorNumber,
								})
								if (value.hash == null) throw new Error('Finality anchor block is missing its canonical hash')
								return { ...value, hash: value.hash }
							})
							observedAnchorHash = anchor.hash
						}
						if (finalityAnchorRequiresReset(cursor, blockNumber, observedAnchorHash)) {
							cachedLogs = []
							reports.clear()
							state.activeReportCount = 0
							state.opportunities = []
							state.reportPaths = []
							state.tokenMarkets = []
							state.marketObservations = []
							state.marketConsensus = undefined
							catalogForScan = createTokenCatalogTracker((configured, observed) => discoverAugurRepTokens(client, config.network.chain.id, configured, observed))
							cursor = config.coordinatorAddresses.length !== 0 || config.lookbackBlocks === 0n ? initialCursor(blockNumber, 0n) : { ...initialCursor(blockNumber, 0n), nextBlock: latestLogRange(blockNumber, config.lookbackBlocks).fromBlock }
							state.status = 'syncing'
							recordOperation(state, {
								category: 'scan',
								details: `anchor=${anchorNumber.toString()}`,
								level: 'warning',
								message: 'Canonical history changed beyond the retained overlap',
								reason: 'Execution stayed blocked while report and market caches were cleared; the latest bounded window will rebuild on the next scan',
								reportId: undefined,
							})
							return 'deferred'
						}
					}
					let lifecycleProcessed = false
					if (config.execute && wallet !== undefined) {
						for (const position of positions.filter(candidate => candidate.status !== 'recovery-required' && candidate.manualReconciliation === undefined && (candidate.expiredTransactionAttempts?.length ?? 0) !== 0)) {
							try {
								const reconciled = await reconcileExpiredAttemptsWithQuorum(readClients, config, position, blockNumber)
								if (reconciled !== position) {
									await persistPosition(reconciled)
									recordOperation(state, {
										category: 'transaction',
										details: `entryGas=${reconciled.actualEntryGasCostEth} ETH lifecycleGas=${reconciled.lifecycleGasCostEth} ETH`,
										level: 'info',
										message: 'Late atomic revert gas reconciled',
										reason: (reconciled.expiredTransactionAttempts?.length ?? 0) === 0 ? `Report ${position.reportId} expired transaction monitoring completed` : `Report ${position.reportId} expired transaction monitoring remains active`,
										reportId: position.reportId,
									})
								}
							} catch (error) {
								if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
								const message = `Position ${position.reportId} expired transaction requires attention: ${errorMessage(error)}`
								nextError = message
								recordOperation(state, {
									category: 'transaction',
									details: undefined,
									level: 'error',
									message: 'Expired transaction monitoring failed closed',
									reason: message,
									reportId: position.reportId,
								})
							}
						}
						for (const position of positions.filter(candidate => candidate.status !== 'replaced' && positionConsumesRisk(candidate.status))) {
							try {
								const result = await processPositionLifecycle(client, readClients, wallet, config, position, blockNumber, persistPosition, trackTransaction)
								if (result === 'processed' || result === 'progressed') {
									lifecycleProcessed = true
									const updatedPosition = state.positions.find(candidate => candidate.reportId === position.reportId)
									const replacementClaimed = updatedPosition?.status === 'replaced'
									let lifecycleMessage = 'Position lifecycle advanced'
									let lifecycleReason = `Report ${position.reportId} completed one durable public lifecycle transaction`
									if (result === 'processed') {
										lifecycleMessage = 'Position lifecycle completed'
										lifecycleReason = `Report ${position.reportId} was settled and withdrawn`
									}
									if (replacementClaimed) {
										lifecycleMessage = 'Replacement credit claimed'
										lifecycleReason = `Report ${position.reportId} credit is final; the one-sided inventory remains risk-consuming until reconciled`
									}
									recordOperation(state, {
										category: 'transaction',
										details: `withdrawn=${updatedPosition?.withdrawnWeth ?? 'unknown'} WETH; ${updatedPosition?.withdrawnToken ?? 'unknown'} ${updatedPosition?.tokenSymbol ?? 'token'}`,
										level: 'info',
										message: lifecycleMessage,
										reason: lifecycleReason,
										reportId: position.reportId,
									})
								}
							} catch (error) {
								if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
								const message = `Position ${position.reportId} lifecycle requires attention: ${errorMessage(error)}`
								nextError = message
								recordOperation(state, {
									category: 'transaction',
									details: undefined,
									level: 'error',
									message: 'Position lifecycle failed closed',
									reason: message,
									reportId: position.reportId,
								})
							}
						}
					}
					if (lifecycleProcessed) {
						state.lastPollAt = new Date().toISOString()
						return completeSuccessfulPoll(state, nextError, config.once)
					}
					const executionReady = positions.every(position => position.historyOutbox === undefined) && nextError === undefined
					const discoversReportsFromCoordinators = config.coordinatorAddresses.length !== 0
					cursor ??=
						discoversReportsFromCoordinators || config.lookbackBlocks === 0n
							? initialCursor(blockNumber, 0n)
							: {
									...initialCursor(blockNumber, 0n),
									nextBlock: latestLogRange(blockNumber, config.lookbackBlocks).fromBlock,
								}
					const replacedMarketHead = await clearOrphanedDexEvidenceForHeadReplacement({ hash: cursor.lastHeadHash, number: cursor.lastHeadNumber }, { hash: blockHash, number: blockNumber }, state, previousBlockNumber =>
						canonicalBlockHashWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], 'previous market head', previousBlockNumber),
					)
					const scanCursor = cursorForHeadScan(cursor, blockNumber, blockHash, REORG_OVERLAP_BLOCKS)
					if (scanCursor === undefined) {
						state.blockNumber = blockNumber.toString()
						state.blockTimestamp = block.timestamp.toString()
						return completeSuccessfulPoll(state, nextError, config.once)
					}
					if (discoversReportsFromCoordinators) {
						const pendingReports = config.execute ? await pendingCoordinatorReportsWithQuorum(readClients, config, blockNumber) : await pendingCoordinatorReports(client, config, blockNumber)
						applyCoordinatorReports(reports, pendingReports)
						cachedLogs = []
					} else if (config.lookbackBlocks > 0n) {
						const recentRange = latestLogRange(blockNumber, config.lookbackBlocks)
						const fromBlock = scanCursor.nextBlock > recentRange.fromBlock ? scanCursor.nextBlock : recentRange.fromBlock
						for (const range of newestFirstScanRanges(fromBlock, blockNumber, MAX_LOG_SCAN_RANGE)) {
							const logs = await fetchLogsWithAdaptiveRanges({ nextBlock: range.fromBlock }, range.toBlock, MAX_LOG_SCAN_RANGE, requestedRange =>
								contextualLogRead(requestClient =>
									requestClient.getLogs({
										address: config.openOracle,
										fromBlock: requestedRange.fromBlock,
										toBlock: requestedRange.toBlock,
										topics: [[OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC]],
									}),
								),
							)
							cachedLogs = [...cachedLogs.filter(log => logBlockNumber(log) < range.fromBlock || logBlockNumber(log) > range.toBlock), ...logs].sort(compareLogs)
						}
						reports.clear()
						applyLogs(reports, cachedLogs)
						cachedLogs = retainReportsAndLogs(reports, cachedLogs, coordinatorPolicies, config.openOracle, blockNumber)
					} else {
						cachedLogs = []
						reports.clear()
					}
					if (replacedMarketHead) {
						recordOperation(state, {
							category: 'decision',
							details: `block=${blockNumber.toString()}`,
							level: 'warning',
							message: 'Market evidence reset after canonical head replacement',
							reason: 'DEX evidence from the replaced block was discarded before this poll re-evaluated every report',
							reportId: undefined,
						})
					}
					let completedOpportunityCount = 0
					let completedFinalityAnchor: Awaited<ReturnType<typeof finalityAnchorForHead>> | undefined
					const completedCursor = await advanceCursorAfterSuccessfulHead(blockNumber, blockHash, async () => {
						state.centralizedMarket = await observeCentralizedMarkets(config.centralizedMarkets, config.network.rep, config.network.chain.id)
						const configuredDexMarkets = await observeConstantProductMarkets(config.centralizedMarkets, config.network.rep, config.network.weth, async pair => {
							return await readConstantProductPairWithQuorum({
								block: { hash: blockHash, number: blockNumber },
								chainId: config.network.chain.id,
								endpoints: [config.connectivity.readRpcUrl, ...config.quorumRpcUrls],
								pair,
								readBlock: async (endpoint, canonicalBlockNumber) =>
									await contextualRpcRead(
										'eth_getBlockByNumber',
										async requestClient => {
											const endpointBlock = await requestClient.getBlock({ blockNumber: canonicalBlockNumber })
											return { hash: endpointBlock.hash, number: endpointBlock.number, timestamp: endpointBlock.timestamp }
										},
										endpoint,
									),
								readPairAtBlock: async (endpoint, quorumPair, canonicalBlockHash) => {
									const [token0, token1, reserves] = await contextualRpcRead(
										'eth_call',
										requestClient =>
											Promise.all([
												requestClient.readContract({ address: quorumPair, abi: constantProductPairAbi, blockHash: canonicalBlockHash, functionName: 'token0' }),
												requestClient.readContract({ address: quorumPair, abi: constantProductPairAbi, blockHash: canonicalBlockHash, functionName: 'token1' }),
												requestClient.readContract({ address: quorumPair, abi: constantProductPairAbi, blockHash: canonicalBlockHash, functionName: 'getReserves' }),
											]),
										endpoint,
									)
									return { reserve0: reserves[0], reserve1: reserves[1], token0, token1 }
								},
								requirement: rpcQuorumRequirement(),
							})
						})
						try {
							await requireCanonicalBlock(blockNumber, blockHash, async canonicalBlockNumber => canonicalBlockHashWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], 'market snapshot final revalidation', canonicalBlockNumber))
						} catch (error) {
							state.marketObservations = discardDexMarketObservations(state.marketObservations ?? [])
							state.marketConsensus = undefined
							throw error
						}
						const marketObservedAt = Date.now()
						state.marketObservations = [...(state.marketObservations ?? []), ...centralizedMarketConsensusObservations(state.centralizedMarket), ...configuredDexMarkets.observations]
							.filter(observation => observation.observedAt <= marketObservedAt && marketObservedAt - observation.observedAt <= config.centralizedMarkets.maximumObservationAgeMilliseconds)
							.slice(-2_000)
						const observedTokens = [...reports.values()].flatMap(report => [report.latest.game.token1, report.latest.game.token2]).filter(address => address !== zeroAddress && address.toLowerCase() !== config.network.weth.toLowerCase())
						const { executionTokens, monitoringTokens: discoveredTokens } = await catalogForScan(config.tokenAddresses, observedTokens)
						state.tokenAddresses = [...executionTokens]
						state.tokenMarkets = await loadTokenMarkets(client, {
							chainId: config.network.chain.id,
							explorerUrl: config.network.explorerUrl,
							factory: config.network.factory,
							tokens: discoveredTokens,
							weth: config.network.weth,
							wallet: wallet?.account.address,
						})
						const sampledAt = new Date(bigintToSafeNumber(block.timestamp * 1_000n, 'Price sample block timestamp')).toISOString()
						const samples = missingPricePoints(state.priceHistory, pricePoints(state.tokenMarkets, blockNumber, sampledAt))
						await appendPriceHistory(config.priceHistoryFile, samples, config.network.chain.id)
						state.priceHistory = [...state.priceHistory, ...samples]
						const pools = (await Promise.all(discoveredTokens.map(token => poolsForToken(client, config, token)))).flat()
						if (pools.length === 0) console.log('status=no-liquid-rep-weth-v3-pool')
						const balances = await contextualRpcRead('eth_call', requestClient => loadBalances(requestClient, wallet, config, pools, discoveredTokens))
						const gasPrice = (block.baseFeePerGas ?? 0n) * 2n + 2n * 10n ** 9n
						const opportunities: OpportunitySnapshot[] = []
						const candidates: ExecutionCandidate[] = []
						const cycleDexObservations: MarketConsensusObservation[] = []
						for (const report of reports.values()) {
							if (report.settled) continue
							try {
								const reportId = report.latest.helper.reportId.toString()
								const metadata = state.tokenMarkets.find(market => market.address.toLowerCase() === report.latest.game.token2.toLowerCase())
								if (metadata === undefined) throw new Error('Token metadata is unavailable')
								const evaluated = await inspectReport(
									client,
									wallet,
									config,
									report.latest,
									pools,
									blockNumber,
									blockHash,
									block.timestamp,
									gasPrice,
									balances?.raw,
									metadata,
									executionTokenAllowed(executionTokens, report.latest.game.token2) && authenticatedExecutionToken(config, report.latest.game.token2),
									executionReady,
									state.paused,
									coordinatorPolicies,
									(message, reason) =>
										recordOperation(state, {
											category: 'decision',
											details: undefined,
											level: 'info',
											message,
											reason,
											reportId,
										}),
								)
								if (evaluated !== undefined) {
									cycleDexObservations.push(...evaluated.dexObservations)
									opportunities.push(evaluated.opportunity)
									recordOperation(state, {
										category: 'decision',
										details: `direction=${evaluated.opportunity.direction} estimatedProfitEth=${evaluated.opportunity.estimatedNetProfitEth}`,
										level: evaluated.opportunity.decision === 'execution-failed' ? 'error' : 'info',
										message: `Decision: ${evaluated.opportunity.decision}`,
										reason: `Profit and inventory gates evaluated for report ${evaluated.opportunity.reportId}`,
										reportId: evaluated.opportunity.reportId,
									})
									if (evaluated.candidate !== undefined) {
										const referenceWeth = evaluated.candidate.quote.direction === 'sell-rep' ? evaluated.candidate.quote.grossProceedsAttoWeth : evaluated.candidate.quote.hedgeCostAttoWeth
										const dexPriceRepPerEth = referenceWeth === 0n ? 0n : (evaluated.candidate.quote.hedgeAmountAttoRep * 10n ** 18n) / referenceWeth
										const primaryRep = evaluated.candidate.report.game.token2.toLowerCase() === config.network.rep.toLowerCase()
										evaluated.opportunity.centralizedPriceDeviationBps = state.centralizedMarket === undefined ? undefined : centralizedPriceDeviationBps(dexPriceRepPerEth, state.centralizedMarket, evaluated.candidate.report.game.token2)?.toString()
										const venueConsensus = config.centralizedMarkets.venueConsensus
										const consensusEstimate =
											venueConsensus === undefined
												? undefined
												: estimateMarketConsensus(
														[...(state.marketObservations ?? []), ...evaluated.dexObservations].filter(observation => observation.assetId.toLowerCase() === evaluated.candidate?.report.game.token2.toLowerCase() && observation.marketId?.toLowerCase() !== evaluated.candidate?.hedgePool.toLowerCase()),
														marketConsensusSettings(config.centralizedMarkets),
														evaluated.candidate.report.game.token2,
														config.network.chain.id,
														Date.now(),
														evaluated.candidate.hedgeVenue,
														evaluated.candidate.hedgePool,
													)
										let marketAllowed = false
										if (centralizedMarketConfigurationAllowsExecution(config.centralizedMarkets)) {
											if (consensusEstimate === undefined) {
												marketAllowed = !config.centralizedMarkets.requiredForExecution && centralizedPriceAllowsExecution(dexPriceRepPerEth, state.centralizedMarket, config.centralizedMarkets, evaluated.candidate.report.game.token2)
											} else {
												marketAllowed = marketConsensusAllowsExecution(
													dexPriceRepPerEth,
													consensusEstimate,
													{
														maximumDeviationBps: config.centralizedMarkets.maximumDexDeviationBps,
														maximumObservationAgeMilliseconds: config.centralizedMarkets.maximumObservationAgeMilliseconds,
														requiredForExecution: config.centralizedMarkets.requiredForExecution,
													},
													evaluated.candidate.report.game.token2,
													config.network.chain.id,
												)
											}
										}
										if (consensusEstimate !== undefined) evaluated.opportunity.centralizedPriceDeviationBps = marketConsensusDeviationBps(dexPriceRepPerEth, consensusEstimate, evaluated.candidate.report.game.token2)?.toString()
										evaluated.candidate.marketConsensus = consensusEstimate
										if (!marketAllowed) {
											evaluated.opportunity.decision = 'market-risk'
											recordOperation(state, {
												category: 'decision',
												details: `dexRepPerEth=${decimalSignedEth(dexPriceRepPerEth)}`,
												level: 'warning',
												message: 'Market consensus guard blocked report',
												reason: primaryRep ? 'Executable price was not confirmed by independent CEX and leave-one-out DEX consensus' : 'Required market consensus is unavailable for this REP token',
												reportId: evaluated.opportunity.reportId,
											})
											continue
										}
										const riskDate = dateFromBlockTimestamp(block.timestamp)
										const mismatch = candidateRiskMismatch(evaluated.candidate, positions, config.riskLimits, riskDate, archivedUtcDayGasSpentWeth(positionJournal.archived, riskDate))
										if (mismatch === undefined) candidates.push(evaluated.candidate)
										else {
											evaluated.opportunity.decision = 'risk-limit'
											recordOperation(state, {
												category: 'decision',
												details: undefined,
												level: 'warning',
												message: 'Risk limit blocked report',
												reason: mismatch,
												reportId: evaluated.opportunity.reportId,
											})
										}
									}
								}
							} catch (error) {
								const reportId = report.latest.helper.reportId.toString()
								const message = errorMessage(error)
								if (message === 'Canonical block changed during market observation') {
									state.marketObservations = discardDexMarketObservations(state.marketObservations ?? [])
									state.marketConsensus = undefined
									throw error
								}
								console.error(`report=${reportId} skipped=${message}`)
								recordOperation(state, {
									category: 'decision',
									details: undefined,
									level: 'warning',
									message: 'Report evaluation failed',
									reason: message,
									reportId,
								})
								throw error
							}
						}
						state.activeReportCount = [...reports.values()].filter(report => !report.settled).length
						state.marketObservations = [...(state.marketObservations ?? []), ...cycleDexObservations].filter(observation => observation.observedAt <= Date.now() && Date.now() - observation.observedAt <= config.centralizedMarkets.maximumObservationAgeMilliseconds).slice(-2_000)
						state.marketConsensus =
							config.centralizedMarkets.venueConsensus === undefined
								? undefined
								: estimateMarketConsensus(
										(state.marketObservations ?? []).filter(observation => observation.assetId.toLowerCase() === config.network.rep.toLowerCase()),
										marketConsensusSettings(config.centralizedMarkets),
										config.network.rep,
										config.network.chain.id,
									)
						state.reportPaths = discoversReportsFromCoordinators
							? []
							: [...reports.entries()].map(([id, report]) => ({
									reportId: id.toString(),
									settled: report.settled,
									steps: report.steps,
								}))
						state.balances = balances?.snapshot
						state.blockNumber = blockNumber.toString()
						state.blockTimestamp = block.timestamp.toString()
						state.gameCapital = gameCapitalSnapshot(
							[...reports.values()].filter(report => !report.settled).map(report => report.latest.game),
							config.network.weth,
						)
						state.lastPollAt = new Date().toISOString()
						state.opportunities = opportunities
						const selected = selectBestExecution(candidates, candidate => candidate.quote.netProfitAttoWeth)
						if (selected !== undefined && wallet !== undefined) {
							selected.opportunity.decision = 'selected'
							try {
								const metadata = state.tokenMarkets.find(market => market.address.toLowerCase() === selected.report.game.token2.toLowerCase())
								if (metadata === undefined) throw new Error('Token metadata is unavailable')
								const record = await executeDispute(
									client,
									readClients,
									wallet,
									config,
									selected.report,
									selected.quote,
									selected.pool,
									selected.hedgeVenue,
									selected.hedgeFee,
									metadata,
									positions,
									state.centralizedMarket,
									selected.marketConsensus,
									async () => {
										try {
											await requireCanonicalDexEvidence(selected.marketConsensus, evidenceBlockNumber => canonicalBlockHashWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], 'market evidence', evidenceBlockNumber))
											return true
										} catch (error) {
											if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
											state.marketObservations = discardDexMarketObservations(state.marketObservations ?? [])
											state.marketConsensus = undefined
											selected.marketConsensus = undefined
											return false
										}
									},
									() => state.paused,
									trackTransaction,
									persistPosition,
									archivedUtcDayGasSpentWeth(positionJournal.archived, dateFromBlockTimestamp(block.timestamp)),
								)
								selected.opportunity.decision = 'submitted'
								if (!state.executionHistory.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) state.executionHistory.unshift(record)
								try {
									await flushHistoryOutboxes()
								} catch (error) {
									if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
									const message = `Confirmed dispute ${record.transactionHash} is visible but history persistence failed: ${errorMessage(error)}`
									nextError = message
									console.error(`historyPersistenceFailed=${message}`)
								}
							} catch (error) {
								if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
								const message = errorMessage(error)
								selected.opportunity.decision = executionFailureDecision(error)
								if (selected.opportunity.decision === 'execution-failed') {
									nextError = `Report ${selected.report.helper.reportId.toString()} execution failed: ${message}`
								}
								console.error(`report=${selected.report.helper.reportId.toString()} executionFailed=${message}`)
							}
						}
						state.priceHistory = state.priceHistory.slice(-2_000)
						completedOpportunityCount = opportunities.length
						completedFinalityAnchor = await finalityAnchorForHead()
					})
					if (completedFinalityAnchor === undefined) throw new Error('Successful scan did not produce a finality anchor')
					cursor = withFinalityAnchor(completedCursor, completedFinalityAnchor.number, completedFinalityAnchor.hash)
					const settledReportIds = new Set(
						[...reports.entries()]
							.filter(([, report]) => {
								const settlement = report.steps.findLast(step => step.event === 'settled')
								return report.settled && settlement !== undefined && blockNumber > BigInt(settlement.blockNumber) + REORG_OVERLAP_BLOCKS
							})
							.map(([id]) => id),
					)
					if (settledReportIds.size !== 0) {
						for (const id of settledReportIds) reports.delete(id)
						cachedLogs = cachedLogs.filter(log => !settledReportIds.has(reportId(log)))
					}
					recordOperation(state, {
						category: 'scan',
						details: `${state.activeReportCount.toString()} active reports; ${completedOpportunityCount.toString()} opportunities`,
						level: nextError === undefined ? 'info' : 'warning',
						message: 'Scan completed',
						reason: `Block ${blockNumber.toString()}`,
						reportId: undefined,
					})
					return completeSuccessfulPoll(state, nextError, config.once)
				} finally {
					try {
						signerOperationGate.release('scan')
					} finally {
						await scanIntentLock.release()
					}
				}
			},
			consecutiveFailures => {
				state.consecutivePollFailures = consecutiveFailures
				state.retryInProgress = false
				const delayMilliseconds = retryDelayMilliseconds(config.pollMilliseconds, consecutiveFailures)
				if (consecutiveFailures > 0) state.nextRetryAt = new Date(Date.now() + delayMilliseconds).toISOString()
				return waitForProfileSwitchOrDelay(delayMilliseconds)
			},
			config.once,
			error => {
				const message = errorMessage(error)
				state.rpcEndpointHealth = readPool.snapshot()
				state.lastError = message
				state.lastPollFailureAt = new Date().toISOString()
				state.retryInProgress = false
				state.status = operationalFailureDisposition(error) === 'connectivity-degraded' ? 'connectivity-degraded' : 'error'
				recordOperation(state, {
					category: 'scan',
					details: undefined,
					level: 'error',
					message: 'Scan failed',
					reason: message,
					reportId: undefined,
				})
				console.error(`pollFailed=${message}`)
			},
		)
	} finally {
		state.status = 'stopped'
		await dashboard?.stop(pending.profileSwitch)
	}
	return pending.profileSwitch
}

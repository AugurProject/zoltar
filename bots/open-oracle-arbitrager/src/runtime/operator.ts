import { bigintToSafeNumber, createPublicClient, createWalletClient, getAddress, privateKeyToAccount, readContractAtBlock, type Address, type TransactionLog, zeroAddress } from '#ethereum'
import { createRpcEndpointPool } from '@zoltar/bot-shared/ethereum'
import { OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC, OPEN_ORACLE_REPORT_SUBMITTED_TOPIC } from '@zoltar/shared/openOracle'
import { constantProductPairAbi } from '#contracts/abi'
import { advanceCursorAfterSuccessfulHead, assertFinalityAnchor, cursorForHeadScan, initialCursor, operatorStatusAfterPause, scanRanges, withFinalityAnchor, type SyncCursor } from '#monitoring/block-sync'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel } from '#monitoring/connectivity'
import type { Configuration } from '#config/configuration'
import type { DeploymentSettings } from '#config/deployment-settings'
import { createSignerOperationGate } from '#execution/signer-operation-gate'
import { canonicalBlockHashWithQuorum, executionFailureDecision, executionTokenAllowed, selectBestExecution } from '#execution/execution-orchestration'
import { appendExecutionHistoryIfMissing, decimalSignedEth, ensureExecutionHistoryWritable, gameCapitalSnapshot, loadExecutionHistory, recordOperation, type OperatorState, type OpportunitySnapshot } from '#state/operator-state'
import { applyCoordinatorReports, applyLogs, compareLogs, logBlockNumber, reportId, type ActiveReport } from '#monitoring/oracle-log-state'
import { appendPriceHistory, createTokenCatalogTracker, discoverAugurRepTokens, loadPriceHistory, loadTokenMarkets, missingPricePoints, pricePoints } from '#monitoring/market-monitor'
import { centralizedMarketConfigurationAllowsExecution, centralizedMarketConsensusObservations, centralizedPriceAllowsExecution, centralizedPriceDeviationBps, marketConsensusSettings, observeCentralizedMarkets } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { clearOrphanedDexEvidenceForHeadReplacement, discardDexMarketObservations, estimateMarketConsensus, marketConsensusAllowsExecution, marketConsensusDeviationBps, requireCanonicalBlock, requireCanonicalDexEvidence, type MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import { observeConstantProductMarkets } from '@zoltar/bot-shared/monitoring/constant-product-markets'
import { loadPositionJournal, savePositionJournal, type ExclusiveProcessLock, type PositionRecord } from '#state/position-store'
import { availableSettledValues, quorumValue, settledQuorumValue } from '#monitoring/read-quorum'
import { ConnectivityDegradedError, operationalFailureDisposition, pollUntilStopped, replaceOverlap, retryDelayMilliseconds } from '#monitoring/resilience'
import { positionConsumesRisk } from '#core/safety-controls'
import type { NetworkConfiguration } from '#config/network'
import { transactionLogLevel, type TrackTransaction } from '#execution/transaction-tracker'
import type { ExecutionCandidate } from '#core/operator-types'
import { errorMessage, requiredBigint, requiredTuple } from '#core/rpc-validation'
import { candidateRiskMismatch, poolsForToken } from '#monitoring/opportunity-evaluation'
import { dateFromBlockTimestamp, pendingCoordinatorReports, pendingCoordinatorReportsWithQuorum } from '#execution/recovery-support'
import { reconcileExpiredAttemptsWithQuorum, processPositionLifecycle } from '#execution/position-lifecycle'
import type { ExecutionLockManager } from '#execution/execution-locks'
import { loadCoordinatorPolicies, loadCoordinatorPoliciesWithQuorum, authenticatedExecutionToken, authenticateConfiguredDeployments, retainReportsAndLogs } from '#config/runtime-deployment'
import { executeDispute, loadBalances } from '#execution/dispute-execution'
import { inspectReport } from '#monitoring/report-inspection'
import { acquireScanSignerOperation, startOperatorControlPlane } from './operator-control-plane.ts'
import { executorDeploymentIntentPath, loadExecutorDeploymentIntent } from '#execution/executor-deployment-store'
import { applyQueuedExecutionSettings, applyQueuedSigner } from './operator-execution-state.ts'

const REORG_OVERLAP_BLOCKS = 12n
const MAX_LOG_SCAN_RANGE = 100n

export async function runOperator(config: Configuration, lockManager: ExecutionLockManager | undefined, initialSignerLock: ExclusiveProcessLock | undefined) {
	if (config.lookbackBlocks < 0n) throw new Error('lookback-blocks must be a non-negative integer')
	if (!Number.isSafeInteger(config.uiPort) || config.uiPort < 1 || config.uiPort > 65_535) throw new Error('ui-port must be an integer from 1 to 65535')
	if (config.ui && config.once) throw new Error('runtime.ui cannot be combined with runtime.once')
	if (config.execute && config.privateKey === undefined && !config.ui) throw new Error('Execution requires a saved privateKey unless runtime.ui is enabled to unlock the signer')
	if (config.execute && lockManager === undefined) throw new Error('Execution requires exclusive journal and signer lock management')
	if (config.execute) await ensureExecutionHistoryWritable(config.historyFile)
	let positions = await loadPositionJournal(config.positionFile)
	if (config.execute) await savePositionJournal(config.positionFile, positions)
	let readPool = createRpcEndpointPool([config.connectivity.readRpcUrl, ...config.quorumRpcUrls])
	const createClient = (rpcUrl?: string) =>
		createPublicClient({
			chain: config.network.chain,
			transport: config.execute && rpcUrl !== undefined ? readPool.transportFor(rpcUrl) : readPool.transport,
		})
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
	const executionHistory = await loadExecutionHistory(config.historyFile)
	for (const position of positions) {
		const record = position.historyOutbox
		if (record !== undefined && !executionHistory.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) executionHistory.unshift(record)
	}
	const state: OperatorState = {
		activeReportCount: 0,
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
		opportunities: [],
		positions,
		operationLog: [],
		paused: config.paused,
		status: config.networkConfigured ? 'syncing' : 'paused',
		tokenAddresses: config.tokenAddresses,
		tokenMarkets: [],
		priceHistory: await loadPriceHistory(config.priceHistoryFile),
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
	const pendingExecutorDeployment = await loadExecutorDeploymentIntent(executorDeploymentIntentPath(config.settingsFile))
	const deploymentRecovery = { pending: pendingExecutorDeployment !== undefined }
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
	const controlPlane = startOperatorControlPlane({ config, deploymentRecovery, fixedState, getCursor: () => cursor, lockManager, signerOperationGate, state })
	const { dashboard, pending } = controlPlane
	const reports = new Map<bigint, ActiveReport>()
	const persistPosition = async (position: PositionRecord) => {
		const nextPositions = [position, ...positions.filter(existing => existing.reportId !== position.reportId)]
		await savePositionJournal(config.positionFile, nextPositions)
		positions = nextPositions
		state.positions = nextPositions
	}
	const flushHistoryOutboxes = async () => {
		for (const position of positions.filter(candidate => candidate.historyOutbox !== undefined)) {
			const record = position.historyOutbox
			if (record === undefined) continue
			if (!state.executionHistory.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) state.executionHistory.unshift(record)
			await appendExecutionHistoryIfMissing(config.historyFile, record)
			await persistPosition({ ...position, historyOutbox: undefined })
		}
	}
	let cachedLogs: TransactionLog[] = []
	const catalogForScan = createTokenCatalogTracker((configured, observed) => discoverAugurRepTokens(client, config.network.chain.id, configured, observed))
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
			async () => {
				const scanIntentLock = await acquireScanSignerOperation(signerOperationGate, deploymentRecovery, executorDeploymentIntentPath(config.settingsFile))
				if (scanIntentLock === undefined) return false
				try {
					state.rpcEndpointHealth = readPool.snapshot()
					applyQueuedExecutionSettings(config, state, pending)
					if (pending.connectivity !== undefined) {
						config.connectivity = pending.connectivity
						pending.connectivity = undefined
						readPool = createRpcEndpointPool([config.connectivity.readRpcUrl, ...config.quorumRpcUrls])
						client = createClient()
						readClients = [createClient(config.connectivity.readRpcUrl), ...config.quorumRpcUrls.map(url => createClient(url))]
						wallet = createWallet()
						startupValidated = false
					}
					if (pending.signerUpdate) {
						const appliedSigner = await applyQueuedSigner({ activeSignerLock, config, createWallet, fixedState, lockManager, pending, state, walletAddress: current => current?.account.address })
						activeSignerLock = appliedSigner.activeSignerLock
						wallet = appliedSigner.wallet
					}
					if (!config.networkConfigured) return false
					if (!startupValidated) {
						if (config.execute) {
							const chainReads = readClients.map(async (readClient, index) => ({ endpoint: index === 0 ? endpointLabel(config.connectivity.readRpcUrl) : endpointLabel(config.quorumRpcUrls[index - 1] ?? ''), index, value: await readClient.getChainId() }))
							const observedChainId = await settledQuorumValue('configured chain id', chainReads)
							if (observedChainId !== config.network.chain.id) throw new Error(`Read RPC quorum must use ${config.network.name} chain ${config.network.chain.id.toString()}`)
							const availableChainRead = (await Promise.allSettled(chainReads)).find(result => result.status === 'fulfilled')
							const availableClient = availableChainRead === undefined ? undefined : readClients[availableChainRead.value.index]
							if (availableClient === undefined) throw new Error('Configured chain validation requires an available read RPC endpoint')
							client = availableClient
						}
						coordinatorPolicies = config.execute ? await loadCoordinatorPoliciesWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls].map(endpointLabel), config) : await loadCoordinatorPolicies(client, config)
						await authenticateConfiguredDeployments(readClients, config)
						if (config.execute && config.executor !== undefined) {
							const executorCode = await client.getCode({ address: config.executor })
							if (executorCode === undefined || executorCode === '0x') throw new Error(`Configured executor ${config.executor} has no contract code on ${config.network.name}`)
						}
						state.endpointChecks = [...(config.execute ? [] : await checkConnectivity(config.connectivity, config.network.chain.id)), ...(await checkSubmissionEndpoints(config.submission, config.network.chain.id))]
						startupValidated = true
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
						const settledHeads = await Promise.allSettled(readClients.map(async (readClient, index) => ({ endpoint: endpointLabel(endpoints[index] ?? ''), head: await readClient.getBlockNumber(), index })))
						const availableHeads = availableSettledValues(settledHeads)
						if (availableHeads.length < 2) {
							const failures = settledHeads.flatMap(result => (result.status === 'rejected' ? [errorMessage(result.reason)] : []))
							throw new ConnectivityDegradedError(`Canonical head requires at least two available independent RPC endpoints: ${failures.join('; ')}`)
						}
						const sharedHead = availableHeads.reduce((minimum, observation) => (observation.head < minimum ? observation.head : minimum), availableHeads[0]?.head ?? 0n)
						const settledBlocks = await Promise.allSettled(
							availableHeads.map(async observation => {
								const readClient = readClients[observation.index]
								if (readClient === undefined) throw new Error('Canonical head reader is unavailable')
								const fixedBlock = await readClient.getBlock({ blockNumber: sharedHead })
								if (fixedBlock.hash === undefined) throw new Error('Canonical head block is missing its hash')
								return { block: fixedBlock, endpoint: observation.endpoint, index: observation.index }
							}),
						)
						const availableBlocks = availableSettledValues(settledBlocks)
						if (availableBlocks.length < 2) {
							const failures = settledBlocks.flatMap(result => (result.status === 'rejected' ? [errorMessage(result.reason)] : []))
							throw new ConnectivityDegradedError(`Canonical head requires at least two available independent RPC endpoints: ${failures.join('; ')}`)
						}
						quorumValue(
							`canonical head ${sharedHead.toString()}`,
							availableBlocks.map(observation => ({ endpoint: observation.endpoint, value: observation.block.hash })),
						)
						const selected = availableBlocks[0]
						const selectedClient = selected === undefined ? undefined : readClients[selected.index]
						if (selectedClient === undefined) throw new Error('Canonical head requires at least two available independent RPC endpoints')
						client = selectedClient
						fixedHeadNumber = sharedHead
					}
					const observedChainId = await client.getChainId()
					if (observedChainId !== config.network.chain.id) throw new Error(`Read RPC chain mismatch: expected ${config.network.chain.id.toString()}, received ${observedChainId.toString()}`)
					const block = fixedHeadNumber === undefined ? await client.getBlock() : await client.getBlock({ blockNumber: fixedHeadNumber })
					const blockNumber = block.number
					if (blockNumber === undefined) throw new Error('Latest block is missing its number')
					const blockHash = block.hash
					if (blockHash === undefined) throw new Error('Latest block is missing its hash')
					if (cursor?.finalityAnchorNumber !== undefined && cursor.finalityAnchorHash !== undefined) {
						const anchor = await client.getBlock({ blockNumber: cursor.finalityAnchorNumber })
						if (anchor.hash == null) throw new Error('Finality anchor block is missing its canonical hash')
						assertFinalityAnchor(cursor, cursor.finalityAnchorNumber, anchor.hash)
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
								recordOperation(state, { category: 'transaction', details: undefined, level: 'error', message: 'Expired transaction monitoring failed closed', reason: message, reportId: position.reportId })
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
								recordOperation(state, { category: 'transaction', details: undefined, level: 'error', message: 'Position lifecycle failed closed', reason: message, reportId: position.reportId })
							}
						}
					}
					if (lifecycleProcessed) {
						state.lastError = nextError
						state.lastPollAt = new Date().toISOString()
						state.status = operatorStatusAfterPause(state.paused, true, nextError !== undefined)
						return config.once
					}
					const executionReady = positions.every(position => position.historyOutbox === undefined) && nextError === undefined
					const discoversReportsFromCoordinators = config.coordinatorAddresses.length !== 0
					cursor ??= initialCursor(blockNumber, discoversReportsFromCoordinators ? 0n : config.lookbackBlocks)
					const replacedMarketHead = await clearOrphanedDexEvidenceForHeadReplacement({ hash: cursor.lastHeadHash, number: cursor.lastHeadNumber }, { hash: blockHash, number: blockNumber }, state, previousBlockNumber =>
						canonicalBlockHashWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], 'previous market head', previousBlockNumber),
					)
					const scanCursor = cursorForHeadScan(cursor, blockNumber, blockHash, REORG_OVERLAP_BLOCKS)
					if (scanCursor === undefined) {
						state.lastError = nextError
						state.status = operatorStatusAfterPause(state.paused, true, nextError !== undefined)
						state.blockNumber = blockNumber.toString()
						state.blockTimestamp = block.timestamp.toString()
						return config.once
					}
					if (discoversReportsFromCoordinators) {
						const pendingReports = config.execute ? await pendingCoordinatorReportsWithQuorum(readClients, config, blockNumber) : await pendingCoordinatorReports(client, config, blockNumber)
						applyCoordinatorReports(reports, pendingReports)
						cachedLogs = []
					} else {
						const ranges = scanRanges(scanCursor, blockNumber, MAX_LOG_SCAN_RANGE)
						for (const range of ranges) {
							const logs = await client.getLogs({
								address: config.openOracle,
								fromBlock: range.fromBlock,
								toBlock: range.toBlock,
								topics: [[OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC]],
							})
							cachedLogs = replaceOverlap(cachedLogs, logs, range.fromBlock, logBlockNumber, compareLogs)
							reports.clear()
							applyLogs(reports, cachedLogs)
							cachedLogs = retainReportsAndLogs(reports, cachedLogs, coordinatorPolicies, config.openOracle, range.toBlock)
						}
					}
					if (replacedMarketHead) {
						cursor = await advanceCursorAfterSuccessfulHead(blockNumber, blockHash, async () => {})
						const finalityAnchorNumber = blockNumber > REORG_OVERLAP_BLOCKS ? blockNumber - REORG_OVERLAP_BLOCKS : 0n
						const finalityAnchor = await client.getBlock({ blockNumber: finalityAnchorNumber })
						if (finalityAnchor.hash == null) throw new Error('Finality anchor block is missing its canonical hash')
						cursor = withFinalityAnchor(cursor, finalityAnchorNumber, finalityAnchor.hash)
						state.activeReportCount = [...reports.values()].filter(report => !report.settled).length
						state.blockNumber = blockNumber.toString()
						state.blockTimestamp = block.timestamp.toString()
						state.lastPollAt = new Date().toISOString()
						state.reportPaths = discoversReportsFromCoordinators ? [] : [...reports.entries()].map(([id, report]) => ({ reportId: id.toString(), settled: report.settled, steps: report.steps }))
						recordOperation(state, {
							category: 'decision',
							details: `block=${blockNumber.toString()}`,
							level: 'warning',
							message: 'Market evidence reset after canonical head replacement',
							reason: 'DEX evidence from the replaced block was discarded; price-dependent evaluation resumes on the next poll',
							reportId: undefined,
						})
						state.lastError = nextError
						state.status = operatorStatusAfterPause(state.paused, true, nextError !== undefined)
						return config.once
					}
					let completedOpportunityCount = 0
					cursor = await advanceCursorAfterSuccessfulHead(blockNumber, blockHash, async () => {
						state.centralizedMarket = await observeCentralizedMarkets(config.centralizedMarkets, config.network.rep, config.network.chain.id)
						const configuredDexMarkets = await observeConstantProductMarkets(config.centralizedMarkets, config.network.rep, config.network.weth, async pair => {
							const [token0, token1, reserves] = await Promise.all([
								readContractAtBlock(client.transport, { address: pair, abi: constantProductPairAbi, functionName: 'token0' }, blockNumber),
								readContractAtBlock(client.transport, { address: pair, abi: constantProductPairAbi, functionName: 'token1' }, blockNumber),
								readContractAtBlock(client.transport, { address: pair, abi: constantProductPairAbi, functionName: 'getReserves' }, blockNumber),
							])
							const reserveValues = requiredTuple(reserves, 2, 'Constant-product reserves')
							return {
								blockHash,
								blockNumber,
								blockTimestamp: block.timestamp,
								chainId: config.network.chain.id,
								reserve0: requiredBigint(reserveValues[0], 'Constant-product reserve0'),
								reserve1: requiredBigint(reserveValues[1], 'Constant-product reserve1'),
								token0: getAddress(String(token0)),
								token1: getAddress(String(token1)),
							}
						})
						try {
							await requireCanonicalBlock(blockNumber, blockHash, async canonicalBlockNumber => (await client.getBlock({ blockNumber: canonicalBlockNumber })).hash)
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
						await appendPriceHistory(config.priceHistoryFile, samples)
						state.priceHistory = [...state.priceHistory, ...samples]
						const pools = (await Promise.all(discoveredTokens.map(token => poolsForToken(client, config, token)))).flat()
						if (pools.length === 0) console.log('status=no-liquid-rep-weth-v3-pool')
						const balances = await loadBalances(client, wallet, config, pools, discoveredTokens)
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
									(message, reason) => recordOperation(state, { category: 'decision', details: undefined, level: 'info', message, reason, reportId }),
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
										const mismatch = candidateRiskMismatch(evaluated.candidate, positions, config.riskLimits, dateFromBlockTimestamp(block.timestamp))
										if (mismatch === undefined) candidates.push(evaluated.candidate)
										else {
											evaluated.opportunity.decision = 'risk-limit'
											recordOperation(state, { category: 'decision', details: undefined, level: 'warning', message: 'Risk limit blocked report', reason: mismatch, reportId: evaluated.opportunity.reportId })
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
								recordOperation(state, { category: 'decision', details: undefined, level: 'warning', message: 'Report evaluation failed', reason: message, reportId })
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
						state.reportPaths = discoversReportsFromCoordinators ? [] : [...reports.entries()].map(([id, report]) => ({ reportId: id.toString(), settled: report.settled, steps: report.steps }))
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
					})
					const finalityAnchorNumber = blockNumber > REORG_OVERLAP_BLOCKS ? blockNumber - REORG_OVERLAP_BLOCKS : 0n
					const finalityAnchor = await client.getBlock({ blockNumber: finalityAnchorNumber })
					if (finalityAnchor.hash == null) throw new Error('Finality anchor block is missing its canonical hash')
					cursor = withFinalityAnchor(cursor, finalityAnchorNumber, finalityAnchor.hash)
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
					state.lastError = nextError
					state.status = operatorStatusAfterPause(state.paused, true, nextError !== undefined)
					recordOperation(state, { category: 'scan', details: `${state.activeReportCount.toString()} active reports; ${completedOpportunityCount.toString()} opportunities`, level: nextError === undefined ? 'info' : 'warning', message: 'Scan completed', reason: `Block ${blockNumber.toString()}`, reportId: undefined })
					return config.once
				} finally {
					try {
						signerOperationGate.release('scan')
					} finally {
						await scanIntentLock.release()
					}
				}
			},
			consecutiveFailures => Bun.sleep(retryDelayMilliseconds(config.pollMilliseconds, consecutiveFailures)),
			config.once,
			error => {
				const message = errorMessage(error)
				state.rpcEndpointHealth = readPool.snapshot()
				state.lastError = message
				state.status = operationalFailureDisposition(error) === 'connectivity-degraded' ? 'connectivity-degraded' : 'error'
				recordOperation(state, { category: 'scan', details: undefined, level: 'error', message: 'Scan failed', reason: message, reportId: undefined })
				console.error(`pollFailed=${message}`)
			},
		)
	} finally {
		state.status = 'stopped'
		dashboard?.stop()
	}
}

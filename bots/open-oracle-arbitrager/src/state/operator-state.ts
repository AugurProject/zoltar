import type { UniverseIdentity } from '@zoltar/bot-shared/monitoring/universe-policy'
import type { MissingContractDeployment } from '@zoltar/bot-shared/monitoring/deployed-contracts'
import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { bigintToSafeNumber, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import type { OpenOracleGame } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { validateDeploymentSettings, type DeploymentSettings } from '#config/deployment-settings'
import type { CanonicalDeploymentStatus } from '#config/runtime-deployment'
import type { ExecutorDeploymentRecoveryStatus } from '#state/executor-deployment-recovery'
import type { ConnectivitySettings, EndpointCheck, NetworkName } from '#monitoring/connectivity'
import type { SubmissionSettings, SubmissionTargetResult } from '#execution/transaction-submission'
import type { OpportunitySnapshot } from '#state/opportunity-snapshot'
import type { SettlementSnapshot } from '#state/settlement-store'
import { parseExecutionRecord, type ExecutionRecord } from '#state/execution-record'
import type { MarketPricePoint, TokenMarketSnapshot } from '#monitoring/market-monitor'
import { archivedUtcDayGasSpentWeth, emptyPositionJournalArchive, type PositionJournalArchive, type PositionRecord } from '#state/position-store'
import { positionConsumesRisk, utcDayGasSpentWeth, type RiskLimits } from '#core/safety-controls'
import { serializeCentralizedMarketEstimate, type CentralizedMarketEstimate } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { serializeMarketConsensusEstimate, type MarketConsensusEstimate } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { RpcEndpointHealth } from '@zoltar/bot-shared/ethereum'

type ExecutionHistoryFileHandle = {
	appendFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
	chmod: (mode: number) => Promise<unknown>
	close: () => Promise<unknown>
	sync: () => Promise<unknown>
}

export type ExecutionHistoryFilesystem = {
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'a' | 'r', mode?: number) => Promise<ExecutionHistoryFileHandle>
	readFile: (path: string, encoding: 'utf8') => Promise<string>
}

const executionHistoryFilesystem: ExecutionHistoryFilesystem = {
	mkdir,
	open,
	readFile,
}

export type StrategySettings = {
	maxSpotTwapTicks: string
	minimumProfitBps: string
	minimumProfitWeth: string
	minimumRemainingBlocks: string
	minimumRemainingSeconds: string
	pollMilliseconds: number
	twapSeconds: number
}

export type MutableStrategy = {
	maxSpotTwapTicks: bigint
	minimumProfitBps: bigint
	minimumProfitAttoWeth: bigint
	minimumRemainingBlocks: bigint
	minimumRemainingSeconds: bigint
	pollMilliseconds: number
	twapSeconds: number
}

export type BalanceSnapshot = {
	availableEth: string
	availableRep: string
	availableWeth: string
	repValueWeth: string | undefined
	totalValueWeth: string | undefined
}

export type GameCapitalSnapshot = {
	eth: string
	totalEthWeth: string
	weth: string
}

export type DisputeStepSnapshot = {
	amount1: string | undefined
	amount2: string | undefined
	blockNumber: string
	event: 'disputed' | 'settled' | 'submitted'
	reporter: Address | undefined
	transactionHash: Hex | undefined
}

type ReportPathSnapshot = {
	reportId: string
	settled: boolean
	steps: readonly DisputeStepSnapshot[]
}

export type TransactionActivity = {
	acceptedTargets: readonly string[]
	actualGasCostEth: string | undefined
	estimatedNetProfitEth: string | undefined
	failedTargets: readonly SubmissionTargetResult[]
	hash: Hex
	kind: 'approval-token' | 'approval-weth' | 'canonical-head' | 'dispute' | 'settle' | 'withdraw-replacement' | 'withdraw-reward' | 'withdraw-token' | 'withdraw-weth'
	mode: SubmissionSettings['mode']
	originalHash: Hex
	reportId: string | undefined
	status: 'confirmation-unknown' | 'confirmed' | 'pending' | 'reverted' | 'submission-failed' | 'submitting'
	submittedAt: string
	trackedNetProfitEth: string | undefined
	token: Address | undefined
	tokenSymbol: string | undefined
	updatedAt: string
}

export type OperationEntry = {
	category: 'configuration' | 'decision' | 'scan' | 'transaction'
	details: string | undefined
	level: 'error' | 'info' | 'warning'
	message: string
	reason: string | undefined
	reportId: string | undefined
	timestamp: string
}

export type PublicOperationEntry = Omit<OperationEntry, 'details' | 'reason'> & {
	details?: string | undefined
	reason?: string | undefined
}

export type MarketAvailabilityNotice = ({ kind: 'missing-deployment' } & MissingContractDeployment) | { kind: 'no-execution-pools'; chainId: number }

type PollStatus = {
	canonicalDeployments?: CanonicalDeploymentStatus | undefined
	marketAvailability?: MarketAvailabilityNotice | undefined
	lastError: string | undefined
	lastPollAt: string | undefined
	lastPollFailureAt?: string | undefined
	lastRetryAt?: string | undefined
	nextRetryAt?: string | undefined
	retryInProgress?: boolean | undefined
}

export type OperatorSnapshot = PollStatus & {
	activeReportCount: number
	consecutivePollFailures?: number | undefined
	balances: BalanceSnapshot | undefined
	blockNumber: string | undefined
	blockTimestamp: string | undefined
	centralizedMarket?: ReturnType<typeof serializeCentralizedMarketEstimate>
	marketConsensus?: ReturnType<typeof serializeMarketConsensusEstimate>
	execute: boolean
	executor: Address | undefined
	executorDeploymentRecovery?: ExecutorDeploymentRecoveryStatus | undefined
	executionHistory: readonly ExecutionRecord[]
	executionHistoryRecordCount: number
	positionRecordCount: number
	expectedChainId: number
	explorerUrl: string
	endpointChecks: readonly EndpointCheck[]
	rpcEndpointHealth?: readonly RpcEndpointHealth[] | undefined
	gameCapital: GameCapitalSnapshot
	mode: 'dry-run' | 'execute'
	network: NetworkName
	networkConfigured: boolean
	openOracle: Address
	operatorCapable: boolean
	operationLog: readonly OperationEntry[]
	opportunities: readonly OpportunitySnapshot[]
	positions: readonly PositionRecord[]
	paused: boolean
	queuedSettings: readonly QueuedSettingsSection[]
	queuedWallet: Address | null | undefined
	savedWallet: Address | undefined
	settings: StrategySettings
	status: 'connectivity-degraded' | 'error' | 'paused' | 'running' | 'stopped' | 'syncing'
	submission: SubmissionSettings
	universes?: readonly { id: string; parentId: string | undefined; outcomeIndex: string | undefined; repToken: Address }[] | undefined
	tokenAddresses: readonly Address[]
	tokenMarkets: readonly TokenMarketSnapshot[]
	priceHistory: readonly MarketPricePoint[]
	reportPaths: readonly ReportPathSnapshot[]
	risk: {
		limits: {
			lifecycleGasReserveWeth: string
			maxConcurrentPositions: number
			maxDailyGasSpendWeth: string
			maxPositionNotionalWeth: string
			maxTotalLockedWeth: string
		}
		usage: {
			dailyGasSpentWeth: string
			lockedWeth: string
			openPositions: number
			remainingDailyGasWeth: string
			remainingLockedWeth: string
		}
	}
	connectivity: ConnectivitySettings
	deployment: DeploymentSettings
	totalActualGasCostEth: string
	totalEstimatedNetProfitEth: string
	totalEstimatedNetProfitWeth: string
	totalRevenueBeforeGasEth: string
	totalHedgedProfitBeforeGasEth: string
	totalOpenHedgedNetProfitEth: string
	totalRealizedNetProfitEth: string
	totalTrackedNetProfitEth: string
	settlements: SettlementSnapshot
	transactionActivity: readonly TransactionActivity[]
	updatedAt: string
	wallet: Address | undefined
}

export type PublicExecutionRecord = Pick<ExecutionRecord, 'actualGasCostEth' | 'direction' | 'estimatedNetProfitWeth' | 'executedAt' | 'reportId' | 'requiredToken' | 'requiredWeth' | 'tokenSymbol' | 'trackedNetProfitEth' | 'transactionHash'>

export type PublicPositionRecord = Pick<
	PositionRecord,
	'actualEntryGasCostEth' | 'direction' | 'entryTransactionHash' | 'hedgedProfitBeforeGasEth' | 'lifecycleGasCostEth' | 'lifecycleReceiptRecovered' | 'lifecycleSettlerRewardEth' | 'openedAt' | 'realizedNetProfitEth' | 'reportId' | 'status' | 'tokenSymbol' | 'withdrawnToken' | 'withdrawnWeth'
> & {
	hasLifecycleTransactions: boolean
	manuallyReconciled: boolean
}

export type PublicTransactionActivity = Pick<TransactionActivity, 'acceptedTargets' | 'actualGasCostEth' | 'estimatedNetProfitEth' | 'hash' | 'kind' | 'mode' | 'reportId' | 'status' | 'tokenSymbol' | 'trackedNetProfitEth' | 'updatedAt'> & {
	failedTargets: readonly SubmissionTargetResult[]
}

export type PublicOperatorSnapshot = PollStatus &
	Pick<OperatorSnapshot, 'universes' | 'tokenAddresses' | 'tokenMarkets' | 'priceHistory'> & {
		activeReportCount: number
		consecutivePollFailures?: number | undefined
		balances: BalanceSnapshot | undefined
		blockNumber: string | undefined
		blockTimestamp: string | undefined
		centralizedMarket?: ReturnType<typeof serializeCentralizedMarketEstimate>
		marketConsensus?: ReturnType<typeof serializeMarketConsensusEstimate>
		execute: boolean
		executor: Address | undefined
		executorDeploymentRecovery?: ExecutorDeploymentRecoveryStatus | undefined
		coordinatorAddresses: readonly Address[]
		executionHistory: readonly PublicExecutionRecord[]
		executionHistoryRecordCount: number
		positionRecordCount: number
		expectedChainId: number
		explorerUrl: string
		endpointChecks: readonly EndpointCheck[]
		rpcEndpointHealth?: readonly RpcEndpointHealth[] | undefined
		gameCapital: GameCapitalSnapshot
		mode: 'dry-run' | 'execute'
		network: NetworkName
		networkConfigured: boolean
		openOracle: Address
		operatorCapable: boolean
		operationLog: readonly PublicOperationEntry[]
		opportunities: readonly OpportunitySnapshot[]
		positions: readonly PublicPositionRecord[]
		paused: boolean
		queuedSettings: readonly QueuedSettingsSection[]
		queuedWallet: Address | null | undefined
		savedWallet: Address | undefined
		status: OperatorSnapshot['status']
		submission: Pick<SubmissionSettings, 'minimumBundleRelaySuccesses' | 'mode'>
		reportPaths: readonly ReportPathSnapshot[]
		risk: {
			limits: OperatorSnapshot['risk']['limits']
			usage: Pick<OperatorSnapshot['risk']['usage'], 'dailyGasSpentWeth' | 'lockedWeth' | 'openPositions'>
		}
		totalActualGasCostEth: string
		totalHedgedProfitBeforeGasEth: string
		totalOpenHedgedNetProfitEth: string
		totalRealizedNetProfitEth: string
		settlements: SettlementSnapshot
		transactionActivity: readonly PublicTransactionActivity[]
		wallet: Address | undefined
	}

export type OperatorState = PollStatus & {
	activeReportCount: number
	consecutivePollFailures?: number | undefined
	balances: BalanceSnapshot | undefined
	blockNumber: string | undefined
	blockTimestamp: string | undefined
	centralizedMarket?: CentralizedMarketEstimate | undefined
	marketConsensus?: MarketConsensusEstimate | undefined
	marketObservations?: MarketConsensusObservation[] | undefined
	executionHistory: ExecutionRecord[]
	endpointChecks: EndpointCheck[]
	rpcEndpointHealth?: readonly RpcEndpointHealth[] | undefined
	gameCapital: GameCapitalSnapshot
	opportunities: OpportunitySnapshot[]
	positions: PositionRecord[]
	positionArchive?: PositionJournalArchive | undefined
	operationLog: OperationEntry[]
	paused: boolean
	status: OperatorSnapshot['status']
	universes?: UniverseIdentity[] | undefined
	tokenAddresses: Address[]
	tokenMarkets: TokenMarketSnapshot[]
	priceHistory: MarketPricePoint[]
	reportPaths: ReportPathSnapshot[]
	settlements: SettlementSnapshot
	transactionActivity: TransactionActivity[]
}

export function recordOperation(state: Pick<OperatorState, 'operationLog'>, entry: Omit<OperationEntry, 'timestamp'> & { timestamp?: string | undefined }) {
	state.operationLog = [{ ...entry, timestamp: entry.timestamp ?? new Date().toISOString() }, ...state.operationLog].slice(0, 500)
}

export function clearWalletDerivedState(state: OperatorState) {
	state.balances = undefined
	state.opportunities = []
}

export function parseDecimalWeth(value: string) {
	if (!/^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`Invalid WETH amount: ${value}`)
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

export function parseSignedDecimalEth(value: string) {
	if (!/^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/.test(value)) throw new Error(`Invalid ETH amount: ${value}`)
	const negative = value.startsWith('-')
	const unsigned = negative ? value.slice(1) : value
	const parsed = parseDecimalWeth(unsigned)
	return negative ? -parsed : parsed
}

export function strategySettings(strategy: MutableStrategy): StrategySettings {
	return {
		maxSpotTwapTicks: strategy.maxSpotTwapTicks.toString(),
		minimumProfitBps: strategy.minimumProfitBps.toString(),
		minimumProfitWeth: decimalWeth(strategy.minimumProfitAttoWeth),
		minimumRemainingBlocks: strategy.minimumRemainingBlocks.toString(),
		minimumRemainingSeconds: strategy.minimumRemainingSeconds.toString(),
		pollMilliseconds: strategy.pollMilliseconds,
		twapSeconds: strategy.twapSeconds,
	}
}

export function decimalWeth(value: bigint) {
	const whole = value / 10n ** 18n
	const fraction = value % 10n ** 18n
	if (fraction === 0n) return whole.toString()
	return `${whole.toString()}.${fraction.toString().padStart(18, '0').replace(/0+$/, '')}`
}

export function decimalSignedEth(value: bigint) {
	return value < 0n ? `-${decimalWeth(-value)}` : decimalWeth(value)
}

export function gameCapitalSnapshot(games: readonly Pick<OpenOracleGame, 'currentAmount1' | 'currentAmount2' | 'settlerRewardAttoEth' | 'token1' | 'token2'>[], weth: Address): GameCapitalSnapshot {
	let eth = 0n
	let wethAmount = 0n
	for (const game of games) {
		eth += game.settlerRewardAttoEth
		if (game.token1.toLowerCase() === '0x0000000000000000000000000000000000000000') eth += game.currentAmount1
		if (game.token2.toLowerCase() === '0x0000000000000000000000000000000000000000') eth += game.currentAmount2
		if (game.token1.toLowerCase() === weth.toLowerCase()) wethAmount += game.currentAmount1
		if (game.token2.toLowerCase() === weth.toLowerCase()) wethAmount += game.currentAmount2
	}
	return {
		eth: decimalWeth(eth),
		totalEthWeth: decimalWeth(eth + wethAmount),
		weth: decimalWeth(wethAmount),
	}
}

export async function loadExecutionHistory(path: string, expectedChainId: number, filesystem: ExecutionHistoryFilesystem = executionHistoryFilesystem) {
	if (!Number.isSafeInteger(expectedChainId) || expectedChainId < 1) throw new Error('Expected execution history chain ID must be a positive integer')
	try {
		const contents = await filesystem.readFile(path, 'utf8')
		const records: ExecutionRecord[] = []
		for (const [index, line] of contents.split('\n').entries()) {
			if (line.trim() === '') continue
			let parsed: unknown
			try {
				parsed = JSON.parse(line)
			} catch (error) {
				if (error instanceof SyntaxError) throw new Error(`Invalid execution history line ${(index + 1).toString()}: ${error.message}`)
				throw error
			}
			if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Reflect.get(parsed, 'chainId') !== expectedChainId) throw new Error(`Execution history record at line ${(index + 1).toString()} belongs to another chain`)
			const record = parseExecutionRecord(Reflect.get(parsed, 'record'))
			if (record === undefined) throw new Error(`Invalid execution history record at line ${(index + 1).toString()}`)
			records.push(record)
		}
		const unique = new Map<string, ExecutionRecord>()
		for (const record of records) unique.set(record.transactionHash.toLowerCase(), record)
		return [...unique.values()].reverse()
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return []
		throw error
	}
}

async function syncExecutionHistoryDirectory(path: string, filesystem: ExecutionHistoryFilesystem) {
	const directoryHandle = await filesystem.open(dirname(path), 'r')
	try {
		await directoryHandle.sync()
	} finally {
		await directoryHandle.close()
	}
}

async function appendExecutionHistory(path: string, record: ExecutionRecord, chainId: number, filesystem: ExecutionHistoryFilesystem = executionHistoryFilesystem) {
	if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error('Execution history chain ID must be a positive integer')
	await filesystem.mkdir(dirname(path), { mode: 0o700, recursive: true })
	const handle = await filesystem.open(path, 'a', 0o600)
	try {
		await handle.chmod(0o600)
		await handle.appendFile(`${JSON.stringify({ chainId, record })}\n`, { encoding: 'utf8' })
		await handle.sync()
	} finally {
		await handle.close()
	}
	await syncExecutionHistoryDirectory(path, filesystem)
}

export async function appendExecutionHistoryIfMissing(path: string, record: ExecutionRecord, chainId: number, filesystem: ExecutionHistoryFilesystem = executionHistoryFilesystem) {
	const history = await loadExecutionHistory(path, chainId, filesystem)
	if (history.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) return false
	await appendExecutionHistory(path, record, chainId, filesystem)
	return true
}

export async function ensureExecutionHistoryWritable(path: string, filesystem: ExecutionHistoryFilesystem = executionHistoryFilesystem) {
	await filesystem.mkdir(dirname(path), { mode: 0o700, recursive: true })
	const handle = await filesystem.open(path, 'a', 0o600)
	try {
		await handle.chmod(0o600)
		await handle.sync()
	} finally {
		await handle.close()
	}
	await syncExecutionHistoryDirectory(path, filesystem)
}

function sumDecimalWeth(records: readonly ExecutionRecord[], field: 'actualGasCostEth' | 'estimatedNetProfitWeth' | 'estimatedProfitBeforeGasEth') {
	return decimalWeth(records.reduce((total, record) => total + parseDecimalWeth(record[field]), 0n))
}

function sumSignedEth(records: readonly ExecutionRecord[], field: 'trackedNetProfitEth') {
	return decimalSignedEth(records.reduce((total, record) => total + parseSignedDecimalEth(record[field]), 0n))
}

function positionTotals(positions: readonly PositionRecord[], archived: PositionJournalArchive = emptyPositionJournalArchive()) {
	let hedgedProfit = parseSignedDecimalEth(archived.hedgedProfitBeforeGasEth)
	let openHedgedNet = 0n
	let realized = parseSignedDecimalEth(archived.realizedNetProfitEth)
	for (const position of positions) {
		if (position.status === 'closed' && position.realizedNetProfitEth !== undefined) {
			realized += parseSignedDecimalEth(position.realizedNetProfitEth)
		}
		// A zero entry-gas value is the durable marker for a staged entry whose
		// receipts and executor event have not yet reached RPC quorum.
		const awaitingLifecycleEvidence = position.lifecycleTransactionHashes.length !== 0 && !position.lifecycleReceiptRecovered
		if (position.actualEntryGasCostEth === '0' || awaitingLifecycleEvidence) continue
		const hedged = parseSignedDecimalEth(position.hedgedProfitBeforeGasEth)
		hedgedProfit += hedged
		if (positionConsumesRisk(position.status)) openHedgedNet += hedged - parseDecimalWeth(position.actualEntryGasCostEth) - parseDecimalWeth(position.lifecycleGasCostEth)
	}
	return {
		hedgedProfit: decimalSignedEth(hedgedProfit),
		openHedgedNet: decimalSignedEth(openHedgedNet),
		realized: decimalSignedEth(realized),
	}
}

/** Operator-file sections with a saved change waiting for the next scan boundary; drives the Settings "Queued" badges. */
export type QueuedSettingsSection = 'connectivity' | 'deployment' | 'execution' | 'markets' | 'risk' | 'settlement' | 'strategy' | 'submission' | 'universes'

export type OperatorSnapshotFixedState = {
	deployment?: DeploymentSettings | undefined
	execute: boolean
	executor: Address | undefined
	executorDeploymentRecovery?: ExecutorDeploymentRecoveryStatus | undefined
	expectedChainId: number
	explorerUrl: string
	network: NetworkName
	networkConfigured?: boolean | undefined
	openOracle: Address
	queuedWallet: Address | null | undefined
	savedWallet: Address | undefined
	wallet: Address | undefined
}

export function operatorSnapshot(
	state: OperatorState,
	strategy: MutableStrategy,
	submission: SubmissionSettings,
	connectivity: ConnectivitySettings,
	fixed: OperatorSnapshotFixedState,
	riskLimits: RiskLimits = {
		lifecycleGasReserveAttoWeth: 10n ** 16n,
		maxConcurrentPositions: 1,
		maxDailyGasSpendAttoWeth: 5n * 10n ** 16n,
		maxPositionNotionalAttoWeth: 5n * 10n ** 18n,
		maxTotalLockedAttoWeth: 10n * 10n ** 18n,
	},
	queuedSettings: readonly QueuedSettingsSection[] = [],
): OperatorSnapshot {
	const archived = state.positionArchive ?? emptyPositionJournalArchive()
	const totals = positionTotals(state.positions, archived)
	const openPositions = state.positions.filter(position => positionConsumesRisk(position.status))
	const lockedAttoWeth = openPositions.reduce((total, position) => total + parseDecimalWeth(position.capitalAtRiskWeth), 0n)
	const riskNow = state.blockTimestamp === undefined ? new Date() : new Date(bigintToSafeNumber(BigInt(state.blockTimestamp) * 1_000n, 'Operator block timestamp'))
	const dailyGasSpentAttoWeth = utcDayGasSpentWeth(state.positions, riskNow) + archivedUtcDayGasSpentWeth(archived, riskNow) + parseDecimalWeth(state.settlements.utcDayGasSpentEth)
	return {
		activeReportCount: state.activeReportCount,
		consecutivePollFailures: state.consecutivePollFailures ?? 0,
		balances: state.balances,
		blockNumber: state.blockNumber,
		blockTimestamp: state.blockTimestamp,
		canonicalDeployments: state.canonicalDeployments,
		centralizedMarket: serializeCentralizedMarketEstimate(state.centralizedMarket),
		marketConsensus: serializeMarketConsensusEstimate(state.marketConsensus, decimalWeth),
		execute: fixed.execute,
		executor: fixed.executor,
		executorDeploymentRecovery: fixed.executorDeploymentRecovery,
		executionHistory: state.executionHistory.slice(0, 500),
		executionHistoryRecordCount: state.executionHistory.length,
		positionRecordCount: state.positions.length + archived.positionCount,
		expectedChainId: fixed.expectedChainId,
		explorerUrl: fixed.explorerUrl,
		endpointChecks: state.endpointChecks,
		rpcEndpointHealth: state.rpcEndpointHealth ?? [],
		gameCapital: state.gameCapital,
		marketAvailability: state.marketAvailability,
		lastError: state.lastError,
		lastPollAt: state.lastPollAt,
		lastPollFailureAt: state.lastPollFailureAt,
		lastRetryAt: state.lastRetryAt,
		nextRetryAt: state.nextRetryAt,
		retryInProgress: state.retryInProgress,
		mode: fixed.execute ? 'execute' : 'dry-run',
		network: fixed.network,
		networkConfigured: fixed.networkConfigured ?? true,
		openOracle: fixed.openOracle,
		operatorCapable: state.status === 'running' && state.lastPollAt !== undefined && state.blockNumber !== undefined && !state.paused && state.lastError === undefined && (fixed.execute === false || fixed.wallet !== undefined),
		opportunities: state.opportunities,
		positions: state.positions.slice(0, 500),
		operationLog: state.operationLog,
		paused: state.paused,
		queuedSettings,
		queuedWallet: fixed.queuedWallet,
		savedWallet: fixed.savedWallet,
		settings: strategySettings(strategy),
		status: state.status,
		submission,
		universes: state.universes?.map(universe => ({ id: universe.id.toString(), parentId: universe.parentId?.toString(), outcomeIndex: universe.outcomeIndex?.toString(), repToken: universe.repToken })),
		tokenAddresses: state.tokenAddresses,
		tokenMarkets: state.tokenMarkets,
		priceHistory: state.priceHistory,
		reportPaths: state.reportPaths,
		risk: {
			limits: {
				lifecycleGasReserveWeth: decimalWeth(riskLimits.lifecycleGasReserveAttoWeth),
				maxConcurrentPositions: riskLimits.maxConcurrentPositions,
				maxDailyGasSpendWeth: decimalWeth(riskLimits.maxDailyGasSpendAttoWeth),
				maxPositionNotionalWeth: decimalWeth(riskLimits.maxPositionNotionalAttoWeth),
				maxTotalLockedWeth: decimalWeth(riskLimits.maxTotalLockedAttoWeth),
			},
			usage: {
				dailyGasSpentWeth: decimalWeth(dailyGasSpentAttoWeth),
				lockedWeth: decimalWeth(lockedAttoWeth),
				openPositions: openPositions.length,
				remainingDailyGasWeth: decimalWeth(dailyGasSpentAttoWeth >= riskLimits.maxDailyGasSpendAttoWeth ? 0n : riskLimits.maxDailyGasSpendAttoWeth - dailyGasSpentAttoWeth),
				remainingLockedWeth: decimalWeth(lockedAttoWeth >= riskLimits.maxTotalLockedAttoWeth ? 0n : riskLimits.maxTotalLockedAttoWeth - lockedAttoWeth),
			},
		},
		connectivity,
		deployment: fixed.deployment ?? validateDeploymentSettings({ coordinatorAddresses: [], executor: fixed.executor, quorumRpcUrls: [], uniswapV2Enabled: false, uniswapV3Enabled: false, uniswapV4Enabled: false }, fixed.network),
		totalActualGasCostEth: sumDecimalWeth(state.executionHistory, 'actualGasCostEth'),
		totalEstimatedNetProfitEth: sumDecimalWeth(state.executionHistory, 'estimatedNetProfitWeth'),
		totalEstimatedNetProfitWeth: sumDecimalWeth(state.executionHistory, 'estimatedNetProfitWeth'),
		totalRevenueBeforeGasEth: sumDecimalWeth(state.executionHistory, 'estimatedProfitBeforeGasEth'),
		totalHedgedProfitBeforeGasEth: totals.hedgedProfit,
		totalOpenHedgedNetProfitEth: totals.openHedgedNet,
		totalRealizedNetProfitEth: totals.realized,
		totalTrackedNetProfitEth: sumSignedEth(state.executionHistory, 'trackedNetProfitEth'),
		settlements: state.settlements,
		transactionActivity: state.transactionActivity.slice(0, 100),
		updatedAt: new Date().toISOString(),
		wallet: fixed.wallet,
	}
}

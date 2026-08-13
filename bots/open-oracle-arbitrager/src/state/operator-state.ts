import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { bigintToSafeNumber, type Address, type Hex } from '#ethereum'
import type { OpenOracleGame } from '@zoltar/shared/openOracle'
import type { DeploymentSettings } from '#config/deployment-settings'
import type { ConnectivitySettings, EndpointCheck, NetworkName } from '#monitoring/connectivity'
import type { SubmissionSettings, SubmissionTargetResult } from '#execution/transaction-submission'
import type { Venue } from '#core/venue-strategy'
import type { MarketPricePoint, TokenMarketSnapshot } from '#monitoring/market-monitor'
import type { PositionRecord } from '#state/position-store'
import { positionConsumesRisk, utcDayGasSpentWeth, type RiskLimits } from '#core/safety-controls'
import { serializeCentralizedMarketEstimate, type CentralizedMarketEstimate } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { serializeMarketConsensusEstimate, type MarketConsensusEstimate } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { MarketConsensusObservation } from '@zoltar/bot-shared/monitoring/market-consensus'

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

export type ReportPathSnapshot = {
	reportId: string
	settled: boolean
	steps: readonly DisputeStepSnapshot[]
}

export type OpportunitySnapshot = {
	centralizedPriceDeviationBps: string | undefined
	decision: 'dry-run-opportunity' | 'eligible' | 'execution-failed' | 'history-unavailable' | 'insufficient-inventory' | 'market-risk' | 'paused' | 'risk-limit' | 'selected' | 'self-report' | 'signer-unavailable' | 'submitted' | 'unprofitable'
	direction: 'buy-rep' | 'sell-rep'
	estimatedNetProfitWeth: string
	estimatedNetProfitEth: string
	executablePriceRepPerEth: string
	hasRequiredInventory: boolean | undefined
	pool: Address
	poolFee: number
	reportId: string
	requiredToken: string
	requiredWeth: string
	token: Address
	tokenSymbol: string
	timeRemaining: string
	venue?: Venue | undefined
	windowUnit: 'blocks' | 'seconds'
}

export type ExecutionRecord = {
	actualGasCostEth: string
	blockNumber: string
	direction: 'buy-rep' | 'sell-rep'
	estimatedNetProfitWeth: string
	estimatedProfitBeforeGasEth: string
	executedAt: string
	pool: Address
	poolFee: number
	reportId: string
	requiredToken: string
	requiredWeth: string
	token: Address
	tokenSymbol: string
	trackedNetProfitEth: string
	transactionHash: Hex
}

export type TransactionActivity = {
	acceptedTargets: readonly string[]
	actualGasCostEth: string | undefined
	estimatedNetProfitEth: string | undefined
	failedTargets: readonly SubmissionTargetResult[]
	hash: Hex
	kind: 'approval-token' | 'approval-weth' | 'canonical-head' | 'dispute' | 'settle' | 'withdraw-replacement' | 'withdraw-token' | 'withdraw-weth'
	mode: SubmissionSettings['mode']
	originalHash: Hex
	reportId: string
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

export type OperatorSnapshot = {
	activeReportCount: number
	balances: BalanceSnapshot | undefined
	blockNumber: string | undefined
	blockTimestamp: string | undefined
	centralizedMarket?: ReturnType<typeof serializeCentralizedMarketEstimate>
	marketConsensus?: ReturnType<typeof serializeMarketConsensusEstimate>
	execute: boolean
	executor: Address | undefined
	executionHistory: readonly ExecutionRecord[]
	executionHistoryRecordCount: number
	positionRecordCount: number
	expectedChainId: number
	explorerUrl: string
	endpointChecks: readonly EndpointCheck[]
	gameCapital: GameCapitalSnapshot
	lastError: string | undefined
	lastPollAt: string | undefined
	mode: 'dry-run' | 'execute'
	network: NetworkName
	networkConfigured: boolean
	openOracle: Address
	operationLog: readonly OperationEntry[]
	opportunities: readonly OpportunitySnapshot[]
	positions: readonly PositionRecord[]
	paused: boolean
	queuedWallet: Address | null | undefined
	savedWallet: Address | undefined
	settings: StrategySettings
	status: 'error' | 'paused' | 'running' | 'stopped' | 'syncing'
	submission: SubmissionSettings
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
	transactionActivity: readonly TransactionActivity[]
	updatedAt: string
	wallet: Address | undefined
}

export type OperatorState = {
	activeReportCount: number
	balances: BalanceSnapshot | undefined
	blockNumber: string | undefined
	blockTimestamp: string | undefined
	centralizedMarket?: CentralizedMarketEstimate | undefined
	marketConsensus?: MarketConsensusEstimate | undefined
	marketObservations?: MarketConsensusObservation[] | undefined
	executionHistory: ExecutionRecord[]
	endpointChecks: EndpointCheck[]
	gameCapital: GameCapitalSnapshot
	lastError: string | undefined
	lastPollAt: string | undefined
	opportunities: OpportunitySnapshot[]
	positions: PositionRecord[]
	operationLog: OperationEntry[]
	paused: boolean
	status: OperatorSnapshot['status']
	tokenAddresses: Address[]
	tokenMarkets: TokenMarketSnapshot[]
	priceHistory: MarketPricePoint[]
	reportPaths: ReportPathSnapshot[]
	transactionActivity: TransactionActivity[]
}

const GENERIC_PUBLIC_FAILURE = 'The operation returned an unexpected error. Automatic retry remains active; check protected bot logs for details.'

export function publicOperatorFailure(error: string, fallback = GENERIC_PUBLIC_FAILURE) {
	const normalized = error.toLowerCase()
	if (normalized.includes('rpc') || normalized.includes('chain') || normalized.includes('block')) return 'RPC connectivity or canonical chain reads failed. Automatic retry remains active.'
	if (normalized.includes('market') || normalized.includes('price') || normalized.includes('quote')) return 'Market evidence or price validation failed. Automatic retry remains active.'
	if (normalized.includes('transaction') || normalized.includes('receipt') || normalized.includes('relay')) return 'Transaction confirmation or delivery tracking failed. Review transaction activity while automatic retry remains active.'
	if (normalized.includes('persist') || normalized.includes('state') || normalized.includes('history')) return 'Durable operator state could not be verified. Review recovery state before resuming execution.'
	if (normalized.includes('risk') || normalized.includes('limit') || normalized.includes('policy')) return 'A risk or execution policy prevented this operation. Review the active risk envelope and protected bot logs.'
	return fallback
}

function publicInformationalOperationValue(value: string | undefined) {
	if (value === undefined) return undefined
	if (/^(?:[A-Za-z]:[\\/]|[/~.]\/)/.test(value) || /(?:api[_-]?key|authorization|bearer|password|secret|token)\s*[=:]\s*\S+/i.test(value)) return undefined
	const urlMatches = [...value.matchAll(/https?:\/\/[^\s,;)]+/gi)]
	for (const match of urlMatches) {
		try {
			const url = new URL(match[0])
			if (url.username !== '' || url.password !== '' || (url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') return undefined
		} catch (error) {
			void error
			return undefined
		}
	}
	const nonUrlValue = urlMatches.reduce((remaining, match) => remaining.replace(match[0], ''), value)
	if (/[\\/]/.test(nonUrlValue)) return undefined
	return value
}

function publicOperationEntry(entry: OperationEntry): OperationEntry {
	const publicEntry: OperationEntry = {
		category: entry.category,
		level: entry.level,
		message: entry.message,
		reportId: entry.reportId,
		timestamp: entry.timestamp,
	}
	if (entry.level !== 'info') {
		publicEntry.details = entry.details === undefined ? undefined : publicOperatorFailure(entry.details)
		publicEntry.reason = entry.reason === undefined ? undefined : publicOperatorFailure(entry.reason)
		return publicEntry
	}
	publicEntry.details = entry.category === 'configuration' && entry.message === 'Complete operator configuration saved' ? undefined : publicInformationalOperationValue(entry.details)
	publicEntry.reason = publicInformationalOperationValue(entry.reason)
	return publicEntry
}

export function publicOperatorSnapshot(snapshot: OperatorSnapshot): OperatorSnapshot {
	return {
		...snapshot,
		endpointChecks: snapshot.endpointChecks.map(check => ({ ...check, error: check.error === undefined ? undefined : publicOperatorFailure(check.error) })),
		lastError: snapshot.lastError === undefined ? undefined : publicOperatorFailure(snapshot.lastError),
		operationLog: snapshot.operationLog.map(publicOperationEntry),
		transactionActivity: snapshot.transactionActivity.map(activity => ({
			...activity,
			failedTargets: activity.failedTargets.map(target => ({ ...target, error: target.error === undefined ? undefined : publicOperatorFailure(target.error) })),
		})),
	}
}

export function recordOperation(state: OperatorState, entry: Omit<OperationEntry, 'timestamp'> & { timestamp?: string | undefined }) {
	state.operationLog = [{ ...entry, timestamp: entry.timestamp ?? new Date().toISOString() }, ...state.operationLog].slice(0, 500)
}

export function clearWalletDerivedState(state: OperatorState) {
	state.balances = undefined
	state.opportunities = []
}

const SETTING_LABELS = {
	maxSpotTwapTicks: 'Maximum spot/TWAP ticks',
	minimumProfitBps: 'Minimum return',
	minimumProfitWeth: 'Minimum profit',
	minimumRemainingBlocks: 'Minimum remaining blocks',
	minimumRemainingSeconds: 'Minimum remaining seconds',
	pollMilliseconds: 'Poll interval',
	twapSeconds: 'TWAP window',
} satisfies Record<keyof StrategySettings, string>

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

function requiredRecord(value: unknown) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Settings must be a JSON object')
	return value as Record<string, unknown>
}

function requiredDecimal(record: Record<string, unknown>, key: keyof StrategySettings) {
	const value = record[key]
	if (typeof value !== 'string') throw new Error(`${SETTING_LABELS[key]} must be a decimal value`)
	return value
}

function requiredInteger(record: Record<string, unknown>, key: keyof StrategySettings, minimum: number, maximum: number) {
	const value = record[key]
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) throw new Error(`${SETTING_LABELS[key]} must be an integer from ${minimum.toString()} to ${maximum.toString()}`)
	return value
}

function requiredBigInt(record: Record<string, unknown>, key: keyof StrategySettings, minimum: bigint, maximum: bigint) {
	const value = requiredDecimal(record, key)
	if (!/^(?:0|[1-9]\d*)$/.test(value)) throw new Error(`${SETTING_LABELS[key]} must be a non-negative integer`)
	const parsed = BigInt(value)
	if (parsed < minimum || parsed > maximum) throw new Error(`${SETTING_LABELS[key]} must be from ${minimum.toString()} to ${maximum.toString()}`)
	return parsed
}

export function updateStrategyFromRequest(strategy: MutableStrategy, value: unknown) {
	const record = requiredRecord(value)
	const allowed = new Set<keyof StrategySettings>(['maxSpotTwapTicks', 'minimumProfitBps', 'minimumProfitWeth', 'minimumRemainingBlocks', 'minimumRemainingSeconds', 'pollMilliseconds', 'twapSeconds'])
	for (const key of Object.keys(record)) {
		if (!allowed.has(key as keyof StrategySettings)) throw new Error(`Unknown strategy setting: ${key}`)
	}
	const expected = allowed.size
	if (Object.keys(record).length !== expected) throw new Error('Every strategy setting is required')
	const minimumProfitAttoWeth = parseDecimalWeth(requiredDecimal(record, 'minimumProfitWeth'))
	if (minimumProfitAttoWeth > 1_000n * 10n ** 18n) throw new Error('Minimum profit must not exceed 1000 WETH')
	const maxSpotTwapTicks = requiredBigInt(record, 'maxSpotTwapTicks', 0n, 100_000n)
	const minimumProfitBps = requiredBigInt(record, 'minimumProfitBps', 0n, 100_000n)
	const minimumRemainingBlocks = requiredBigInt(record, 'minimumRemainingBlocks', 1n, 1_000n)
	const minimumRemainingSeconds = requiredBigInt(record, 'minimumRemainingSeconds', 1n, 86_400n)
	const pollMilliseconds = requiredInteger(record, 'pollMilliseconds', 1_000, 3_600_000)
	const twapSeconds = requiredInteger(record, 'twapSeconds', 60, 86_400)
	strategy.maxSpotTwapTicks = maxSpotTwapTicks
	strategy.minimumProfitBps = minimumProfitBps
	strategy.minimumProfitAttoWeth = minimumProfitAttoWeth
	strategy.minimumRemainingBlocks = minimumRemainingBlocks
	strategy.minimumRemainingSeconds = minimumRemainingSeconds
	strategy.pollMilliseconds = pollMilliseconds
	strategy.twapSeconds = twapSeconds
	return strategySettings(strategy)
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

export function parseExecutionRecord(value: unknown): ExecutionRecord | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	const record = value as Record<string, unknown>
	const decimal = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/
	if (
		typeof record['actualGasCostEth'] !== 'string' ||
		!decimal.test(record['actualGasCostEth']) ||
		typeof record['blockNumber'] !== 'string' ||
		!/^(?:0|[1-9]\d*)$/.test(record['blockNumber']) ||
		(record['direction'] !== 'buy-rep' && record['direction'] !== 'sell-rep') ||
		typeof record['estimatedNetProfitWeth'] !== 'string' ||
		!decimal.test(record['estimatedNetProfitWeth']) ||
		typeof record['estimatedProfitBeforeGasEth'] !== 'string' ||
		!decimal.test(record['estimatedProfitBeforeGasEth']) ||
		typeof record['executedAt'] !== 'string' ||
		!Number.isFinite(Date.parse(record['executedAt'])) ||
		typeof record['pool'] !== 'string' ||
		!/^0x[0-9a-fA-F]{40}$/.test(record['pool']) ||
		typeof record['poolFee'] !== 'number' ||
		!Number.isSafeInteger(record['poolFee']) ||
		record['poolFee'] < 0 ||
		typeof record['reportId'] !== 'string' ||
		!/^(?:0|[1-9]\d*)$/.test(record['reportId']) ||
		typeof record['requiredToken'] !== 'string' ||
		!decimal.test(record['requiredToken']) ||
		typeof record['requiredWeth'] !== 'string' ||
		!decimal.test(record['requiredWeth']) ||
		typeof record['token'] !== 'string' ||
		!/^0x[0-9a-fA-F]{40}$/.test(record['token']) ||
		typeof record['tokenSymbol'] !== 'string' ||
		record['tokenSymbol'].length === 0 ||
		typeof record['trackedNetProfitEth'] !== 'string' ||
		!decimal.test(record['trackedNetProfitEth'].replace(/^-/, '')) ||
		typeof record['transactionHash'] !== 'string' ||
		!/^0x[0-9a-fA-F]{64}$/.test(record['transactionHash'])
	)
		return undefined
	return {
		actualGasCostEth: record['actualGasCostEth'],
		blockNumber: record['blockNumber'],
		direction: record['direction'],
		estimatedNetProfitWeth: record['estimatedNetProfitWeth'],
		estimatedProfitBeforeGasEth: record['estimatedProfitBeforeGasEth'],
		executedAt: record['executedAt'],
		pool: record['pool'] as Address,
		poolFee: record['poolFee'],
		reportId: record['reportId'],
		requiredToken: record['requiredToken'],
		requiredWeth: record['requiredWeth'],
		token: record['token'] as Address,
		tokenSymbol: record['tokenSymbol'],
		trackedNetProfitEth: record['trackedNetProfitEth'],
		transactionHash: record['transactionHash'] as Hex,
	}
}

export async function loadExecutionHistory(path: string, filesystem: ExecutionHistoryFilesystem = executionHistoryFilesystem) {
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
			const record = parseExecutionRecord(parsed)
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

export async function appendExecutionHistory(path: string, record: ExecutionRecord, filesystem: ExecutionHistoryFilesystem = executionHistoryFilesystem) {
	await filesystem.mkdir(dirname(path), { mode: 0o700, recursive: true })
	const handle = await filesystem.open(path, 'a', 0o600)
	try {
		await handle.chmod(0o600)
		await handle.appendFile(`${JSON.stringify(record)}\n`, { encoding: 'utf8' })
		await handle.sync()
	} finally {
		await handle.close()
	}
	await syncExecutionHistoryDirectory(path, filesystem)
}

export async function appendExecutionHistoryIfMissing(path: string, record: ExecutionRecord, filesystem: ExecutionHistoryFilesystem = executionHistoryFilesystem) {
	const history = await loadExecutionHistory(path, filesystem)
	if (history.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) return false
	await appendExecutionHistory(path, record, filesystem)
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

function positionTotals(positions: readonly PositionRecord[]) {
	let hedgedProfit = 0n
	let openHedgedNet = 0n
	let realized = 0n
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

export type OperatorSnapshotFixedState = {
	deployment?: DeploymentSettings | undefined
	execute: boolean
	executor: Address | undefined
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
): OperatorSnapshot {
	const totals = positionTotals(state.positions)
	const openPositions = state.positions.filter(position => positionConsumesRisk(position.status))
	const lockedAttoWeth = openPositions.reduce((total, position) => total + parseDecimalWeth(position.capitalAtRiskWeth), 0n)
	const riskNow = state.blockTimestamp === undefined ? new Date() : new Date(bigintToSafeNumber(BigInt(state.blockTimestamp) * 1_000n, 'Operator block timestamp'))
	const dailyGasSpentAttoWeth = utcDayGasSpentWeth(state.positions, riskNow)
	return publicOperatorSnapshot({
		activeReportCount: state.activeReportCount,
		balances: state.balances,
		blockNumber: state.blockNumber,
		blockTimestamp: state.blockTimestamp,
		centralizedMarket: serializeCentralizedMarketEstimate(state.centralizedMarket),
		marketConsensus: serializeMarketConsensusEstimate(state.marketConsensus, decimalWeth),
		execute: fixed.execute,
		executor: fixed.executor,
		executionHistory: state.executionHistory.slice(0, 500),
		executionHistoryRecordCount: state.executionHistory.length,
		positionRecordCount: state.positions.length,
		expectedChainId: fixed.expectedChainId,
		explorerUrl: fixed.explorerUrl,
		endpointChecks: state.endpointChecks,
		gameCapital: state.gameCapital,
		lastError: state.lastError,
		lastPollAt: state.lastPollAt,
		mode: fixed.execute ? 'execute' : 'dry-run',
		network: fixed.network,
		networkConfigured: fixed.networkConfigured ?? true,
		openOracle: fixed.openOracle,
		opportunities: state.opportunities,
		positions: state.positions.slice(0, 500),
		operationLog: state.operationLog,
		paused: state.paused,
		queuedWallet: fixed.queuedWallet,
		savedWallet: fixed.savedWallet,
		settings: strategySettings(strategy),
		status: state.status,
		submission,
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
		deployment:
			fixed.deployment ??
			({
				coordinatorAddresses: [],
				deploymentManifest: undefined,
				executor: fixed.executor,
				openOracle: fixed.openOracle,
				quorumRpcUrls: [],
				rep: fixed.openOracle,
				uniswapFactory: fixed.openOracle,
				uniswapQuoter: fixed.openOracle,
				uniswapRouter: undefined,
				uniswapV2Router: undefined,
				uniswapV4PoolManager: undefined,
				uniswapV4Quoter: undefined,
				weth: fixed.openOracle,
			} satisfies DeploymentSettings),
		totalActualGasCostEth: sumDecimalWeth(state.executionHistory, 'actualGasCostEth'),
		totalEstimatedNetProfitEth: sumDecimalWeth(state.executionHistory, 'estimatedNetProfitWeth'),
		totalEstimatedNetProfitWeth: sumDecimalWeth(state.executionHistory, 'estimatedNetProfitWeth'),
		totalRevenueBeforeGasEth: sumDecimalWeth(state.executionHistory, 'estimatedProfitBeforeGasEth'),
		totalHedgedProfitBeforeGasEth: totals.hedgedProfit,
		totalOpenHedgedNetProfitEth: totals.openHedgedNet,
		totalRealizedNetProfitEth: totals.realized,
		totalTrackedNetProfitEth: sumSignedEth(state.executionHistory, 'trackedNetProfitEth'),
		transactionActivity: state.transactionActivity.slice(0, 100),
		updatedAt: new Date().toISOString(),
		wallet: fixed.wallet,
	})
}

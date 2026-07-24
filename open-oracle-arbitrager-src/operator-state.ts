import { appendFile, mkdir, open, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Address, Hex } from '@zoltar/shared/ethereum'

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
	minimumProfitWeth: bigint
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

export type OpportunitySnapshot = {
	decision: 'dry-run-opportunity' | 'eligible' | 'execution-failed' | 'history-unavailable' | 'insufficient-inventory' | 'paused' | 'selected' | 'self-report' | 'submitted' | 'unprofitable'
	direction: 'buy-rep' | 'sell-rep'
	estimatedNetProfitWeth: string
	hasRequiredInventory: boolean | undefined
	pool: Address
	poolFee: number
	reportId: string
	requiredRep: string
	requiredWeth: string
	timeRemaining: string
	windowUnit: 'blocks' | 'seconds'
}

export type ExecutionRecord = {
	actualGasCostEth: string
	blockNumber: string
	direction: 'buy-rep' | 'sell-rep'
	estimatedNetProfitWeth: string
	executedAt: string
	pool: Address
	poolFee: number
	reportId: string
	requiredRep: string
	requiredWeth: string
	transactionHash: Hex
}

export type OperatorSnapshot = {
	activeReportCount: number
	balances: BalanceSnapshot | undefined
	blockNumber: string | undefined
	execute: boolean
	executionHistory: readonly ExecutionRecord[]
	executionHistoryRecordCount: number
	lastError: string | undefined
	lastPollAt: string | undefined
	mode: 'dry-run' | 'execute'
	openOracle: Address
	opportunities: readonly OpportunitySnapshot[]
	paused: boolean
	settings: StrategySettings
	status: 'error' | 'paused' | 'scanning' | 'sleeping' | 'starting' | 'stopped'
	totalActualGasCostEth: string
	totalEstimatedNetProfitWeth: string
	updatedAt: string
	wallet: Address | undefined
}

export type OperatorState = {
	activeReportCount: number
	balances: BalanceSnapshot | undefined
	blockNumber: string | undefined
	executionHistory: ExecutionRecord[]
	lastError: string | undefined
	lastPollAt: string | undefined
	opportunities: OpportunitySnapshot[]
	paused: boolean
	status: OperatorSnapshot['status']
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

export function strategySettings(strategy: MutableStrategy): StrategySettings {
	return {
		maxSpotTwapTicks: strategy.maxSpotTwapTicks.toString(),
		minimumProfitBps: strategy.minimumProfitBps.toString(),
		minimumProfitWeth: decimalWeth(strategy.minimumProfitWeth),
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
	const minimumProfitWeth = parseDecimalWeth(requiredDecimal(record, 'minimumProfitWeth'))
	if (minimumProfitWeth > 1_000n * 10n ** 18n) throw new Error('Minimum profit must not exceed 1000 WETH')
	const maxSpotTwapTicks = requiredBigInt(record, 'maxSpotTwapTicks', 0n, 100_000n)
	const minimumProfitBps = requiredBigInt(record, 'minimumProfitBps', 0n, 100_000n)
	const minimumRemainingBlocks = requiredBigInt(record, 'minimumRemainingBlocks', 1n, 1_000n)
	const minimumRemainingSeconds = requiredBigInt(record, 'minimumRemainingSeconds', 1n, 86_400n)
	const pollMilliseconds = requiredInteger(record, 'pollMilliseconds', 1_000, 3_600_000)
	const twapSeconds = requiredInteger(record, 'twapSeconds', 60, 86_400)
	strategy.maxSpotTwapTicks = maxSpotTwapTicks
	strategy.minimumProfitBps = minimumProfitBps
	strategy.minimumProfitWeth = minimumProfitWeth
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

function executionRecord(value: unknown): ExecutionRecord | undefined {
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
		typeof record['executedAt'] !== 'string' ||
		!Number.isFinite(Date.parse(record['executedAt'])) ||
		typeof record['pool'] !== 'string' ||
		!/^0x[0-9a-fA-F]{40}$/.test(record['pool']) ||
		typeof record['poolFee'] !== 'number' ||
		!Number.isSafeInteger(record['poolFee']) ||
		record['poolFee'] < 0 ||
		typeof record['reportId'] !== 'string' ||
		!/^(?:0|[1-9]\d*)$/.test(record['reportId']) ||
		typeof record['requiredRep'] !== 'string' ||
		!decimal.test(record['requiredRep']) ||
		typeof record['requiredWeth'] !== 'string' ||
		!decimal.test(record['requiredWeth']) ||
		typeof record['transactionHash'] !== 'string' ||
		!/^0x[0-9a-fA-F]{64}$/.test(record['transactionHash'])
	)
		return undefined
	return {
		actualGasCostEth: record['actualGasCostEth'],
		blockNumber: record['blockNumber'],
		direction: record['direction'],
		estimatedNetProfitWeth: record['estimatedNetProfitWeth'],
		executedAt: record['executedAt'],
		pool: record['pool'] as Address,
		poolFee: record['poolFee'],
		reportId: record['reportId'],
		requiredRep: record['requiredRep'],
		requiredWeth: record['requiredWeth'],
		transactionHash: record['transactionHash'] as Hex,
	}
}

export async function loadExecutionHistory(path: string) {
	try {
		const contents = await readFile(path, 'utf8')
		const records = contents
			.split('\n')
			.filter(line => line.trim() !== '')
			.map(line => {
				try {
					return executionRecord(JSON.parse(line))
				} catch (error) {
					if (error instanceof SyntaxError) return undefined
					throw error
				}
			})
			.filter(record => record !== undefined)
		const unique = new Map<string, ExecutionRecord>()
		for (const record of records) unique.set(record.transactionHash.toLowerCase(), record)
		return [...unique.values()].reverse()
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return []
		throw error
	}
}

export async function appendExecutionHistory(path: string, record: ExecutionRecord) {
	await mkdir(dirname(path), { recursive: true })
	await appendFile(path, `${JSON.stringify(record)}\n`, { encoding: 'utf8', mode: 0o600 })
}

export async function ensureExecutionHistoryWritable(path: string) {
	await mkdir(dirname(path), { recursive: true })
	const handle = await open(path, 'a', 0o600)
	try {
		await handle.chmod(0o600)
	} finally {
		await handle.close()
	}
}

function sumDecimalWeth(records: readonly ExecutionRecord[], field: 'actualGasCostEth' | 'estimatedNetProfitWeth') {
	return decimalWeth(records.reduce((total, record) => total + parseDecimalWeth(record[field]), 0n))
}

export function operatorSnapshot(state: OperatorState, strategy: MutableStrategy, fixed: { execute: boolean; openOracle: Address; wallet: Address | undefined }): OperatorSnapshot {
	return {
		activeReportCount: state.activeReportCount,
		balances: state.balances,
		blockNumber: state.blockNumber,
		execute: fixed.execute,
		executionHistory: state.executionHistory.slice(0, 500),
		executionHistoryRecordCount: state.executionHistory.length,
		lastError: state.lastError,
		lastPollAt: state.lastPollAt,
		mode: fixed.execute ? 'execute' : 'dry-run',
		openOracle: fixed.openOracle,
		opportunities: state.opportunities,
		paused: state.paused,
		settings: strategySettings(strategy),
		status: state.status,
		totalActualGasCostEth: sumDecimalWeth(state.executionHistory, 'actualGasCostEth'),
		totalEstimatedNetProfitWeth: sumDecimalWeth(state.executionHistory, 'estimatedNetProfitWeth'),
		updatedAt: new Date().toISOString(),
		wallet: fixed.wallet,
	}
}

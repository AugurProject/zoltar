import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Address, Hex } from '@zoltar/bot-shared/ethereum'
import { record as validateRecord } from '@zoltar/bot-shared/infrastructure/json-validation'
import { decimalSignedEth, decimalWeth, parseDecimalWeth } from '#state/operator-state'

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/
const INTEGER = /^(?:0|[1-9]\d*)$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HASH = /^0x[0-9a-fA-F]{64}$/
const GWEI = 10n ** 9n
/** Bounds the dashboard history so the snapshot stays small while the journal keeps every record. */
const SETTLEMENT_HISTORY_LIMIT = 200

/** Operator-facing settlement settings, stored under `settlement` in the operator configuration. */
export type SettlementSettings = {
	enabled: boolean
	maxGasPriceGwei: string
	minimumProfitWeth: string
	rewardWithdrawThresholdEth: string
}

export type MutableSettlement = {
	enabled: boolean
	maxGasPriceAttoEthPerGas: bigint
	minimumProfitAttoWeth: bigint
	rewardWithdrawThresholdAttoEth: bigint
}

export type SettlementDecision = 'disabled' | 'dry-run-settlement' | 'eligible' | 'execution-failed' | 'gas-price-cap' | 'in-flight' | 'paused' | 'risk-limit' | 'settled' | 'signer-unavailable' | 'unprofitable'

/** Why accrued rewards were or were not withdrawn in the latest scan. */
export type RewardWithdrawalDecision = 'below-threshold' | 'disabled' | 'dry-run' | 'due' | 'gas-price-cap' | 'in-flight' | 'paused' | 'risk-limit' | 'signer-unavailable' | 'unavailable'

/** Expired attempts keep being checked for a late inclusion this long, so their gas and outcome are never lost. */
const SETTLEMENT_EXPIRED_RECHECK_BLOCKS = 256n

/** A pending attempt, or an expired one still inside its recheck window, may still be mined; nothing that depends on it may be re-sent. */
export function settlementAttemptMayStillLand(record: Pick<SettlementRecord, 'status' | 'submissionBlockNumber'>, blockNumber: bigint) {
	return record.status === 'pending' || (record.status === 'expired' && blockNumber <= BigInt(record.submissionBlockNumber) + SETTLEMENT_EXPIRED_RECHECK_BLOCKS)
}

/** One report awaiting third-party settlement, evaluated at the latest scan head. */
export type SettlementCandidateSnapshot = {
	callbackGasLimit: string
	coordinator: Address
	decision: SettlementDecision
	elapsed: string
	projectedGasCostEth: string
	projectedNetEth: string
	reportId: string
	rewardEth: string
	token: Address
	tokenSymbol: string
	windowUnit: 'blocks' | 'seconds'
}

/** Durable record of one settlement or reward-withdrawal transaction signed by this operator. */
export type SettlementRecord = {
	account: Address
	actualGasCostEth: string | undefined
	coordinator: Address | undefined
	kind: 'reward-withdrawal' | 'settlement'
	/** Receipt block timestamp; charges gas to the UTC day the chain mined it, like position expenditures. */
	minedAt: string | undefined
	projectedGasCostEth: string
	reportId: string | undefined
	rewardEth: string
	status: 'confirmed' | 'expired' | 'pending' | 'reverted'
	submissionBlockNumber: string
	submittedAt: string
	transactionHash: Hex
	updatedAt: string
}

export type SettlementSnapshot = {
	history: readonly SettlementRecord[]
	queue: readonly SettlementCandidateSnapshot[]
	realizedIncomeEth: string
	settings: SettlementSettings
	unclaimedRewardEth: string | undefined
	/** Settlement gas already charged to the current UTC day; shares the daily budget with position gas. */
	utcDayGasSpentEth: string
	withdrawalDecision: RewardWithdrawalDecision
}

function defaultSettlementSettings(): MutableSettlement {
	return { enabled: false, maxGasPriceAttoEthPerGas: 50n * GWEI, minimumProfitAttoWeth: 10n ** 15n, rewardWithdrawThresholdAttoEth: 10n ** 16n }
}

function decimalGwei(value: bigint) {
	const whole = value / GWEI
	const fraction = value % GWEI
	if (fraction === 0n) return whole.toString()
	return `${whole.toString()}.${fraction.toString().padStart(9, '0').replace(/0+$/, '')}`
}

function parseDecimalGwei(value: string) {
	if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value)) throw new Error(`Invalid gwei amount: ${value}`)
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * GWEI + BigInt(fraction.padEnd(9, '0'))
}

export function settlementSettings(settlement: MutableSettlement): SettlementSettings {
	return {
		enabled: settlement.enabled,
		maxGasPriceGwei: decimalGwei(settlement.maxGasPriceAttoEthPerGas),
		minimumProfitWeth: decimalWeth(settlement.minimumProfitAttoWeth),
		rewardWithdrawThresholdEth: decimalWeth(settlement.rewardWithdrawThresholdAttoEth),
	}
}

function requiredDecimal(record: Record<string, unknown>, key: keyof SettlementSettings, label: string) {
	const value = record[key]
	if (typeof value !== 'string' || !DECIMAL.test(value)) throw new Error(`${label} must be a nonnegative decimal string with at most 18 decimal places`)
	return value
}

/** Validates a complete settlement settings block; an absent block keeps settlement disabled with default thresholds. */
export function parseSettlementSettings(value: unknown): MutableSettlement {
	if (value === undefined) return defaultSettlementSettings()
	const record = validateRecord(value, 'Settlement settings', 'Settlement settings must be a JSON object')
	const allowed = new Set<keyof SettlementSettings>(['enabled', 'maxGasPriceGwei', 'minimumProfitWeth', 'rewardWithdrawThresholdEth'])
	for (const key of Object.keys(record)) if (!allowed.has(key as keyof SettlementSettings)) throw new Error(`Unknown settlement setting: ${key}`)
	if (Object.keys(record).length !== allowed.size) throw new Error('Every settlement setting is required')
	if (typeof record['enabled'] !== 'boolean') throw new Error('Settlement enabled must be a boolean')
	const maxGasPriceAttoEthPerGas = parseDecimalGwei(requiredDecimal(record, 'maxGasPriceGwei', 'Settlement maxGasPriceGwei'))
	if (maxGasPriceAttoEthPerGas === 0n || maxGasPriceAttoEthPerGas > 10_000n * GWEI) throw new Error('Settlement maxGasPriceGwei must be from 0.000000001 to 10000')
	const minimumProfitAttoWeth = parseDecimalWeth(requiredDecimal(record, 'minimumProfitWeth', 'Settlement minimumProfitWeth'))
	if (minimumProfitAttoWeth > 10n ** 18n) throw new Error('Settlement minimumProfitWeth must not exceed 1 WETH')
	const rewardWithdrawThresholdAttoEth = parseDecimalWeth(requiredDecimal(record, 'rewardWithdrawThresholdEth', 'Settlement rewardWithdrawThresholdEth'))
	if (rewardWithdrawThresholdAttoEth === 0n || rewardWithdrawThresholdAttoEth > 100n * 10n ** 18n) throw new Error('Settlement rewardWithdrawThresholdEth must be from 0.000000000000000001 to 100')
	return { enabled: record['enabled'], maxGasPriceAttoEthPerGas, minimumProfitAttoWeth, rewardWithdrawThresholdAttoEth }
}

export function settlementJournalPath(positionFile: string) {
	return `${positionFile}.settlements`
}

function parseSettlementRecord(value: unknown): SettlementRecord | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	const record = value as Record<string, unknown>
	const optionalString = (field: string, pattern: RegExp) => record[field] === undefined || (typeof record[field] === 'string' && pattern.test(record[field]))
	if (
		typeof record['account'] !== 'string' ||
		!ADDRESS.test(record['account']) ||
		!optionalString('actualGasCostEth', DECIMAL) ||
		!optionalString('coordinator', ADDRESS) ||
		(record['kind'] !== 'reward-withdrawal' && record['kind'] !== 'settlement') ||
		(record['minedAt'] !== undefined && (typeof record['minedAt'] !== 'string' || !Number.isFinite(Date.parse(record['minedAt'])))) ||
		typeof record['projectedGasCostEth'] !== 'string' ||
		!DECIMAL.test(record['projectedGasCostEth']) ||
		!optionalString('reportId', INTEGER) ||
		typeof record['rewardEth'] !== 'string' ||
		!DECIMAL.test(record['rewardEth']) ||
		(record['status'] !== 'confirmed' && record['status'] !== 'expired' && record['status'] !== 'pending' && record['status'] !== 'reverted') ||
		typeof record['submissionBlockNumber'] !== 'string' ||
		!INTEGER.test(record['submissionBlockNumber']) ||
		typeof record['submittedAt'] !== 'string' ||
		!Number.isFinite(Date.parse(record['submittedAt'])) ||
		typeof record['transactionHash'] !== 'string' ||
		!HASH.test(record['transactionHash']) ||
		typeof record['updatedAt'] !== 'string' ||
		!Number.isFinite(Date.parse(record['updatedAt']))
	)
		return undefined
	if (record['kind'] === 'settlement' && (record['coordinator'] === undefined || record['reportId'] === undefined)) return undefined
	return {
		account: record['account'] as Address,
		actualGasCostEth: typeof record['actualGasCostEth'] === 'string' ? record['actualGasCostEth'] : undefined,
		coordinator: typeof record['coordinator'] === 'string' ? (record['coordinator'] as Address) : undefined,
		kind: record['kind'],
		minedAt: typeof record['minedAt'] === 'string' ? record['minedAt'] : undefined,
		projectedGasCostEth: record['projectedGasCostEth'],
		reportId: typeof record['reportId'] === 'string' ? record['reportId'] : undefined,
		rewardEth: record['rewardEth'],
		status: record['status'],
		submissionBlockNumber: record['submissionBlockNumber'],
		submittedAt: record['submittedAt'],
		transactionHash: record['transactionHash'] as Hex,
		updatedAt: record['updatedAt'],
	}
}

type SettlementJournalFileHandle = {
	appendFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
	chmod: (mode: number) => Promise<unknown>
	close: () => Promise<unknown>
	sync: () => Promise<unknown>
}

export type SettlementJournalFilesystem = {
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'a' | 'r', mode?: number) => Promise<SettlementJournalFileHandle>
	readFile: (path: string, encoding: 'utf8') => Promise<string>
}

const settlementJournalFilesystem: SettlementJournalFilesystem = { mkdir, open, readFile }

/** Append-only JSONL journal; the latest line per transaction hash is the current record, newest first. */
export async function loadSettlementJournal(path: string, expectedChainId: number, filesystem: SettlementJournalFilesystem = settlementJournalFilesystem): Promise<SettlementRecord[]> {
	if (!Number.isSafeInteger(expectedChainId) || expectedChainId < 1) throw new Error('Expected settlement journal chain ID must be a positive integer')
	let contents: string
	try {
		contents = await filesystem.readFile(path, 'utf8')
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return []
		throw error
	}
	const unique = new Map<string, SettlementRecord>()
	for (const [index, line] of contents.split('\n').entries()) {
		if (line.trim() === '') continue
		let parsed: unknown
		try {
			parsed = JSON.parse(line)
		} catch (error) {
			if (error instanceof SyntaxError) throw new Error(`Invalid settlement journal line ${(index + 1).toString()}: ${error.message}`)
			throw error
		}
		if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed) || Reflect.get(parsed, 'chainId') !== expectedChainId) throw new Error(`Settlement journal record at line ${(index + 1).toString()} belongs to another chain`)
		const record = parseSettlementRecord(Reflect.get(parsed, 'record'))
		if (record === undefined) throw new Error(`Invalid settlement journal record at line ${(index + 1).toString()}`)
		unique.delete(record.transactionHash.toLowerCase())
		unique.set(record.transactionHash.toLowerCase(), record)
	}
	return [...unique.values()].reverse()
}

export async function appendSettlementRecord(path: string, record: SettlementRecord, chainId: number, filesystem: SettlementJournalFilesystem = settlementJournalFilesystem) {
	if (!Number.isSafeInteger(chainId) || chainId < 1) throw new Error('Settlement journal chain ID must be a positive integer')
	await filesystem.mkdir(dirname(path), { mode: 0o700, recursive: true })
	const handle = await filesystem.open(path, 'a', 0o600)
	try {
		await handle.chmod(0o600)
		await handle.appendFile(`${JSON.stringify({ chainId, record })}\n`, { encoding: 'utf8' })
		await handle.sync()
	} finally {
		await handle.close()
	}
	const directoryHandle = await filesystem.open(dirname(path), 'r')
	try {
		await directoryHandle.sync()
	} finally {
		await directoryHandle.close()
	}
}

/** Replaces the record with the same transaction hash, keeping newest-first order for the dashboard. */
export function mergeSettlementRecord(records: readonly SettlementRecord[], record: SettlementRecord) {
	return [record, ...records.filter(existing => existing.transactionHash.toLowerCase() !== record.transactionHash.toLowerCase())]
}

/** Confirmed settlement rewards minus the actual gas of every confirmed or reverted settlement and reward withdrawal. */
function realizedSettlementIncomeAttoEth(records: readonly SettlementRecord[]) {
	let total = 0n
	for (const record of records) {
		if (record.status === 'confirmed' && record.kind === 'settlement') total += parseDecimalWeth(record.rewardEth)
		if ((record.status === 'confirmed' || record.status === 'reverted') && record.actualGasCostEth !== undefined) total -= parseDecimalWeth(record.actualGasCostEth)
	}
	return total
}

/** Gas the settler paid on the given UTC day (by mined block time), so settlements share the operator's daily gas budget with positions. */
export function settlementGasSpentAttoEthOnUtcDay(records: readonly SettlementRecord[], now: Date) {
	const day = now.toISOString().slice(0, 10)
	return records.reduce((total, record) => total + (record.actualGasCostEth !== undefined && (record.minedAt ?? record.updatedAt).slice(0, 10) === day ? parseDecimalWeth(record.actualGasCostEth) : 0n), 0n)
}

export function emptySettlementSnapshot(settings: MutableSettlement = defaultSettlementSettings()): SettlementSnapshot {
	return settlementSnapshot({ now: new Date(), queue: [], records: [], settings, unclaimedRewardAttoEth: undefined, withdrawalDecision: 'unavailable' })
}

export function settlementSnapshot(parameters: { now: Date; queue: readonly SettlementCandidateSnapshot[]; records: readonly SettlementRecord[]; settings: MutableSettlement; unclaimedRewardAttoEth: bigint | undefined; withdrawalDecision: RewardWithdrawalDecision }): SettlementSnapshot {
	return {
		history: parameters.records.slice(0, SETTLEMENT_HISTORY_LIMIT),
		queue: parameters.queue,
		realizedIncomeEth: decimalSignedEth(realizedSettlementIncomeAttoEth(parameters.records)),
		settings: settlementSettings(parameters.settings),
		unclaimedRewardEth: parameters.unclaimedRewardAttoEth === undefined ? undefined : decimalWeth(parameters.unclaimedRewardAttoEth),
		utcDayGasSpentEth: decimalWeth(settlementGasSpentAttoEthOnUtcDay(parameters.records, parameters.now)),
		withdrawalDecision: parameters.withdrawalDecision,
	}
}

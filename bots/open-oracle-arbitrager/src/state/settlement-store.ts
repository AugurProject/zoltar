import { mkdir, open, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Address, Hex } from '@zoltar/bot-shared/ethereum'
import { record as validateRecord } from '@zoltar/bot-shared/infrastructure/json-validation'
import { attemptHasFinality } from '#execution/execution-orchestration'
import { decimalSignedEth, decimalWeth, parseDecimalWeth } from '#state/operator-state'
import type { DurableTransactionIntent } from '#state/position-store'

const DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/
const INTEGER = /^(?:0|[1-9]\d*)$/
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HASH = /^0x[0-9a-fA-F]{64}$/
const NANO_ETH = 10n ** 9n
/** Bounds the dashboard history so the snapshot stays small while the journal keeps every record. */
const SETTLEMENT_HISTORY_LIMIT = 200

/** Operator-facing settlement settings, stored under `settlement` in the operator configuration. */
export type SettlementSettings = {
	enabled: boolean
	maxGasPriceNanoEth: string
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

/** The signed horizon plus the reorg overlap has passed, so the attempt's own submission window is closed for good. */
function settlementAttemptHorizonFinalized(record: Pick<SettlementRecord, 'lastValidBlockNumber'>, blockNumber: bigint) {
	return attemptHasFinality(blockNumber, BigInt(record.lastValidBlockNumber))
}

/**
 * A public transaction has no on-chain deadline, so a pending attempt may be mined however long ago it was signed; nothing
 * that depends on it may be re-sent until its receipt appears or another transaction consumes its nonce.
 */
function settlementAttemptMayStillLand(record: Pick<SettlementRecord, 'status'>) {
	return record.status === 'pending'
}

/**
 * Whether an attempt keeps its report or withdrawal out of the queue: while it may still land, and for a dropped attempt
 * until its own horizon has finalized, so a refusal that repeats every scan re-signs at the horizon cadence rather than
 * on every poll.
 */
export function settlementAttemptHoldsFlow(record: Pick<SettlementRecord, 'lastValidBlockNumber' | 'status'>, blockNumber: bigint) {
	return settlementAttemptMayStillLand(record) || (record.status === 'dropped' && !settlementAttemptHorizonFinalized(record, blockNumber))
}

/**
 * Attempts whose outcome recovery still has to check: pending ones; dropped private ones (the relay may have shared the
 * transaction before its horizon) and dropped public ones inside their horizon; and mined or expired ones recovery has
 * not yet verified at finality depth, because a short reorg can orphan a receipt or a replacement after it was journaled.
 * A public attempt that no node accepted is final once its horizon has finalized; a dropped private one is rechecked
 * until its nonce is consumed.
 */
export function settlementAttemptIsUnresolved(record: Pick<SettlementRecord, 'finalized' | 'lastValidBlockNumber' | 'status' | 'submissionMode'>, blockNumber: bigint) {
	if (record.status === 'pending') return true
	if (record.status === 'dropped') return record.submissionMode === 'private' || !settlementAttemptHorizonFinalized(record, blockNumber)
	return !record.finalized
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

/**
 * Durable record of one settlement or reward-withdrawal transaction signed by this operator. The nonce and intent let
 * recovery tell a late inclusion from a replacement: `expired` means another transaction consumed the nonce, so the
 * signed hash can never be mined. A `pending` record stays tracked until that or a receipt is observed; a private
 * attempt whose relay horizon has finalized without inclusion becomes `dropped`, which frees the report and the budget
 * while recovery keeps rechecking it, because a public attempt has no deadline but a relay stops at `maxBlockNumber`.
 */
export type SettlementRecord = {
	account: Address
	actualGasCostEth: string | undefined
	coordinator: Address | undefined
	kind: 'reward-withdrawal' | 'settlement'
	/** The signed validity horizon; a private relay does not include the transaction past it. */
	lastValidBlockNumber: string
	/**
	 * Whether recovery has verified the outcome at finality depth: a receipt still canonical, or a replacement still canonical
	 * (or the nonce still consumed), twelve blocks on. Age alone never finalizes an outcome, because the bot may have been
	 * down while a reorg orphaned it.
	 */
	finalized: boolean
	/** Receipt block timestamp; charges gas to the UTC day the chain mined it, like position expenditures. */
	minedAt: string | undefined
	nonce: string
	/** The block that carried the receipt; a mined outcome is rechecked against it until that block has finality. */
	receiptBlock: { hash: Hex; number: string } | undefined
	/** For an expired attempt, the transaction that consumed its nonce, rechecked until it has finality. */
	replacedBy: Hex | undefined
	/** Gas at the signed fee ceiling; the exposure a pending attempt charges to the daily budget until its outcome is known. */
	projectedGasCostEth: string
	reportId: string | undefined
	rewardEth: string
	status: 'confirmed' | 'dropped' | 'expired' | 'pending' | 'reverted'
	submissionBlockNumber: string
	submissionMode: 'private' | 'public'
	submittedAt: string
	transactionHash: Hex
	transactionIntent: DurableTransactionIntent
	updatedAt: string
}

/** The journal record without its signing material; the dashboard needs the outcome and gas, not the calldata. */
export type PublicSettlementRecord = Omit<SettlementRecord, 'nonce' | 'transactionIntent'>

export type SettlementSnapshot = {
	history: readonly PublicSettlementRecord[]
	queue: readonly SettlementCandidateSnapshot[]
	realizedIncomeEth: string
	settings: SettlementSettings
	unclaimedRewardEth: string | undefined
	/** Settlement gas already charged to the current UTC day; shares the daily budget with position gas. */
	utcDayGasSpentEth: string
	withdrawalDecision: RewardWithdrawalDecision
}

function defaultSettlementSettings(): MutableSettlement {
	return { enabled: false, maxGasPriceAttoEthPerGas: 50n * NANO_ETH, minimumProfitAttoWeth: 10n ** 15n, rewardWithdrawThresholdAttoEth: 10n ** 16n }
}

function decimalNanoEth(value: bigint) {
	const whole = value / NANO_ETH
	const fraction = value % NANO_ETH
	if (fraction === 0n) return whole.toString()
	return `${whole.toString()}.${fraction.toString().padStart(9, '0').replace(/0+$/, '')}`
}

function parseDecimalNanoEth(value: string) {
	if (!/^(?:0|[1-9]\d*)(?:\.\d{1,9})?$/.test(value)) throw new Error(`Invalid nanoETH amount: ${value}`)
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * NANO_ETH + BigInt(fraction.padEnd(9, '0'))
}

export function settlementSettings(settlement: MutableSettlement): SettlementSettings {
	return {
		enabled: settlement.enabled,
		maxGasPriceNanoEth: decimalNanoEth(settlement.maxGasPriceAttoEthPerGas),
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
	const allowed = new Set<keyof SettlementSettings>(['enabled', 'maxGasPriceNanoEth', 'minimumProfitWeth', 'rewardWithdrawThresholdEth'])
	for (const key of Object.keys(record)) if (!allowed.has(key as keyof SettlementSettings)) throw new Error(`Unknown settlement setting: ${key}`)
	if (Object.keys(record).length !== allowed.size) throw new Error('Every settlement setting is required')
	if (typeof record['enabled'] !== 'boolean') throw new Error('Settlement enabled must be a boolean')
	const maxGasPriceAttoEthPerGas = parseDecimalNanoEth(requiredDecimal(record, 'maxGasPriceNanoEth', 'Settlement maxGasPriceNanoEth'))
	if (maxGasPriceAttoEthPerGas === 0n || maxGasPriceAttoEthPerGas > 10_000n * NANO_ETH) throw new Error('Settlement maxGasPriceNanoEth must be from 0.000000001 to 10000')
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
		typeof record['finalized'] !== 'boolean' ||
		!optionalString('replacedBy', HASH) ||
		(record['kind'] !== 'reward-withdrawal' && record['kind'] !== 'settlement') ||
		typeof record['lastValidBlockNumber'] !== 'string' ||
		!INTEGER.test(record['lastValidBlockNumber']) ||
		(record['minedAt'] !== undefined && (typeof record['minedAt'] !== 'string' || !Number.isFinite(Date.parse(record['minedAt'])))) ||
		typeof record['nonce'] !== 'string' ||
		!INTEGER.test(record['nonce']) ||
		typeof record['projectedGasCostEth'] !== 'string' ||
		!DECIMAL.test(record['projectedGasCostEth']) ||
		!optionalString('reportId', INTEGER) ||
		typeof record['rewardEth'] !== 'string' ||
		!DECIMAL.test(record['rewardEth']) ||
		(record['status'] !== 'confirmed' && record['status'] !== 'dropped' && record['status'] !== 'expired' && record['status'] !== 'pending' && record['status'] !== 'reverted') ||
		typeof record['submissionBlockNumber'] !== 'string' ||
		!INTEGER.test(record['submissionBlockNumber']) ||
		(record['submissionMode'] !== 'private' && record['submissionMode'] !== 'public') ||
		typeof record['submittedAt'] !== 'string' ||
		!Number.isFinite(Date.parse(record['submittedAt'])) ||
		typeof record['transactionHash'] !== 'string' ||
		!HASH.test(record['transactionHash']) ||
		typeof record['updatedAt'] !== 'string' ||
		!Number.isFinite(Date.parse(record['updatedAt']))
	)
		return undefined
	if (record['kind'] === 'settlement' && (record['coordinator'] === undefined || record['reportId'] === undefined)) return undefined
	const transactionIntent = parseTransactionIntent(record['transactionIntent'])
	if (transactionIntent === undefined) return undefined
	const receiptBlock = record['receiptBlock'] === undefined ? undefined : parseReceiptBlock(record['receiptBlock'])
	if (record['receiptBlock'] !== undefined && receiptBlock === undefined) return undefined
	return {
		account: record['account'] as Address,
		actualGasCostEth: typeof record['actualGasCostEth'] === 'string' ? record['actualGasCostEth'] : undefined,
		coordinator: typeof record['coordinator'] === 'string' ? (record['coordinator'] as Address) : undefined,
		finalized: record['finalized'],
		kind: record['kind'],
		lastValidBlockNumber: record['lastValidBlockNumber'],
		minedAt: typeof record['minedAt'] === 'string' ? record['minedAt'] : undefined,
		nonce: record['nonce'],
		projectedGasCostEth: record['projectedGasCostEth'],
		receiptBlock,
		replacedBy: typeof record['replacedBy'] === 'string' ? (record['replacedBy'] as Hex) : undefined,
		reportId: typeof record['reportId'] === 'string' ? record['reportId'] : undefined,
		rewardEth: record['rewardEth'],
		status: record['status'],
		submissionBlockNumber: record['submissionBlockNumber'],
		submissionMode: record['submissionMode'],
		submittedAt: record['submittedAt'],
		transactionHash: record['transactionHash'] as Hex,
		transactionIntent,
		updatedAt: record['updatedAt'],
	}
}

function parseReceiptBlock(value: unknown): SettlementRecord['receiptBlock'] {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	const block = value as Record<string, unknown>
	if (typeof block['hash'] !== 'string' || !HASH.test(block['hash']) || typeof block['number'] !== 'string' || !INTEGER.test(block['number'])) return undefined
	return { hash: block['hash'] as Hex, number: block['number'] }
}

function parseTransactionIntent(value: unknown): DurableTransactionIntent | undefined {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined
	const intent = value as Record<string, unknown>
	if (typeof intent['data'] !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(intent['data']) || typeof intent['to'] !== 'string' || !ADDRESS.test(intent['to']) || typeof intent['value'] !== 'string' || !INTEGER.test(intent['value'])) return undefined
	return { data: intent['data'] as Hex, to: intent['to'] as Address, value: intent['value'] }
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

/**
 * Gas the settler paid on the given UTC day (by mined block time) plus the signed exposure of every attempt that may still
 * land, whichever day it was signed on, so settlements share the operator's daily gas budget with positions even before
 * their receipts: a pending attempt is a liability against whatever day is being judged until its outcome is known. A
 * dropped attempt charges nothing until a late receipt shows what it actually paid.
 */
export function settlementGasSpentAttoEthOnUtcDay(records: readonly SettlementRecord[], now: Date) {
	const day = now.toISOString().slice(0, 10)
	return records.reduce((total, record) => {
		if (record.actualGasCostEth !== undefined) return (record.minedAt ?? record.updatedAt).slice(0, 10) === day ? total + parseDecimalWeth(record.actualGasCostEth) : total
		if (settlementAttemptMayStillLand(record)) return total + parseDecimalWeth(record.projectedGasCostEth)
		return total
	}, 0n)
}

export function emptySettlementSnapshot(settings: MutableSettlement = defaultSettlementSettings()): SettlementSnapshot {
	return settlementSnapshot({ now: new Date(), queue: [], records: [], settings, unclaimedRewardAttoEth: undefined, withdrawalDecision: 'unavailable' })
}

export function settlementSnapshot(parameters: { now: Date; queue: readonly SettlementCandidateSnapshot[]; records: readonly SettlementRecord[]; settings: MutableSettlement; unclaimedRewardAttoEth: bigint | undefined; withdrawalDecision: RewardWithdrawalDecision }): SettlementSnapshot {
	return {
		history: parameters.records.slice(0, SETTLEMENT_HISTORY_LIMIT).map(({ nonce: _nonce, transactionIntent: _transactionIntent, ...record }) => record),
		queue: parameters.queue,
		realizedIncomeEth: decimalSignedEth(realizedSettlementIncomeAttoEth(parameters.records)),
		settings: settlementSettings(parameters.settings),
		unclaimedRewardEth: parameters.unclaimedRewardAttoEth === undefined ? undefined : decimalWeth(parameters.unclaimedRewardAttoEth),
		utcDayGasSpentEth: decimalWeth(settlementGasSpentAttoEthOnUtcDay(parameters.records, parameters.now)),
		withdrawalDecision: parameters.withdrawalDecision,
	}
}

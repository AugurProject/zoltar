import { randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { acquireExecutionSignerLock as acquireSharedExecutionSignerLock, acquireFileProcessLock, type ExclusiveProcessLock } from '@zoltar/bot-shared/execution/process-lock'
import { getAddress, type Address, type Hex } from '#ethereum'
import { parseExecutionRecord, type ExecutionRecord } from '#state/operator-state'

type PositionJournalFileHandle = {
	chmod: (mode: number) => Promise<unknown>
	close: () => Promise<unknown>
	sync: () => Promise<unknown>
	writeFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
}

export type PositionJournalFilesystem = {
	lstat?: (path: string) => Promise<{ isDirectory: () => boolean; isSymbolicLink: () => boolean; mode: number; uid: number }>
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'r' | 'wx', mode?: number) => Promise<PositionJournalFileHandle>
	readFile: (path: string, encoding: 'utf8') => Promise<string>
	rename: (oldPath: string, newPath: string) => Promise<unknown>
	rm: (path: string, options: { force: true }) => Promise<unknown>
}

export type { ExclusiveProcessLock }

const positionJournalFilesystem: PositionJournalFilesystem = {
	lstat,
	mkdir,
	open,
	readFile,
	rename,
	rm,
}

export type ManualReconciliation = {
	evidence: string
	externalCostEth: string
	finalWalletToken: string
	finalWalletWeth: string
	note: string
	pnlStatus: 'recorded' | 'unavailable'
	recordedAt: string
	recordedBy: Address
}

export type ExecutionIntent = Omit<ExecutionRecord, 'actualGasCostEth' | 'blockNumber' | 'executedAt' | 'trackedNetProfitEth' | 'transactionHash'>

export type DurableTransactionIntent = {
	data: Hex
	to: Address
	value: string
}

export type ExpiredTransactionAttempt = {
	kind: 'entry' | 'lifecycle'
	nonce: string
	targetBlockNumber: string
	transactionHash: Hex
}

export type PositionRecord = {
	account: Address
	actualEntryGasCostEth: string
	capitalAtRiskWeth: string
	closedAt: string | undefined
	direction: 'buy-rep' | 'sell-rep'
	entrySubmissionBlockNumber?: string | undefined
	entrySubmissionMode?: 'private' | 'public' | undefined
	entryTransactionIntent?: DurableTransactionIntent | undefined
	entryTransactionNonce?: string | undefined
	entryTransactionHash: Hex
	entryTransactionHashes: readonly Hex[]
	executionIntent?: ExecutionIntent | undefined
	expiredTransactionAttempts?: readonly ExpiredTransactionAttempt[] | undefined
	gasExpenditures: readonly {
		costEth: string
		minedAt: string
		transactionHash: Hex
	}[]
	historyOutbox: ExecutionRecord | undefined
	hedgeAmountToken: string
	hedgeWeth: string
	hedgedProfitBeforeGasEth: string
	lifecycleGasCostEth: string
	lifecycleKind?: 'replacement-credit' | 'settlement' | undefined
	lifecycleReceiptBlockHash?: Hex | undefined
	lifecycleReceiptBlockNumber?: string | undefined
	lifecycleReceiptRecovered: boolean
	lifecycleSettlerRewardEth?: string | undefined
	lifecycleSubmissionBlockNumber?: string | undefined
	lifecycleSubmissionMode?: 'private' | 'public' | undefined
	lifecycleTargetBlockNumber: string | undefined
	lifecycleTokenDecimals: string | undefined
	lifecycleTransactionIntent?: DurableTransactionIntent | undefined
	lifecycleTransactionNonce?: string | undefined
	lifecycleTransactionHashes: readonly Hex[]
	lifecycleUpdatedAt: string | undefined
	lifecycleWalletTokenBefore: string | undefined
	lifecycleWalletWethBefore: string | undefined
	lockedToken: string
	lockedWeth: string
	manualReconciliation: ManualReconciliation | undefined
	openedAt: string
	reportAmount1?: string | undefined
	reportAmount2?: string | undefined
	reportFeePercentage?: string | undefined
	realizedNetProfitEth: string | undefined
	replacementCreditAmount?: string | undefined
	replacementCreditToken?: Address | undefined
	reportId: string
	status: 'closed' | 'closed-pending-finality' | 'expired-not-included' | 'open' | 'pending-entry' | 'recovery-required' | 'replaced' | 'settled' | 'withdrawing'
	token: Address
	tokenSymbol: string
	withdrawnToken: string
	withdrawnWeth: string
}

const decimal = /^(?:0|[1-9]\d*)(?:\.\d{1,18})?$/
const signedDecimal = /^-?(?:0|[1-9]\d*)(?:\.\d{1,18})?$/

function decimalField(record: Record<string, unknown>, key: string) {
	const value = record[key]
	if (typeof value !== 'string' || !decimal.test(value)) throw new Error(`Position journal ${key} is invalid`)
	return value
}

function decimalAmountAttoEth(value: string) {
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

function optionalIntegerField(record: Record<string, unknown>, key: string) {
	const value = record[key]
	if (value !== undefined && (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value))) throw new Error(`Position journal ${key} is invalid`)
	return value
}

function parseDurableTransactionIntent(value: unknown, label: string): DurableTransactionIntent | undefined {
	if (value === undefined) return undefined
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`Position journal ${label} transaction intent is invalid`)
	const record = value as Record<string, unknown>
	const exactKeys = ['data', 'to', 'value']
	if (Object.keys(record).length !== exactKeys.length || exactKeys.some(key => !(key in record))) throw new Error(`Position journal ${label} transaction intent fields are invalid`)
	if (typeof record['data'] !== 'string' || !/^0x(?:[0-9a-fA-F]{2})*$/.test(record['data'])) throw new Error(`Position journal ${label} transaction calldata is invalid`)
	if (typeof record['to'] !== 'string') throw new Error(`Position journal ${label} transaction destination is invalid`)
	if (typeof record['value'] !== 'string' || !/^(?:0|[1-9]\d*)$/.test(record['value'])) throw new Error(`Position journal ${label} transaction value is invalid`)
	return {
		data: record['data'] as Hex,
		to: getAddress(record['to']),
		value: record['value'],
	}
}

function parseExpiredTransactionAttempts(value: unknown): readonly ExpiredTransactionAttempt[] | undefined {
	if (value === undefined) return undefined
	if (!Array.isArray(value)) throw new Error('Position journal expired transaction attempts are invalid')
	const hashes = new Set<string>()
	return value.map(candidate => {
		if (typeof candidate !== 'object' || candidate === null || Array.isArray(candidate)) throw new Error('Position journal expired transaction attempt is invalid')
		const record = candidate as Record<string, unknown>
		const exactKeys = ['kind', 'nonce', 'targetBlockNumber', 'transactionHash']
		if (Object.keys(record).length !== exactKeys.length || exactKeys.some(key => !(key in record))) throw new Error('Position journal expired transaction attempt fields are invalid')
		if (record['kind'] !== 'entry' && record['kind'] !== 'lifecycle') throw new Error('Position journal expired transaction attempt kind is invalid')
		if (typeof record['nonce'] !== 'string' || !/^(?:0|[1-9]\d*)$/.test(record['nonce'])) throw new Error('Position journal expired transaction nonce is invalid')
		if (typeof record['targetBlockNumber'] !== 'string' || !/^(?:0|[1-9]\d*)$/.test(record['targetBlockNumber'])) throw new Error('Position journal expired transaction target block is invalid')
		if (typeof record['transactionHash'] !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(record['transactionHash'])) throw new Error('Position journal expired transaction hash is invalid')
		const normalizedHash = record['transactionHash'].toLowerCase()
		if (hashes.has(normalizedHash)) throw new Error(`Duplicate position journal expired transaction hash ${normalizedHash}`)
		hashes.add(normalizedHash)
		return {
			kind: record['kind'],
			nonce: record['nonce'],
			targetBlockNumber: record['targetBlockNumber'],
			transactionHash: record['transactionHash'] as Hex,
		}
	})
}

function parseManualReconciliation(value: unknown): ManualReconciliation | undefined {
	if (value === undefined) return undefined
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Position journal manual reconciliation is invalid')
	const record = value as Record<string, unknown>
	const exactKeys = ['evidence', 'externalCostEth', 'finalWalletToken', 'finalWalletWeth', 'note', 'pnlStatus', 'recordedAt', 'recordedBy']
	if (Object.keys(record).length !== exactKeys.length || exactKeys.some(key => !(key in record))) throw new Error('Position journal manual reconciliation fields are invalid')
	if (typeof record['evidence'] !== 'string' || record['evidence'].trim() === '' || record['evidence'].length > 2_048) throw new Error('Position journal reconciliation evidence is invalid')
	if (typeof record['note'] !== 'string' || record['note'].trim() === '' || record['note'].length > 2_048) throw new Error('Position journal reconciliation note is invalid')
	if (record['pnlStatus'] !== 'recorded' && record['pnlStatus'] !== 'unavailable') throw new Error('Position journal reconciliation P&L status is invalid')
	if (typeof record['recordedAt'] !== 'string' || !Number.isFinite(Date.parse(record['recordedAt']))) throw new Error('Position journal reconciliation timestamp is invalid')
	if (typeof record['recordedBy'] !== 'string') throw new Error('Position journal reconciliation signer is invalid')
	for (const key of ['externalCostEth', 'finalWalletToken', 'finalWalletWeth']) decimalField(record, key)
	return {
		evidence: record['evidence'],
		externalCostEth: decimalField(record, 'externalCostEth'),
		finalWalletToken: decimalField(record, 'finalWalletToken'),
		finalWalletWeth: decimalField(record, 'finalWalletWeth'),
		note: record['note'],
		pnlStatus: record['pnlStatus'],
		recordedAt: record['recordedAt'],
		recordedBy: getAddress(record['recordedBy']),
	}
}

function parseExecutionIntent(value: unknown): ExecutionIntent | undefined {
	if (value === undefined) return undefined
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Position journal execution intent is invalid')
	const record = value as Record<string, unknown>
	const exactKeys = ['direction', 'estimatedNetProfitWeth', 'estimatedProfitBeforeGasEth', 'pool', 'poolFee', 'reportId', 'requiredToken', 'requiredWeth', 'token', 'tokenSymbol']
	if (Object.keys(record).length !== exactKeys.length || exactKeys.some(key => !(key in record))) throw new Error('Position journal execution intent fields are invalid')
	const parsed = parseExecutionRecord({
		...record,
		actualGasCostEth: '0',
		blockNumber: '0',
		executedAt: '1970-01-01T00:00:00.000Z',
		trackedNetProfitEth: '0',
		transactionHash: `0x${'0'.repeat(64)}`,
	})
	if (parsed === undefined) throw new Error('Position journal execution intent is invalid')
	const { actualGasCostEth: _actualGasCostEth, blockNumber: _blockNumber, executedAt: _executedAt, trackedNetProfitEth: _trackedNetProfitEth, transactionHash: _transactionHash, ...intent } = parsed
	return intent
}

function parsePosition(value: unknown): PositionRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Position journal record must be an object')
	const record = value as Record<string, unknown>
	if (typeof record['account'] !== 'string') throw new Error('Position journal account is invalid')
	const account = getAddress(record['account'])
	if (typeof record['reportId'] !== 'string' || !/^(?:0|[1-9]\d*)$/.test(record['reportId'])) throw new Error('Position journal report id is invalid')
	if (record['direction'] !== 'buy-rep' && record['direction'] !== 'sell-rep') throw new Error('Position journal direction is invalid')
	if (!['closed', 'closed-pending-finality', 'expired-not-included', 'open', 'pending-entry', 'recovery-required', 'replaced', 'settled', 'withdrawing'].includes(String(record['status']))) throw new Error('Position journal status is invalid')
	if (typeof record['entryTransactionHash'] !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(record['entryTransactionHash'])) throw new Error('Position journal transaction hash is invalid')
	const entryTransactionHashes = record['entryTransactionHashes']
	if (!Array.isArray(entryTransactionHashes) || entryTransactionHashes.length === 0 || entryTransactionHashes.some(hash => typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash))) {
		throw new Error('Position journal transaction hashes are invalid')
	}
	const lastEntryHash = entryTransactionHashes.at(-1)
	if (typeof lastEntryHash !== 'string' || lastEntryHash.toLowerCase() !== record['entryTransactionHash'].toLowerCase()) throw new Error('Position journal executor transaction must be last')
	if (typeof record['token'] !== 'string') throw new Error('Position journal token is invalid')
	const token = getAddress(record['token'])
	const gasExpenditures = record['gasExpenditures']
	if (!Array.isArray(gasExpenditures)) throw new Error('Position journal gas expenditures are invalid')
	const gasTransactionHashes = new Set<string>()
	const parsedGasExpenditures = gasExpenditures.map(value => {
		if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Position journal gas expenditure is invalid')
		const expenditure = value as Record<string, unknown>
		if (Object.keys(expenditure).length !== 3 || !('costEth' in expenditure) || !('minedAt' in expenditure) || !('transactionHash' in expenditure)) throw new Error('Position journal gas expenditure fields are invalid')
		const costEth = decimalField(expenditure, 'costEth')
		if (typeof expenditure['minedAt'] !== 'string' || !Number.isFinite(Date.parse(expenditure['minedAt'])) || new Date(expenditure['minedAt']).toISOString() !== expenditure['minedAt']) {
			throw new Error('Position journal gas expenditure minedAt must be canonical UTC ISO')
		}
		if (typeof expenditure['transactionHash'] !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(expenditure['transactionHash'])) throw new Error('Position journal gas expenditure transaction hash is invalid')
		const transactionHash = expenditure['transactionHash'].toLowerCase()
		if (gasTransactionHashes.has(transactionHash)) throw new Error(`Duplicate position journal gas expenditure transaction hash ${transactionHash}`)
		gasTransactionHashes.add(transactionHash)
		return {
			costEth,
			minedAt: expenditure['minedAt'],
			transactionHash: expenditure['transactionHash'] as Hex,
		}
	})
	for (const key of ['actualEntryGasCostEth', 'capitalAtRiskWeth', 'hedgeAmountToken', 'hedgeWeth', 'lifecycleGasCostEth', 'lockedToken', 'lockedWeth', 'withdrawnToken', 'withdrawnWeth']) {
		decimalField(record, key)
	}
	const entrySubmissionBlockNumber = optionalIntegerField(record, 'entrySubmissionBlockNumber')
	const entryTransactionNonce = optionalIntegerField(record, 'entryTransactionNonce')
	const entryTransactionIntent = parseDurableTransactionIntent(record['entryTransactionIntent'], 'entry')
	if ((entrySubmissionBlockNumber === undefined) !== (entryTransactionNonce === undefined)) throw new Error('Position journal entry replacement recovery fields are incomplete')
	if (record['entrySubmissionMode'] !== undefined && record['entrySubmissionMode'] !== 'private' && record['entrySubmissionMode'] !== 'public') throw new Error('Position journal entry submission mode is invalid')
	if ((record['entrySubmissionMode'] === undefined) !== (entrySubmissionBlockNumber === undefined)) throw new Error('Position journal entry replacement recovery mode is incomplete')
	const expectedGasCost = decimalAmountAttoEth(decimalField(record, 'actualEntryGasCostEth')) + decimalAmountAttoEth(decimalField(record, 'lifecycleGasCostEth'))
	const recordedGasCost = parsedGasExpenditures.reduce((total, expenditure) => total + decimalAmountAttoEth(expenditure.costEth), 0n)
	if (recordedGasCost !== expectedGasCost) throw new Error('Position journal gas expenditure total does not match entry and lifecycle gas')
	const historyOutbox = record['historyOutbox'] === undefined ? undefined : parseExecutionRecord(record['historyOutbox'])
	if (record['historyOutbox'] !== undefined && historyOutbox === undefined) throw new Error('Position journal history outbox is invalid')
	const executionIntent = parseExecutionIntent(record['executionIntent'])
	const expiredTransactionAttempts = parseExpiredTransactionAttempts(record['expiredTransactionAttempts'])
	if (executionIntent !== undefined && (executionIntent.reportId !== record['reportId'] || executionIntent.direction !== record['direction'] || executionIntent.token.toLowerCase() !== token.toLowerCase())) {
		throw new Error('Position journal execution intent does not match its position')
	}
	if (
		historyOutbox !== undefined &&
		(historyOutbox.reportId !== record['reportId'] ||
			historyOutbox.direction !== record['direction'] ||
			historyOutbox.token.toLowerCase() !== token.toLowerCase() ||
			historyOutbox.transactionHash.toLowerCase() !== String(record['entryTransactionHash']).toLowerCase() ||
			historyOutbox.actualGasCostEth !== record['actualEntryGasCostEth'])
	) {
		throw new Error('Position journal history outbox does not match its confirmed position')
	}
	if (typeof record['hedgedProfitBeforeGasEth'] !== 'string' || !signedDecimal.test(record['hedgedProfitBeforeGasEth'])) throw new Error('Position journal hedged profit is invalid')
	if (record['realizedNetProfitEth'] !== undefined && (typeof record['realizedNetProfitEth'] !== 'string' || !signedDecimal.test(record['realizedNetProfitEth']))) throw new Error('Position journal realized profit is invalid')
	if (record['lifecycleSettlerRewardEth'] !== undefined && (typeof record['lifecycleSettlerRewardEth'] !== 'string' || !decimal.test(record['lifecycleSettlerRewardEth']))) {
		throw new Error('Position journal lifecycle settler reward is invalid')
	}
	if (typeof record['openedAt'] !== 'string' || !Number.isFinite(Date.parse(record['openedAt']))) throw new Error('Position journal openedAt is invalid')
	if (record['lifecycleUpdatedAt'] !== undefined && (typeof record['lifecycleUpdatedAt'] !== 'string' || !Number.isFinite(Date.parse(record['lifecycleUpdatedAt'])))) throw new Error('Position journal lifecycleUpdatedAt is invalid')
	if (typeof record['lifecycleReceiptRecovered'] !== 'boolean') throw new Error('Position journal lifecycle receipt recovery marker is invalid')
	const lifecycleReceiptBlockNumber = optionalIntegerField(record, 'lifecycleReceiptBlockNumber')
	const lifecycleReceiptBlockHash = record['lifecycleReceiptBlockHash']
	if (lifecycleReceiptBlockHash !== undefined && (typeof lifecycleReceiptBlockHash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(lifecycleReceiptBlockHash))) {
		throw new Error('Position journal lifecycle receipt block hash is invalid')
	}
	if ((lifecycleReceiptBlockNumber === undefined) !== (lifecycleReceiptBlockHash === undefined)) throw new Error('Position journal lifecycle receipt finality fields are incomplete')
	if (record['status'] === 'closed-pending-finality' && (lifecycleReceiptBlockNumber === undefined || record['lifecycleReceiptRecovered'] !== true)) {
		throw new Error('Position journal pending lifecycle finality evidence is incomplete')
	}
	if (record['status'] !== 'closed-pending-finality' && lifecycleReceiptBlockNumber !== undefined) throw new Error('Position journal lifecycle receipt finality evidence has an invalid status')
	const lifecycleTransactionHashes = record['lifecycleTransactionHashes']
	if (!Array.isArray(lifecycleTransactionHashes) || lifecycleTransactionHashes.some(hash => typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash))) {
		throw new Error('Position journal lifecycle transaction hashes are invalid')
	}
	const lifecycleFields = ['lifecycleTargetBlockNumber', 'lifecycleTokenDecimals'] as const
	for (const key of [...lifecycleFields, 'lifecycleWalletTokenBefore', 'lifecycleWalletWethBefore'] as const) optionalIntegerField(record, key)
	const hasLifecycleState = lifecycleTransactionHashes.length !== 0 || record['lifecycleTargetBlockNumber'] === '0'
	if (lifecycleFields.some(key => (record[key] !== undefined) !== hasLifecycleState)) throw new Error('Position journal lifecycle recovery fields are incomplete')
	if ((record['lifecycleWalletTokenBefore'] === undefined) !== (record['lifecycleWalletWethBefore'] === undefined)) {
		throw new Error('Position journal legacy lifecycle wallet snapshots are incomplete')
	}
	const lifecycleSubmissionBlockNumber = optionalIntegerField(record, 'lifecycleSubmissionBlockNumber')
	const lifecycleTransactionNonce = optionalIntegerField(record, 'lifecycleTransactionNonce')
	const lifecycleTransactionIntent = parseDurableTransactionIntent(record['lifecycleTransactionIntent'], 'lifecycle')
	if ((lifecycleSubmissionBlockNumber === undefined) !== (lifecycleTransactionNonce === undefined)) throw new Error('Position journal lifecycle replacement recovery fields are incomplete')
	if (record['lifecycleSubmissionMode'] !== undefined && record['lifecycleSubmissionMode'] !== 'private' && record['lifecycleSubmissionMode'] !== 'public') throw new Error('Position journal lifecycle submission mode is invalid')
	if ((record['lifecycleSubmissionMode'] === undefined) !== (lifecycleSubmissionBlockNumber === undefined)) throw new Error('Position journal lifecycle replacement recovery mode is incomplete')
	if (record['lifecycleKind'] !== undefined && record['lifecycleKind'] !== 'replacement-credit' && record['lifecycleKind'] !== 'settlement') throw new Error('Position journal lifecycle kind is invalid')
	const reportAmount1 = optionalIntegerField(record, 'reportAmount1')
	const reportAmount2 = optionalIntegerField(record, 'reportAmount2')
	const reportFeePercentage = optionalIntegerField(record, 'reportFeePercentage')
	const reportAccountingFieldCount = [reportAmount1, reportAmount2, reportFeePercentage].filter(value => value !== undefined).length
	if (reportAccountingFieldCount !== 0 && reportAccountingFieldCount !== 3) throw new Error('Position journal report accounting fields are incomplete')
	const replacementCreditAmount = optionalIntegerField(record, 'replacementCreditAmount')
	let replacementCreditToken: Address | undefined
	if (record['replacementCreditToken'] !== undefined) {
		if (typeof record['replacementCreditToken'] !== 'string') throw new Error('Position journal replacement credit token is invalid')
		replacementCreditToken = getAddress(record['replacementCreditToken'])
	}
	if ((replacementCreditAmount === undefined) !== (replacementCreditToken === undefined)) throw new Error('Position journal replacement credit fields are incomplete')
	if (record['lifecycleKind'] === 'replacement-credit' && (replacementCreditAmount === undefined || replacementCreditToken === undefined)) throw new Error('Position journal replacement lifecycle is incomplete')
	if (
		record['status'] === 'closed-pending-finality' &&
		(lifecycleTransactionHashes.length !== 1 ||
			record['lifecycleTargetBlockNumber'] === undefined ||
			record['lifecycleTokenDecimals'] === undefined ||
			lifecycleSubmissionBlockNumber === undefined ||
			record['lifecycleSubmissionMode'] === undefined ||
			lifecycleTransactionIntent === undefined ||
			lifecycleTransactionNonce === undefined ||
			record['lifecycleUpdatedAt'] === undefined ||
			record['lifecycleSettlerRewardEth'] === undefined ||
			record['closedAt'] !== undefined ||
			record['realizedNetProfitEth'] !== undefined)
	) {
		throw new Error('Position journal pending lifecycle finality recovery journal is incomplete')
	}
	if (record['closedAt'] !== undefined && (typeof record['closedAt'] !== 'string' || !Number.isFinite(Date.parse(record['closedAt'])))) throw new Error('Position journal closedAt is invalid')
	if (typeof record['tokenSymbol'] !== 'string' || record['tokenSymbol'].trim() === '') throw new Error('Position journal token symbol is invalid')
	const manualReconciliation = parseManualReconciliation(record['manualReconciliation'])
	if (manualReconciliation !== undefined) {
		if (record['status'] !== 'closed' || record['closedAt'] !== manualReconciliation.recordedAt) throw new Error('Position journal manual reconciliation state is inconsistent')
		const hasRealizedPnl = record['realizedNetProfitEth'] !== undefined
		if ((manualReconciliation.pnlStatus === 'recorded') !== hasRealizedPnl) throw new Error('Position journal manual reconciliation P&L is inconsistent')
	}
	return {
		account,
		actualEntryGasCostEth: decimalField(record, 'actualEntryGasCostEth'),
		capitalAtRiskWeth: decimalField(record, 'capitalAtRiskWeth'),
		closedAt: record['closedAt'],
		direction: record['direction'],
		entrySubmissionBlockNumber,
		entrySubmissionMode: record['entrySubmissionMode'],
		...(entryTransactionIntent === undefined ? {} : { entryTransactionIntent }),
		entryTransactionNonce,
		entryTransactionHash: record['entryTransactionHash'] as Hex,
		entryTransactionHashes: entryTransactionHashes as Hex[],
		executionIntent,
		...(expiredTransactionAttempts === undefined ? {} : { expiredTransactionAttempts }),
		gasExpenditures: parsedGasExpenditures,
		historyOutbox,
		hedgeAmountToken: decimalField(record, 'hedgeAmountToken'),
		hedgeWeth: decimalField(record, 'hedgeWeth'),
		hedgedProfitBeforeGasEth: record['hedgedProfitBeforeGasEth'],
		lifecycleGasCostEth: decimalField(record, 'lifecycleGasCostEth'),
		lifecycleKind: record['lifecycleKind'],
		...(lifecycleReceiptBlockHash === undefined ? {} : { lifecycleReceiptBlockHash: lifecycleReceiptBlockHash as Hex }),
		...(lifecycleReceiptBlockNumber === undefined ? {} : { lifecycleReceiptBlockNumber }),
		lifecycleReceiptRecovered: record['lifecycleReceiptRecovered'],
		...(record['lifecycleSettlerRewardEth'] === undefined ? {} : { lifecycleSettlerRewardEth: record['lifecycleSettlerRewardEth'] }),
		lifecycleSubmissionBlockNumber,
		lifecycleSubmissionMode: record['lifecycleSubmissionMode'],
		lifecycleTargetBlockNumber: optionalIntegerField(record, 'lifecycleTargetBlockNumber'),
		lifecycleTokenDecimals: optionalIntegerField(record, 'lifecycleTokenDecimals'),
		...(lifecycleTransactionIntent === undefined ? {} : { lifecycleTransactionIntent }),
		lifecycleTransactionNonce,
		lifecycleTransactionHashes: lifecycleTransactionHashes as Hex[],
		lifecycleUpdatedAt: record['lifecycleUpdatedAt'],
		lifecycleWalletTokenBefore: optionalIntegerField(record, 'lifecycleWalletTokenBefore'),
		lifecycleWalletWethBefore: optionalIntegerField(record, 'lifecycleWalletWethBefore'),
		lockedToken: decimalField(record, 'lockedToken'),
		lockedWeth: decimalField(record, 'lockedWeth'),
		manualReconciliation,
		openedAt: record['openedAt'],
		reportAmount1,
		reportAmount2,
		reportFeePercentage,
		realizedNetProfitEth: record['realizedNetProfitEth'],
		replacementCreditAmount,
		replacementCreditToken,
		reportId: record['reportId'],
		status: record['status'] as PositionRecord['status'],
		token,
		tokenSymbol: record['tokenSymbol'],
		withdrawnToken: decimalField(record, 'withdrawnToken'),
		withdrawnWeth: decimalField(record, 'withdrawnWeth'),
	}
}

export function manuallyReconcilePosition(
	position: PositionRecord,
	parameters: {
		confirmedReportId: string
		evidence: string
		externalCostEth: string
		finalWalletToken: string
		finalWalletWeth: string
		note: string
		pnlUnavailable: boolean
		realizedNetProfitEth: string | undefined
		recordedAt?: string | undefined
		recordedBy: Address
	},
) {
	if (position.status !== 'recovery-required') throw new Error(`Position ${position.reportId} is not recovery-required`)
	if (parameters.confirmedReportId !== position.reportId) throw new Error('Typed report confirmation does not match the position')
	if (parameters.recordedBy.toLowerCase() !== position.account.toLowerCase()) throw new Error('Only the position signer can record manual reconciliation')
	if (parameters.pnlUnavailable === (parameters.realizedNetProfitEth !== undefined)) throw new Error('Choose exactly one of realized P&L or P&L unavailable')
	if (position.actualEntryGasCostEth === '0' && parameters.realizedNetProfitEth !== undefined) throw new Error('Realized P&L cannot be recorded without recovered entry evidence')
	const recordedAt = parameters.recordedAt ?? new Date().toISOString()
	const reconciliation = parseManualReconciliation({
		evidence: parameters.evidence,
		externalCostEth: parameters.externalCostEth,
		finalWalletToken: parameters.finalWalletToken,
		finalWalletWeth: parameters.finalWalletWeth,
		note: parameters.note,
		pnlStatus: parameters.pnlUnavailable ? 'unavailable' : 'recorded',
		recordedAt,
		recordedBy: parameters.recordedBy,
	})
	if (reconciliation === undefined) throw new Error('Manual reconciliation is required')
	if (parameters.realizedNetProfitEth !== undefined && !signedDecimal.test(parameters.realizedNetProfitEth)) throw new Error('Manual reconciliation realized P&L is invalid')
	return {
		...position,
		closedAt: recordedAt,
		manualReconciliation: reconciliation,
		realizedNetProfitEth: parameters.realizedNetProfitEth,
		status: 'closed' as const,
	}
}

export async function loadPositionJournal(path: string) {
	let contents: string
	try {
		contents = await readFile(path, 'utf8')
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT') return []
		throw error
	}
	let parsed: unknown
	try {
		parsed = JSON.parse(contents)
	} catch (error) {
		if (error instanceof SyntaxError) throw new Error(`Invalid position journal JSON: ${error.message}`)
		throw error
	}
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('Invalid position journal root')
	const root = parsed as Record<string, unknown>
	if (root['version'] !== 1 || !Array.isArray(root['positions'])) throw new Error('Invalid position journal schema')
	const positions = root['positions'].map(parsePosition)
	const ids = new Set<string>()
	for (const position of positions) {
		if (ids.has(position.reportId)) throw new Error(`Duplicate position journal report id ${position.reportId}`)
		ids.add(position.reportId)
	}
	return positions
}

export function acquirePositionJournalLock(path: string, filesystem: PositionJournalFilesystem = positionJournalFilesystem) {
	return acquireFileProcessLock(path, 'Position journal', filesystem)
}

export function acquireExecutionSignerLock(chainId: number, account: Address, filesystem: PositionJournalFilesystem = positionJournalFilesystem) {
	return acquireSharedExecutionSignerLock(chainId, account, filesystem)
}

export async function savePositionJournal(path: string, positions: readonly PositionRecord[], filesystem: PositionJournalFilesystem = positionJournalFilesystem) {
	const ids = new Set<string>()
	for (const position of positions) {
		parsePosition(position)
		if (ids.has(position.reportId)) throw new Error(`Duplicate position journal report id ${position.reportId}`)
		ids.add(position.reportId)
	}
	await filesystem.mkdir(dirname(path), { mode: 0o700, recursive: true })
	const temporaryPath = `${path}.${process.pid.toString()}.${randomUUID()}.tmp`
	try {
		const fileHandle = await filesystem.open(temporaryPath, 'wx', 0o600)
		try {
			await fileHandle.writeFile(`${JSON.stringify({ positions, version: 1 }, undefined, 2)}\n`, { encoding: 'utf8' })
			await fileHandle.chmod(0o600)
			await fileHandle.sync()
		} finally {
			await fileHandle.close()
		}
		await filesystem.rename(temporaryPath, path)
		const directoryHandle = await filesystem.open(dirname(path), 'r')
		try {
			await directoryHandle.sync()
		} finally {
			await directoryHandle.close()
		}
	} catch (error) {
		await filesystem.rm(temporaryPath, { force: true })
		throw error
	}
}

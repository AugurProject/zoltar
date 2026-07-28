import { randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { getAddress, type Address, type Hex } from '@zoltar/shared/ethereum'

type PositionJournalFileHandle = {
	chmod: (mode: number) => Promise<unknown>
	close: () => Promise<unknown>
	sync: () => Promise<unknown>
	writeFile: (data: string, options: { encoding: 'utf8' }) => Promise<unknown>
}

export type PositionJournalFilesystem = {
	mkdir: (path: string, options: { mode: number; recursive: true }) => Promise<unknown>
	open: (path: string, flags: 'r' | 'wx', mode?: number) => Promise<PositionJournalFileHandle>
	readFile: (path: string, encoding: 'utf8') => Promise<string>
	rename: (oldPath: string, newPath: string) => Promise<unknown>
	rm: (path: string, options: { force: true }) => Promise<unknown>
}

export type ExclusiveProcessLock = {
	path: string
	release: () => Promise<void>
}

const positionJournalFilesystem: PositionJournalFilesystem = {
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

export type PositionRecord = {
	account: Address
	actualEntryGasCostEth: string
	capitalAtRiskWeth: string
	closedAt: string | undefined
	direction: 'buy-rep' | 'sell-rep'
	entryTransactionHash: Hex
	entryTransactionHashes: readonly Hex[]
	gasExpenditures: readonly {
		costEth: string
		minedAt: string
		transactionHash: Hex
	}[]
	hedgeAmountToken: string
	hedgeWeth: string
	hedgedProfitBeforeGasEth: string
	lifecycleGasCostEth: string
	lifecycleReceiptRecovered: boolean
	lifecycleTargetBlockNumber: string | undefined
	lifecycleTokenDecimals: string | undefined
	lifecycleTransactionHashes: readonly Hex[]
	lifecycleUpdatedAt: string | undefined
	lifecycleWalletTokenBefore: string | undefined
	lifecycleWalletWethBefore: string | undefined
	lockedToken: string
	lockedWeth: string
	manualReconciliation: ManualReconciliation | undefined
	openedAt: string
	realizedNetProfitEth: string | undefined
	reportId: string
	status: 'closed' | 'open' | 'pending-entry' | 'recovery-required' | 'replaced' | 'settled' | 'withdrawing'
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

function decimalAmountWei(value: string) {
	const [whole = '0', fraction = ''] = value.split('.')
	return BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0'))
}

function optionalIntegerField(record: Record<string, unknown>, key: string) {
	const value = record[key]
	if (value !== undefined && (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/.test(value))) throw new Error(`Position journal ${key} is invalid`)
	return value
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

function parsePosition(value: unknown): PositionRecord {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Position journal record must be an object')
	const record = value as Record<string, unknown>
	if (typeof record['account'] !== 'string') throw new Error('Position journal account is invalid')
	const account = getAddress(record['account'])
	if (typeof record['reportId'] !== 'string' || !/^(?:0|[1-9]\d*)$/.test(record['reportId'])) throw new Error('Position journal report id is invalid')
	if (record['direction'] !== 'buy-rep' && record['direction'] !== 'sell-rep') throw new Error('Position journal direction is invalid')
	if (!['closed', 'open', 'pending-entry', 'recovery-required', 'replaced', 'settled', 'withdrawing'].includes(String(record['status']))) throw new Error('Position journal status is invalid')
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
		if (typeof expenditure['minedAt'] !== 'string' || !Number.isFinite(Date.parse(expenditure['minedAt']))) throw new Error('Position journal gas expenditure minedAt is invalid')
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
	const expectedGasCost = decimalAmountWei(decimalField(record, 'actualEntryGasCostEth')) + decimalAmountWei(decimalField(record, 'lifecycleGasCostEth'))
	const recordedGasCost = parsedGasExpenditures.reduce((total, expenditure) => total + decimalAmountWei(expenditure.costEth), 0n)
	if (recordedGasCost !== expectedGasCost) throw new Error('Position journal gas expenditure total does not match entry and lifecycle gas')
	if (typeof record['hedgedProfitBeforeGasEth'] !== 'string' || !signedDecimal.test(record['hedgedProfitBeforeGasEth'])) throw new Error('Position journal hedged profit is invalid')
	if (record['realizedNetProfitEth'] !== undefined && (typeof record['realizedNetProfitEth'] !== 'string' || !signedDecimal.test(record['realizedNetProfitEth']))) throw new Error('Position journal realized profit is invalid')
	if (typeof record['openedAt'] !== 'string' || !Number.isFinite(Date.parse(record['openedAt']))) throw new Error('Position journal openedAt is invalid')
	if (record['lifecycleUpdatedAt'] !== undefined && (typeof record['lifecycleUpdatedAt'] !== 'string' || !Number.isFinite(Date.parse(record['lifecycleUpdatedAt'])))) throw new Error('Position journal lifecycleUpdatedAt is invalid')
	if (typeof record['lifecycleReceiptRecovered'] !== 'boolean') throw new Error('Position journal lifecycle receipt recovery marker is invalid')
	const lifecycleTransactionHashes = record['lifecycleTransactionHashes']
	if (!Array.isArray(lifecycleTransactionHashes) || lifecycleTransactionHashes.some(hash => typeof hash !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(hash))) {
		throw new Error('Position journal lifecycle transaction hashes are invalid')
	}
	const lifecycleFields = ['lifecycleTargetBlockNumber', 'lifecycleTokenDecimals', 'lifecycleWalletTokenBefore', 'lifecycleWalletWethBefore'] as const
	for (const key of lifecycleFields) optionalIntegerField(record, key)
	const hasLifecycleAttempt = lifecycleTransactionHashes.length !== 0
	if (lifecycleFields.some(key => (record[key] !== undefined) !== hasLifecycleAttempt)) throw new Error('Position journal lifecycle recovery fields are incomplete')
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
		entryTransactionHash: record['entryTransactionHash'] as Hex,
		entryTransactionHashes: entryTransactionHashes as Hex[],
		gasExpenditures: parsedGasExpenditures,
		hedgeAmountToken: decimalField(record, 'hedgeAmountToken'),
		hedgeWeth: decimalField(record, 'hedgeWeth'),
		hedgedProfitBeforeGasEth: record['hedgedProfitBeforeGasEth'],
		lifecycleGasCostEth: decimalField(record, 'lifecycleGasCostEth'),
		lifecycleReceiptRecovered: record['lifecycleReceiptRecovered'],
		lifecycleTargetBlockNumber: optionalIntegerField(record, 'lifecycleTargetBlockNumber'),
		lifecycleTokenDecimals: optionalIntegerField(record, 'lifecycleTokenDecimals'),
		lifecycleTransactionHashes: lifecycleTransactionHashes as Hex[],
		lifecycleUpdatedAt: record['lifecycleUpdatedAt'],
		lifecycleWalletTokenBefore: optionalIntegerField(record, 'lifecycleWalletTokenBefore'),
		lifecycleWalletWethBefore: optionalIntegerField(record, 'lifecycleWalletWethBefore'),
		lockedToken: decimalField(record, 'lockedToken'),
		lockedWeth: decimalField(record, 'lockedWeth'),
		manualReconciliation,
		openedAt: record['openedAt'],
		realizedNetProfitEth: record['realizedNetProfitEth'],
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

async function acquireExclusiveProcessLock(lockPath: string, subject: string, metadata: Record<string, string | number>, filesystem: PositionJournalFilesystem): Promise<ExclusiveProcessLock> {
	await filesystem.mkdir(dirname(lockPath), { mode: 0o700, recursive: true })
	let handle: PositionJournalFileHandle
	try {
		handle = await filesystem.open(lockPath, 'wx', 0o600)
	} catch (error) {
		if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'EEXIST') {
			let owner = 'owner metadata unavailable'
			try {
				owner = (await filesystem.readFile(lockPath, 'utf8')).trim()
			} catch (readError) {
				void readError
			}
			throw new Error(`${subject} is already locked (${owner}). Stop the other process before removing ${lockPath}.`)
		}
		throw error
	}
	const payload = `${JSON.stringify({ acquiredAt: new Date().toISOString(), ...metadata, pid: process.pid })}\n`
	try {
		await handle.writeFile(payload, { encoding: 'utf8' })
		await handle.chmod(0o600)
		await handle.sync()
	} catch (error) {
		await handle.close()
		await filesystem.rm(lockPath, { force: true })
		throw error
	}
	let released = false
	return {
		path: lockPath,
		release: async () => {
			if (released) return
			released = true
			await handle.close()
			let current: string
			try {
				current = await filesystem.readFile(lockPath, 'utf8')
			} catch (error) {
				throw new Error(`Position journal lock ${lockPath} disappeared before release: ${error instanceof Error ? error.message : String(error)}`)
			}
			if (current !== payload) throw new Error(`Position journal lock ${lockPath} changed ownership before release`)
			await filesystem.rm(lockPath, { force: true })
		},
	}
}

export function acquirePositionJournalLock(path: string, filesystem: PositionJournalFilesystem = positionJournalFilesystem) {
	const resolvedPath = resolve(path)
	return acquireExclusiveProcessLock(`${resolvedPath}.lock`, `Position journal ${resolvedPath}`, { journal: resolvedPath }, filesystem)
}

export function acquireExecutionSignerLock(chainId: number, account: Address, filesystem: PositionJournalFilesystem = positionJournalFilesystem) {
	if (!Number.isSafeInteger(chainId) || chainId <= 0) throw new Error('Execution signer lock chain id is invalid')
	const signer = getAddress(account)
	const lockPath = join(tmpdir(), 'zoltar-open-oracle-arbitrager-locks', `${chainId.toString()}-${signer.toLowerCase()}.lock`)
	return acquireExclusiveProcessLock(lockPath, `Execution signer ${signer} on chain ${chainId.toString()}`, { chainId, signer }, filesystem)
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

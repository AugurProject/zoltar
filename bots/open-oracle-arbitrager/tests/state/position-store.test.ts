import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAddress } from '#ethereum'
import { acquireExecutionSignerLock, acquirePositionJournalLock, loadPositionJournal, loadPositionJournalState, manuallyReconcilePosition, savePositionJournal, savePositionJournalState, type PositionJournalFilesystem, type PositionRecord } from '#state/position-store'

const directories: string[] = []

function terminalPosition(index: number, overrides: Partial<PositionRecord> = {}): PositionRecord {
	return {
		account: getAddress('0x0000000000000000000000000000000000000002'),
		actualEntryGasCostEth: '0.001',
		capitalAtRiskWeth: '0',
		closedAt: '2026-01-01T01:00:00.000Z',
		direction: 'sell-rep',
		entryTransactionHash: `0x${'11'.repeat(32)}`,
		entryTransactionHashes: [`0x${'11'.repeat(32)}`],
		gasExpenditures: [{ costEth: '0.001', minedAt: '2026-01-01T00:00:00.000Z', transactionHash: `0x${'11'.repeat(32)}` }],
		historyOutbox: undefined,
		hedgeAmountToken: '1',
		hedgeWeth: '1',
		hedgedProfitBeforeGasEth: '0.1',
		lifecycleGasCostEth: '0',
		lifecycleReceiptRecovered: false,
		lifecycleTargetBlockNumber: undefined,
		lifecycleTokenDecimals: undefined,
		lifecycleTransactionHashes: [],
		lifecycleUpdatedAt: undefined,
		lifecycleWalletTokenBefore: undefined,
		lifecycleWalletWethBefore: undefined,
		lockedToken: '0',
		lockedWeth: '0',
		manualReconciliation: undefined,
		openedAt: '2026-01-01T00:00:00.000Z',
		realizedNetProfitEth: '0.1',
		reportId: (index + 1).toString(),
		status: 'closed',
		token: getAddress('0x0000000000000000000000000000000000000001'),
		tokenSymbol: 'REP',
		withdrawnToken: '1',
		withdrawnWeth: '1',
		...overrides,
	}
}

afterEach(async () => {
	await Promise.all(directories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('durable OpenOracle position journal', () => {
	test('allows only one lifetime owner of a journal', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		const first = await acquirePositionJournalLock(path)
		await expect(acquirePositionJournalLock(path)).rejects.toThrow('already locked')
		await first.release()
		const second = await acquirePositionJournalLock(path)
		await second.release()
	})

	test('rejects a journal lock directory writable by other users', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		await chmod(directory, 0o777)
		await expect(acquirePositionJournalLock(join(directory, 'positions.json'))).rejects.toThrow('unsafe permissions')
	})

	test('allows only one process to execute with a signer on a network', async () => {
		const signer = getAddress('0x0000000000000000000000000000000000000002')
		const first = await acquireExecutionSignerLock(31_337, signer)
		await expect(acquireExecutionSignerLock(31_337, signer)).rejects.toThrow('already locked')
		await first.release()
		const second = await acquireExecutionSignerLock(31_337, signer)
		await second.release()
	})

	test('syncs journal contents and the parent directory before returning', async () => {
		const events: string[] = []
		let opened = 0
		const fileHandle = {
			chmod: async () => {
				events.push('file:chmod')
			},
			close: async () => {
				events.push('file:close')
			},
			sync: async () => {
				events.push('file:sync')
			},
			writeFile: async () => {
				events.push('file:write')
			},
		}
		const directoryHandle = {
			chmod: async () => {
				throw new Error('directory chmod is unexpected')
			},
			close: async () => {
				events.push('directory:close')
			},
			sync: async () => {
				events.push('directory:sync')
			},
			writeFile: async () => {
				throw new Error('directory write is unexpected')
			},
		}
		const filesystem: PositionJournalFilesystem = {
			mkdir: async () => {
				events.push('mkdir')
			},
			open: async (_path, flags) => {
				events.push(`open:${flags}`)
				opened += 1
				return opened === 1 ? fileHandle : directoryHandle
			},
			readFile: async () => {
				throw new Error('read is unexpected')
			},
			rename: async () => {
				events.push('rename')
			},
			rm: async () => {
				events.push('rm')
			},
		}
		await savePositionJournal('/positions.json', [], 1, filesystem)
		expect(events).toEqual(['mkdir', 'open:wx', 'file:write', 'file:chmod', 'file:sync', 'file:close', 'rename', 'open:r', 'directory:sync', 'directory:close'])
	})

	test('round-trips a recoverable position with owner-only storage', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		const position = {
			account: getAddress('0x0000000000000000000000000000000000000002'),
			actualEntryGasCostEth: '0.001',
			capitalAtRiskWeth: '2',
			closedAt: undefined,
			direction: 'sell-rep',
			entrySubmissionBlockNumber: '99',
			entrySubmissionMode: 'public',
			entryTransactionIntent: {
				data: '0x1234',
				to: getAddress('0x0000000000000000000000000000000000000004'),
				value: '0',
			},
			entryTransactionNonce: '8',
			entryTransactionHash: `0x${'11'.repeat(32)}`,
			entryTransactionHashes: [`0x${'11'.repeat(32)}`],
			executionIntent: {
				direction: 'sell-rep',
				estimatedNetProfitWeth: '0.05',
				estimatedProfitBeforeGasEth: '0.051',
				pool: getAddress('0x0000000000000000000000000000000000000003'),
				poolFee: 10_000,
				reportId: '7',
				requiredToken: '1',
				requiredWeth: '2',
				token: getAddress('0x0000000000000000000000000000000000000001'),
				tokenSymbol: 'REP',
			},
			expiredTransactionAttempts: [{ kind: 'lifecycle', nonce: '7', targetBlockNumber: '98', transactionHash: `0x${'44'.repeat(32)}` }],
			gasExpenditures: [{ costEth: '0.001', minedAt: '2026-01-01T00:00:00.000Z', transactionHash: `0x${'11'.repeat(32)}` }],
			historyOutbox: undefined,
			hedgeAmountToken: '2',
			hedgeWeth: '1',
			hedgedProfitBeforeGasEth: '0.1',
			lifecycleGasCostEth: '0',
			lifecycleReceiptRecovered: false,
			lifecycleTargetBlockNumber: undefined,
			lifecycleTokenDecimals: undefined,
			lifecycleTransactionHashes: [],
			lifecycleUpdatedAt: undefined,
			lifecycleWalletTokenBefore: undefined,
			lifecycleWalletWethBefore: undefined,
			lockedToken: '2',
			lockedWeth: '1',
			manualReconciliation: undefined,
			openedAt: '2026-01-01T00:00:00.000Z',
			realizedNetProfitEth: undefined,
			reportAmount1: '1000',
			reportAmount2: '2000',
			reportDisputeIndex: '3',
			reportFeePercentage: '10000',
			reportId: '7',
			status: 'open',
			token: getAddress('0x0000000000000000000000000000000000000001'),
			tokenSymbol: 'REP',
			withdrawnToken: '0',
			withdrawnWeth: '0',
		} satisfies PositionRecord
		await savePositionJournal(path, [position], 1)
		expect(await loadPositionJournal(path, 1)).toEqual([position])
		expect((await readFile(path, 'utf8')).toString()).not.toContain('privateKey')
	})

	test('bounds terminal recovery records while retaining their accounting and daily gas totals', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		const terminalPositions = Array.from({ length: 502 }, (_value, index) => terminalPosition(index))

		const saved = await savePositionJournalState(path, { archived: { gasSpentByUtcDay: {}, hedgedProfitBeforeGasEth: '0', positionCount: 0, realizedNetProfitEth: '0' }, positions: terminalPositions }, 1)
		expect(saved.positions).toHaveLength(500)
		expect(saved.archived).toEqual({ gasSpentByUtcDay: { '2026-01-01': '0.002' }, hedgedProfitBeforeGasEth: '0.2', positionCount: 2, realizedNetProfitEth: '0.2' })
		expect(await loadPositionJournalState(path, 1)).toEqual(saved)
	})

	test('retains expired positions until every transaction attempt is impossible or reconciled', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		const positions = [
			...Array.from({ length: 500 }, (_value, index) => terminalPosition(index)),
			...Array.from({ length: 2 }, (_value, index) =>
				terminalPosition(500 + index, {
					expiredTransactionAttempts: [{ kind: 'entry', nonce: (500 + index).toString(), targetBlockNumber: '100', transactionHash: `0x${'22'.repeat(32)}` }],
					status: 'expired-not-included',
				}),
			),
		]

		const saved = await savePositionJournalState(path, { archived: { gasSpentByUtcDay: {}, hedgedProfitBeforeGasEth: '0', positionCount: 0, realizedNetProfitEth: '0' }, positions }, 1)
		expect(saved.positions).toHaveLength(502)
		expect(saved.positions.slice(-2).every(position => position.status === 'expired-not-included')).toBe(true)
		expect(saved.archived.positionCount).toBe(0)
	})

	test('bounds manually reconciled positions with expired attempts while retaining unresolved recovery', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		const reconciled = Array.from({ length: 501 }, (_value, index) => {
			const recovery = terminalPosition(index, {
				closedAt: undefined,
				expiredTransactionAttempts: [{ kind: 'entry', nonce: index.toString(), targetBlockNumber: '100', transactionHash: `0x${'22'.repeat(32)}` }],
				realizedNetProfitEth: undefined,
				status: 'recovery-required',
			})
			return manuallyReconcilePosition(recovery, {
				confirmedReportId: recovery.reportId,
				evidence: `archived recovery evidence ${recovery.reportId}`,
				externalCostEth: '0',
				finalWalletToken: '1',
				finalWalletWeth: '1',
				note: 'Recovery is complete.',
				pnlUnavailable: false,
				realizedNetProfitEth: '0.1',
				recordedAt: '2026-01-02T00:00:00.000Z',
				recordedBy: recovery.account,
			})
		})
		const unresolved = terminalPosition(501, {
			expiredTransactionAttempts: [{ kind: 'entry', nonce: '501', targetBlockNumber: '100', transactionHash: `0x${'33'.repeat(32)}` }],
			status: 'expired-not-included',
		})

		const saved = await savePositionJournalState(path, { archived: { gasSpentByUtcDay: {}, hedgedProfitBeforeGasEth: '0', positionCount: 0, realizedNetProfitEth: '0' }, positions: [...reconciled, unresolved] }, 1)

		expect(saved.positions).toHaveLength(501)
		expect(saved.positions.filter(position => position.manualReconciliation !== undefined)).toHaveLength(500)
		expect(saved.positions.some(position => position.reportId === unresolved.reportId)).toBeTrue()
		expect(saved.archived.positionCount).toBe(1)
	})

	test('rejects a valid position journal bound to another chain', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-chain-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		await savePositionJournal(path, [], 1)
		await expect(loadPositionJournal(path, 11_155_111)).rejects.toThrow('belongs to chain 1')
	})

	test('round-trips the hashes and balance snapshot needed for lifecycle crash recovery', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		const position = {
			account: getAddress('0x0000000000000000000000000000000000000002'),
			actualEntryGasCostEth: '0.001',
			capitalAtRiskWeth: '2',
			closedAt: undefined,
			direction: 'sell-rep',
			entrySubmissionBlockNumber: '99',
			entrySubmissionMode: 'private',
			entryTransactionNonce: '8',
			entryTransactionHash: `0x${'11'.repeat(32)}`,
			entryTransactionHashes: [`0x${'11'.repeat(32)}`],
			executionIntent: {
				direction: 'sell-rep',
				estimatedNetProfitWeth: '0.05',
				estimatedProfitBeforeGasEth: '0.051',
				pool: getAddress('0x0000000000000000000000000000000000000003'),
				poolFee: 10_000,
				reportId: '7',
				requiredToken: '1',
				requiredWeth: '2',
				token: getAddress('0x0000000000000000000000000000000000000001'),
				tokenSymbol: 'REP',
			},
			gasExpenditures: [{ costEth: '0.001', minedAt: '2026-01-01T00:00:00.000Z', transactionHash: `0x${'11'.repeat(32)}` }],
			historyOutbox: undefined,
			hedgeAmountToken: '2',
			hedgeWeth: '1',
			hedgedProfitBeforeGasEth: '0.1',
			lifecycleGasCostEth: '0',
			lifecycleReceiptRecovered: false,
			lifecycleSubmissionBlockNumber: '122',
			lifecycleSubmissionMode: 'private',
			lifecycleTargetBlockNumber: '123',
			lifecycleTokenDecimals: '18',
			lifecycleTransactionIntent: {
				data: '0xabcd',
				to: getAddress('0x0000000000000000000000000000000000000004'),
				value: '0',
			},
			lifecycleTransactionNonce: '9',
			lifecycleTransactionHashes: [`0x${'22'.repeat(32)}`, `0x${'33'.repeat(32)}`],
			lifecycleUpdatedAt: '2026-01-02T00:00:00.000Z',
			lifecycleWalletTokenBefore: '5000000000000000000',
			lifecycleWalletWethBefore: '3000000000000000000',
			lockedToken: '2',
			lockedWeth: '1',
			manualReconciliation: undefined,
			openedAt: '2026-01-01T00:00:00.000Z',
			realizedNetProfitEth: undefined,
			reportId: '7',
			status: 'withdrawing',
			token: getAddress('0x0000000000000000000000000000000000000001'),
			tokenSymbol: 'REP',
			withdrawnToken: '0',
			withdrawnWeth: '0',
		} satisfies PositionRecord
		const pendingFinality = {
			...position,
			executionIntent: position.executionIntent === undefined ? undefined : { ...position.executionIntent, reportId: '8' },
			gasExpenditures: [...position.gasExpenditures, { costEth: '0.000021', minedAt: '2026-01-02T00:00:00.000Z', transactionHash: `0x${'22'.repeat(32)}` as const }],
			lifecycleGasCostEth: '0.000021',
			lifecycleReceiptBlockHash: `0x${'44'.repeat(32)}` as const,
			lifecycleReceiptBlockNumber: '123',
			lifecycleReceiptRecovered: true,
			lifecycleSettlerRewardEth: '0.01',
			lifecycleTransactionHashes: [`0x${'22'.repeat(32)}` as const],
			reportId: '8',
			status: 'closed-pending-finality' as const,
			withdrawnToken: position.lockedToken,
			withdrawnWeth: position.lockedWeth,
		}
		await savePositionJournal(path, [position, pendingFinality], 1)
		expect(await loadPositionJournal(path, 1)).toEqual([position, pendingFinality])
		await Bun.write(path, JSON.stringify({ chainId: 1, positions: [{ ...pendingFinality, lifecycleSettlerRewardEth: undefined }], version: 2 }))
		await expect(loadPositionJournal(path, 1)).rejects.toThrow('pending lifecycle finality recovery journal is incomplete')
		await Bun.write(path, JSON.stringify({ chainId: 1, positions: [{ ...pendingFinality, lifecycleTransactionIntent: undefined }], version: 2 }))
		await expect(loadPositionJournal(path, 1)).rejects.toThrow('pending lifecycle finality recovery journal is incomplete')
	})

	test('round-trips the confirmed-history outbox until its synced append is acknowledged', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		const historyOutbox = {
			actualGasCostEth: '0.001',
			blockNumber: '100',
			direction: 'sell-rep' as const,
			estimatedNetProfitWeth: '0.05',
			estimatedProfitBeforeGasEth: '0.051',
			executedAt: '2026-07-24T00:00:00.000Z',
			pool: getAddress('0x0000000000000000000000000000000000000003'),
			poolFee: 10_000,
			reportId: '7',
			requiredToken: '1',
			requiredWeth: '2',
			token: getAddress('0x0000000000000000000000000000000000000001'),
			tokenSymbol: 'REP',
			trackedNetProfitEth: '0.05',
			transactionHash: `0x${'11'.repeat(32)}` as const,
		}
		const position = {
			account: getAddress('0x0000000000000000000000000000000000000002'),
			actualEntryGasCostEth: '0.001',
			capitalAtRiskWeth: '2',
			closedAt: undefined,
			direction: 'sell-rep',
			entrySubmissionBlockNumber: '99',
			entrySubmissionMode: 'public',
			entryTransactionNonce: '8',
			entryTransactionHash: `0x${'11'.repeat(32)}`,
			entryTransactionHashes: [`0x${'11'.repeat(32)}`],
			executionIntent: {
				direction: historyOutbox.direction,
				estimatedNetProfitWeth: historyOutbox.estimatedNetProfitWeth,
				estimatedProfitBeforeGasEth: historyOutbox.estimatedProfitBeforeGasEth,
				pool: historyOutbox.pool,
				poolFee: historyOutbox.poolFee,
				reportId: historyOutbox.reportId,
				requiredToken: historyOutbox.requiredToken,
				requiredWeth: historyOutbox.requiredWeth,
				token: historyOutbox.token,
				tokenSymbol: historyOutbox.tokenSymbol,
			},
			gasExpenditures: [{ costEth: '0.001', minedAt: '2026-01-01T00:00:00.000Z', transactionHash: `0x${'11'.repeat(32)}` }],
			hedgeAmountToken: '2',
			hedgeWeth: '1',
			hedgedProfitBeforeGasEth: '0.1',
			historyOutbox,
			lifecycleGasCostEth: '0',
			lifecycleReceiptRecovered: false,
			lifecycleTargetBlockNumber: undefined,
			lifecycleTokenDecimals: undefined,
			lifecycleTransactionHashes: [],
			lifecycleUpdatedAt: undefined,
			lifecycleWalletTokenBefore: undefined,
			lifecycleWalletWethBefore: undefined,
			lockedToken: '2',
			lockedWeth: '1',
			manualReconciliation: undefined,
			openedAt: '2026-01-01T00:00:00.000Z',
			realizedNetProfitEth: undefined,
			reportId: '7',
			status: 'open',
			token: getAddress('0x0000000000000000000000000000000000000001'),
			tokenSymbol: 'REP',
			withdrawnToken: '0',
			withdrawnWeth: '0',
		} satisfies PositionRecord
		await savePositionJournal(path, [position], 1)
		expect(await loadPositionJournal(path, 1)).toEqual([position])
	})

	test('rejects an invalid or duplicate report record instead of silently losing recovery state', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		await Bun.write(path, JSON.stringify({ chainId: 1, positions: [{ account: '0x0000000000000000000000000000000000000001', reportId: 'not-an-id' }], version: 2 }))
		await expect(loadPositionJournal(path, 1)).rejects.toThrow('report id')
	})

	test('rejects a gas ledger that understates aggregate position gas', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		const position = {
			account: getAddress('0x0000000000000000000000000000000000000002'),
			actualEntryGasCostEth: '0.001',
			capitalAtRiskWeth: '2',
			closedAt: undefined,
			direction: 'sell-rep',
			entryTransactionHash: `0x${'11'.repeat(32)}`,
			entryTransactionHashes: [`0x${'11'.repeat(32)}`],
			gasExpenditures: [],
			historyOutbox: undefined,
			hedgeAmountToken: '2',
			hedgeWeth: '1',
			hedgedProfitBeforeGasEth: '0.1',
			lifecycleGasCostEth: '0',
			lifecycleReceiptRecovered: false,
			lifecycleTargetBlockNumber: undefined,
			lifecycleTokenDecimals: undefined,
			lifecycleTransactionHashes: [],
			lifecycleUpdatedAt: undefined,
			lifecycleWalletTokenBefore: undefined,
			lifecycleWalletWethBefore: undefined,
			lockedToken: '2',
			lockedWeth: '1',
			manualReconciliation: undefined,
			openedAt: '2026-01-01T00:00:00.000Z',
			realizedNetProfitEth: undefined,
			reportId: '7',
			status: 'open',
			token: getAddress('0x0000000000000000000000000000000000000001'),
			tokenSymbol: 'REP',
			withdrawnToken: '0',
			withdrawnWeth: '0',
		}
		await Bun.write(path, JSON.stringify({ chainId: 1, positions: [position], version: 2 }))
		await expect(loadPositionJournal(path, 1)).rejects.toThrow('gas expenditure total')
	})

	test('rejects noncanonical gas timestamps whose displayed date differs from UTC', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		const position = {
			account: getAddress('0x0000000000000000000000000000000000000002'),
			actualEntryGasCostEth: '0.001',
			capitalAtRiskWeth: '0',
			closedAt: '2026-07-24T23:30:00.000Z',
			direction: 'sell-rep',
			entryTransactionHash: `0x${'11'.repeat(32)}`,
			entryTransactionHashes: [`0x${'11'.repeat(32)}`],
			gasExpenditures: [{ costEth: '0.001', minedAt: '2026-07-25T00:30:00+01:00', transactionHash: `0x${'11'.repeat(32)}` }],
			hedgeAmountToken: '0',
			hedgeWeth: '0',
			hedgedProfitBeforeGasEth: '0',
			historyOutbox: undefined,
			lifecycleGasCostEth: '0',
			lifecycleReceiptRecovered: false,
			lifecycleTargetBlockNumber: undefined,
			lifecycleTokenDecimals: undefined,
			lifecycleTransactionHashes: [],
			lifecycleUpdatedAt: undefined,
			lifecycleWalletTokenBefore: undefined,
			lifecycleWalletWethBefore: undefined,
			lockedToken: '0',
			lockedWeth: '0',
			manualReconciliation: undefined,
			openedAt: '2026-07-24T23:30:00.000Z',
			realizedNetProfitEth: '-0.001',
			reportId: '7',
			status: 'closed',
			token: getAddress('0x0000000000000000000000000000000000000001'),
			tokenSymbol: 'REP',
			withdrawnToken: '0',
			withdrawnWeth: '0',
		}
		await Bun.write(path, JSON.stringify({ chainId: 1, positions: [position], version: 2 }))
		await expect(loadPositionJournal(path, 1)).rejects.toThrow('canonical UTC ISO')
	})

	test('requires the position signer and explicit evidence before manually closing recovery', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		const signer = getAddress('0x0000000000000000000000000000000000000002')
		const position = {
			account: signer,
			actualEntryGasCostEth: '0.001',
			capitalAtRiskWeth: '2',
			closedAt: undefined,
			direction: 'sell-rep',
			entryTransactionHash: `0x${'11'.repeat(32)}`,
			entryTransactionHashes: [`0x${'11'.repeat(32)}`],
			expiredTransactionAttempts: [{ kind: 'entry', nonce: '8', targetBlockNumber: '123', transactionHash: `0x${'33'.repeat(32)}` }],
			gasExpenditures: [
				{ costEth: '0.001', minedAt: '2026-01-01T00:00:00.000Z', transactionHash: `0x${'11'.repeat(32)}` },
				{ costEth: '0.002', minedAt: '2026-01-02T00:00:00.000Z', transactionHash: `0x${'22'.repeat(32)}` },
			],
			historyOutbox: undefined,
			hedgeAmountToken: '2',
			hedgeWeth: '1',
			hedgedProfitBeforeGasEth: '0.1',
			lifecycleGasCostEth: '0.002',
			lifecycleReceiptRecovered: true,
			lifecycleTargetBlockNumber: '123',
			lifecycleTokenDecimals: '18',
			lifecycleTransactionHashes: [`0x${'22'.repeat(32)}`],
			lifecycleUpdatedAt: '2026-01-02T00:00:00.000Z',
			lifecycleWalletTokenBefore: '1',
			lifecycleWalletWethBefore: '1',
			lockedToken: '2',
			lockedWeth: '1',
			manualReconciliation: undefined,
			openedAt: '2026-01-01T00:00:00.000Z',
			realizedNetProfitEth: undefined,
			reportId: '7',
			status: 'recovery-required',
			token: getAddress('0x0000000000000000000000000000000000000001'),
			tokenSymbol: 'REP',
			withdrawnToken: '1.9',
			withdrawnWeth: '1',
		} satisfies PositionRecord
		const parameters = {
			confirmedReportId: '7',
			evidence: 'tx 0x22…; independent RPC snapshots archived as incident-7.json',
			externalCostEth: '0.003',
			finalWalletToken: '5',
			finalWalletWeth: '4',
			note: 'Residual REP was sold manually and final balances reconciled.',
			pnlUnavailable: false,
			realizedNetProfitEth: '0.094',
			recordedAt: '2026-01-03T00:00:00.000Z',
			recordedBy: signer,
		}
		expect(() => manuallyReconcilePosition(position, { ...parameters, recordedBy: getAddress('0x0000000000000000000000000000000000000003') })).toThrow('position signer')
		const closed = manuallyReconcilePosition(position, parameters)
		expect(closed).toMatchObject({
			closedAt: parameters.recordedAt,
			manualReconciliation: {
				evidence: parameters.evidence,
				externalCostEth: '0.003',
				pnlStatus: 'recorded',
				recordedBy: signer,
			},
			realizedNetProfitEth: '0.094',
			status: 'closed',
		})
		await savePositionJournal(path, [closed], 1)
		expect(await loadPositionJournal(path, 1)).toEqual([closed])
	})

	test('allows an auditable close with unavailable P&L when entry evidence never recovered', () => {
		const signer = getAddress('0x0000000000000000000000000000000000000002')
		const position = {
			account: signer,
			actualEntryGasCostEth: '0',
			capitalAtRiskWeth: '2',
			closedAt: undefined,
			direction: 'sell-rep',
			entryTransactionHash: `0x${'11'.repeat(32)}`,
			entryTransactionHashes: [`0x${'11'.repeat(32)}`],
			gasExpenditures: [],
			historyOutbox: undefined,
			hedgeAmountToken: '2',
			hedgeWeth: '1',
			hedgedProfitBeforeGasEth: '0.1',
			lifecycleGasCostEth: '0',
			lifecycleReceiptRecovered: false,
			lifecycleTargetBlockNumber: undefined,
			lifecycleTokenDecimals: undefined,
			lifecycleTransactionHashes: [],
			lifecycleUpdatedAt: undefined,
			lifecycleWalletTokenBefore: undefined,
			lifecycleWalletWethBefore: undefined,
			lockedToken: '2',
			lockedWeth: '1',
			manualReconciliation: undefined,
			openedAt: '2026-01-01T00:00:00.000Z',
			realizedNetProfitEth: undefined,
			reportId: '8',
			status: 'recovery-required',
			token: getAddress('0x0000000000000000000000000000000000000001'),
			tokenSymbol: 'REP',
			withdrawnToken: '0',
			withdrawnWeth: '0',
		} satisfies PositionRecord
		expect(
			manuallyReconcilePosition(position, {
				confirmedReportId: '8',
				evidence: 'Transactions absent on both archived RPC providers after finality.',
				externalCostEth: '0',
				finalWalletToken: '5',
				finalWalletWeth: '4',
				note: 'No inclusion was observed; P&L cannot be proven from receipts.',
				pnlUnavailable: true,
				realizedNetProfitEth: undefined,
				recordedBy: signer,
			}),
		).toMatchObject({ realizedNetProfitEth: undefined, status: 'closed' })
	})

	test('rejects a hand-edited reconciliation whose P&L status contradicts the record', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		const signer = getAddress('0x0000000000000000000000000000000000000002')
		const position = manuallyReconcilePosition(
			{
				account: signer,
				actualEntryGasCostEth: '0',
				capitalAtRiskWeth: '2',
				closedAt: undefined,
				direction: 'sell-rep',
				entryTransactionHash: `0x${'11'.repeat(32)}`,
				entryTransactionHashes: [`0x${'11'.repeat(32)}`],
				gasExpenditures: [],
				historyOutbox: undefined,
				hedgeAmountToken: '2',
				hedgeWeth: '1',
				hedgedProfitBeforeGasEth: '0.1',
				lifecycleGasCostEth: '0',
				lifecycleReceiptRecovered: false,
				lifecycleTargetBlockNumber: undefined,
				lifecycleTokenDecimals: undefined,
				lifecycleTransactionHashes: [],
				lifecycleUpdatedAt: undefined,
				lifecycleWalletTokenBefore: undefined,
				lifecycleWalletWethBefore: undefined,
				lockedToken: '2',
				lockedWeth: '1',
				manualReconciliation: undefined,
				openedAt: '2026-01-01T00:00:00.000Z',
				realizedNetProfitEth: undefined,
				reportId: '9',
				status: 'recovery-required',
				token: getAddress('0x0000000000000000000000000000000000000001'),
				tokenSymbol: 'REP',
				withdrawnToken: '0',
				withdrawnWeth: '0',
			},
			{
				confirmedReportId: '9',
				evidence: 'Archived receipts',
				externalCostEth: '0',
				finalWalletToken: '5',
				finalWalletWeth: '4',
				note: 'P&L unavailable',
				pnlUnavailable: true,
				realizedNetProfitEth: undefined,
				recordedBy: signer,
			},
		)
		await Bun.write(path, JSON.stringify({ chainId: 1, positions: [{ ...position, realizedNetProfitEth: '1' }], version: 2 }))
		await expect(loadPositionJournal(path, 1)).rejects.toThrow('P&L is inconsistent')
	})
})

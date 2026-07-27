import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAddress } from '@zoltar/shared/ethereum'
import { loadPositionJournal, manuallyReconcilePosition, savePositionJournal, type PositionRecord } from './position-store.js'

const directories: string[] = []

afterEach(async () => {
	await Promise.all(directories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

describe('durable OpenOracle position journal', () => {
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
			entryTransactionHash: `0x${'11'.repeat(32)}`,
			entryTransactionHashes: [`0x${'11'.repeat(32)}`],
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
		} satisfies PositionRecord
		await savePositionJournal(path, [position])
		expect(await loadPositionJournal(path)).toEqual([position])
		expect((await readFile(path, 'utf8')).toString()).not.toContain('privateKey')
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
			entryTransactionHash: `0x${'11'.repeat(32)}`,
			entryTransactionHashes: [`0x${'11'.repeat(32)}`],
			hedgeAmountToken: '2',
			hedgeWeth: '1',
			hedgedProfitBeforeGasEth: '0.1',
			lifecycleGasCostEth: '0',
			lifecycleReceiptRecovered: false,
			lifecycleTargetBlockNumber: '123',
			lifecycleTokenDecimals: '18',
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
		await savePositionJournal(path, [position])
		expect(await loadPositionJournal(path)).toEqual([position])
	})

	test('rejects an invalid or duplicate report record instead of silently losing recovery state', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-position-'))
		directories.push(directory)
		const path = join(directory, 'positions.json')
		await Bun.write(path, JSON.stringify({ positions: [{ account: '0x0000000000000000000000000000000000000001', reportId: 'not-an-id' }], version: 1 }))
		await expect(loadPositionJournal(path)).rejects.toThrow('report id')
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
		await savePositionJournal(path, [closed])
		expect(await loadPositionJournal(path)).toEqual([closed])
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
		await Bun.write(path, JSON.stringify({ positions: [{ ...position, realizedNetProfitEth: '1' }], version: 1 }))
		await expect(loadPositionJournal(path)).rejects.toThrow('P&L is inconsistent')
	})
})

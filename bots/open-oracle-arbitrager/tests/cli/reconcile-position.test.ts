import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getAddress, privateKeyToAccount, type Hex } from '#ethereum'
import { loadPositionJournalState, savePositionJournalState, type PositionRecord } from '#state/position-store'

const requiredArguments = ['--position-file=/tmp/unused-position-journal.json', '--chain-id=1', '--report-id=7', '--confirm-report-id=7', '--evidence=archived receipts', '--note=manual unwind complete', '--external-cost-eth=0.003', '--final-wallet-weth=4', '--final-wallet-token=5'] as const
const privateKey = `0x${'00'.repeat(31)}01` as Hex
const signer = privateKeyToAccount(privateKey).address
const directories: string[] = []

function terminalPosition(index: number, overrides: Partial<PositionRecord> = {}): PositionRecord {
	return {
		account: signer,
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

async function run(arguments_: readonly string[], privateKeyValue?: Hex) {
	const child = Bun.spawn([process.execPath, join(import.meta.dir, '..', '..', 'src', 'cli', 'reconcile-position.ts'), ...arguments_], {
		env: { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'PRIVATE_KEY')), ...(privateKeyValue === undefined ? {} : { PRIVATE_KEY: privateKeyValue }) },
		stderr: 'pipe',
		stdout: 'pipe',
	})
	return { exitCode: await child.exited, stderr: await new Response(child.stderr).text() }
}

afterEach(async () => {
	await Promise.all(directories.splice(0).map(path => rm(path, { force: true, recursive: true })))
})

test('manual realized P&L requires an explicit all-in accounting acknowledgement', async () => {
	const missing = await run([...requiredArguments, '--realized-net-profit-eth=-0.04'])
	expect(missing.exitCode).not.toBe(0)
	expect(missing.stderr).toContain('--acknowledge-pnl-is-all-in=true')
	const acknowledged = await run([...requiredArguments, '--realized-net-profit-eth=-0.04', '--acknowledge-pnl-is-all-in=true'])
	expect(acknowledged.exitCode).not.toBe(0)
	expect(acknowledged.stderr).toContain('PRIVATE_KEY must be')
})

test('retains a newly reconciled recovery record when the terminal journal is full', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'zoltar-reconcile-'))
	directories.push(directory)
	const positionFile = join(directory, 'positions.json')
	const recovery = terminalPosition(500, {
		capitalAtRiskWeth: '2',
		closedAt: undefined,
		lockedToken: '2',
		lockedWeth: '1',
		realizedNetProfitEth: undefined,
		status: 'recovery-required',
		withdrawnToken: '0',
		withdrawnWeth: '0',
	})
	await savePositionJournalState(
		positionFile,
		{
			archived: { gasSpentByUtcDay: {}, hedgedProfitBeforeGasEth: '0', positionCount: 0, realizedNetProfitEth: '0' },
			positions: [...Array.from({ length: 500 }, (_value, index) => terminalPosition(index)), recovery],
		},
		1,
	)

	const result = await run([`--position-file=${positionFile}`, '--chain-id=1', '--report-id=501', '--confirm-report-id=501', '--evidence=archived receipts', '--note=manual unwind complete', '--external-cost-eth=0.003', '--final-wallet-weth=4', '--final-wallet-token=5', '--pnl-unavailable=true'], privateKey)
	expect(result).toMatchObject({ exitCode: 0, stderr: '' })
	const journal = await loadPositionJournalState(positionFile, 1)
	expect(journal.positions.find(position => position.reportId === '501')?.manualReconciliation).toMatchObject({ evidence: 'archived receipts', note: 'manual unwind complete' })
})

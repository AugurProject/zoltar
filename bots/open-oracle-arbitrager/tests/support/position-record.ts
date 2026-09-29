import { getAddress } from '@zoltar/bot-shared/ethereum'
import type { ExecutionIntent, PositionRecord } from '#state/position-store'

export const positionToken = getAddress('0x0000000000000000000000000000000000000001')
export const positionAccount = getAddress('0x0000000000000000000000000000000000000002')
export const positionPool = getAddress('0x0000000000000000000000000000000000000003')
export const entryTransactionHash = `0x${'11'.repeat(32)}` as const

/** The persisted entry intent for report 7 on the fixture pool. */
export function executionIntentFixture(overrides: Partial<ExecutionIntent> = {}): ExecutionIntent {
	return {
		direction: 'sell-rep',
		estimatedNetProfitWeth: '0.05',
		estimatedProfitBeforeGasEth: '0.051',
		pool: positionPool,
		poolFee: 10_000,
		reportId: '7',
		requiredToken: '1',
		requiredWeth: '2',
		token: positionToken,
		tokenSymbol: 'REP',
		...overrides,
	}
}

/** An open report-7 position whose only gas is its mined entry; tests override only the fields they exercise. */
export function openPositionFixture(overrides: Partial<PositionRecord> = {}): PositionRecord {
	return {
		account: positionAccount,
		actualEntryGasCostEth: '0.001',
		capitalAtRiskWeth: '2',
		closedAt: undefined,
		direction: 'sell-rep',
		entryTransactionHash,
		entryTransactionHashes: [entryTransactionHash],
		gasExpenditures: [{ costEth: '0.001', minedAt: '2026-01-01T00:00:00.000Z', transactionHash: entryTransactionHash }],
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
		token: positionToken,
		tokenSymbol: 'REP',
		withdrawnToken: '0',
		withdrawnWeth: '0',
		...overrides,
	}
}

/** A closed position for report `index + 1` that withdrew its hedge and realized 0.1 ETH. */
export function terminalPositionFixture(index: number, overrides: Partial<PositionRecord> = {}): PositionRecord {
	return openPositionFixture({
		capitalAtRiskWeth: '0',
		closedAt: '2026-01-01T01:00:00.000Z',
		hedgeAmountToken: '1',
		lockedToken: '0',
		lockedWeth: '0',
		realizedNetProfitEth: '0.1',
		reportId: (index + 1).toString(),
		status: 'closed',
		withdrawnToken: '1',
		withdrawnWeth: '1',
		...overrides,
	})
}

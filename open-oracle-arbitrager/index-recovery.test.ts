import { describe, expect, test } from 'bun:test'
import { getAddress, type Hex } from '@zoltar/shared/ethereum'
import { executionRecordForConfirmedPosition, reconcilePublicLifecycleSnapshot } from './index.js'
import type { PositionRecord } from './position-store.js'

const transactionHash = `0x${'11'.repeat(32)}` as Hex
const token = getAddress('0x0000000000000000000000000000000000000001')

function confirmedPosition(): PositionRecord {
	return {
		account: getAddress('0x0000000000000000000000000000000000000002'),
		actualEntryGasCostEth: '0.001',
		capitalAtRiskWeth: '2',
		closedAt: undefined,
		direction: 'sell-rep',
		entrySubmissionBlockNumber: '99',
		entrySubmissionMode: 'public',
		entryTransactionHash: transactionHash,
		entryTransactionHashes: [transactionHash],
		entryTransactionNonce: '8',
		executionIntent: {
			direction: 'sell-rep',
			estimatedNetProfitWeth: '0.05',
			estimatedProfitBeforeGasEth: '0.051',
			pool: getAddress('0x0000000000000000000000000000000000000003'),
			poolFee: 10_000,
			reportId: '7',
			requiredToken: '1',
			requiredWeth: '2',
			token,
			tokenSymbol: 'REP',
		},
		gasExpenditures: [{ costEth: '0.001', minedAt: '2026-07-24T00:00:00.000Z', transactionHash }],
		hedgeAmountToken: '2',
		hedgeWeth: '1',
		hedgedProfitBeforeGasEth: '0.1',
		historyOutbox: undefined,
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
		openedAt: '2026-07-24T00:00:00.000Z',
		realizedNetProfitEth: undefined,
		reportId: '7',
		status: 'open',
		token,
		tokenSymbol: 'REP',
		withdrawnToken: '0',
		withdrawnWeth: '0',
	}
}

describe('entry crash recovery', () => {
	test('reconstructs the complete idempotent history outbox from the pre-journaled execution intent', () => {
		const record = executionRecordForConfirmedPosition(confirmedPosition(), 100n, transactionHash)
		expect(record).toEqual({
			actualGasCostEth: '0.001',
			blockNumber: '100',
			direction: 'sell-rep',
			estimatedNetProfitWeth: '0.05',
			estimatedProfitBeforeGasEth: '0.051',
			executedAt: '2026-07-24T00:00:00.000Z',
			pool: getAddress('0x0000000000000000000000000000000000000003'),
			poolFee: 10_000,
			reportId: '7',
			requiredToken: '1',
			requiredWeth: '2',
			token,
			tokenSymbol: 'REP',
			trackedNetProfitEth: '0.099',
			transactionHash,
		})
	})
})

describe('public lifecycle crash recovery', () => {
	test('retains the original balance baseline across partial steps and closes only after exact withdrawal', () => {
		const blockHash = `0x${'22'.repeat(32)}` as Hex
		const position = {
			...confirmedPosition(),
			lifecycleTargetBlockNumber: '0',
			lifecycleTokenDecimals: '18',
			lifecycleWalletTokenBefore: '20',
			lifecycleWalletWethBefore: '10',
			lockedToken: '0.000000000000000001',
			lockedWeth: '0.000000000000000001',
		}
		const partial = reconcilePublicLifecycleSnapshot(position, { blockHash, blockTimestamp: 1_753_315_200n, tokenDecimals: 18n, walletToken: 20n, walletWeth: 11n }, blockHash)
		expect(partial.status).toBe('open')
		expect(partial.withdrawnWeth).toBe('0.000000000000000001')
		expect(partial.withdrawnToken).toBe('0')
		expect(partial.lifecycleWalletWethBefore).toBe('10')

		const closed = reconcilePublicLifecycleSnapshot(partial, { blockHash, blockTimestamp: 1_753_315_212n, tokenDecimals: 18n, walletToken: 21n, walletWeth: 11n }, blockHash)
		expect(closed.status).toBe('closed')
		expect(closed.withdrawnToken).toBe('0.000000000000000001')
	})

	test('rejects a same-height post-state snapshot from another canonical block', () => {
		const position = {
			...confirmedPosition(),
			lifecycleTargetBlockNumber: '0',
			lifecycleTokenDecimals: '18',
			lifecycleWalletTokenBefore: '20',
			lifecycleWalletWethBefore: '10',
		}
		expect(() => reconcilePublicLifecycleSnapshot(position, { blockHash: `0x${'33'.repeat(32)}`, blockTimestamp: 1_753_315_200n, tokenDecimals: 18n, walletToken: 20n, walletWeth: 10n }, `0x${'22'.repeat(32)}`)).toThrow('different canonical block')
	})
})

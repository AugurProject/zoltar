import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Address, Hex } from '@zoltar/shared/ethereum'
import { appendExecutionHistory, clearWalletDerivedState, decimalSignedEth, ensureExecutionHistoryWritable, gameCapitalSnapshot, loadExecutionHistory, operatorSnapshot, parseSignedDecimalEth, updateStrategyFromRequest, type ExecutionRecord, type MutableStrategy, type OperatorState } from './operator-state.js'

const temporaryDirectories: string[] = []
const address = '0x0000000000000000000000000000000000000001' as Address
const submission = { mode: 'public', relayUrls: ['https://relay.flashbots.net/'] } as const
const connectivity = { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://rpc.example/' } as const
const fixed = { execute: false, executor: undefined, expectedChainId: 1, explorerUrl: 'https://etherscan.io', network: 'mainnet', openOracle: address, queuedWallet: undefined, savedWallet: undefined, wallet: undefined } as const

function strategy(): MutableStrategy {
	return {
		maxSpotTwapTicks: 100n,
		minimumProfitBps: 100n,
		minimumProfitWeth: 10n ** 16n,
		minimumRemainingBlocks: 3n,
		minimumRemainingSeconds: 36n,
		pollMilliseconds: 12_000,
		twapSeconds: 1_800,
	}
}

function settings() {
	return {
		maxSpotTwapTicks: '75',
		minimumProfitBps: '200',
		minimumProfitWeth: '0.025',
		minimumRemainingBlocks: '4',
		minimumRemainingSeconds: '48',
		pollMilliseconds: 15_000,
		twapSeconds: 2_400,
	}
}

afterEach(async () => {
	for (const directory of temporaryDirectories.splice(0)) await rm(directory, { force: true, recursive: true })
})

describe('operator strategy settings', () => {
	test('validates and applies every runtime-adjustable setting', () => {
		const current = strategy()
		expect(updateStrategyFromRequest(current, settings())).toEqual(settings())
		expect(current.minimumProfitWeth).toBe(25n * 10n ** 15n)
		expect(current.maxSpotTwapTicks).toBe(75n)
	})

	test('rejects invalid updates atomically', () => {
		const current = strategy()
		const before = { ...current }
		expect(() => updateStrategyFromRequest(current, { ...settings(), twapSeconds: 30 })).toThrow('TWAP window')
		expect(current).toEqual(before)
		expect(() => updateStrategyFromRequest(current, { ...settings(), execute: true })).toThrow('Unknown strategy setting')
	})

	test('preserves negative ETH profitability', () => {
		expect(parseSignedDecimalEth('-0.0015')).toBe(-15n * 10n ** 14n)
		expect(decimalSignedEth(-15n * 10n ** 14n)).toBe('-0.0015')
	})

	test('totals native ETH, WETH, and settler rewards locked in active games', () => {
		const weth = '0x0000000000000000000000000000000000000002' as Address
		const nativeEth = '0x0000000000000000000000000000000000000000' as Address
		expect(
			gameCapitalSnapshot(
				[
					{ currentAmount1: 2n * 10n ** 18n, currentAmount2: 3n, settlerReward: 10n ** 17n, token1: weth, token2: address },
					{ currentAmount1: 4n * 10n ** 18n, currentAmount2: 5n, settlerReward: 2n * 10n ** 17n, token1: nativeEth, token2: address },
				],
				weth,
			),
		).toEqual({ eth: '4.3', totalEthWeth: '6.3', weth: '2' })
	})

	test('clears wallet-derived balances and decisions when the signer identity changes', () => {
		const state: OperatorState = {
			activeReportCount: 1,
			balances: { availableEth: '1', availableRep: '2', availableWeth: '3', repValueWeth: '4', totalValueWeth: '8' },
			blockNumber: '100',
			blockTimestamp: '1000',
			endpointChecks: [],
			executionHistory: [],
			gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
			lastError: undefined,
			lastPollAt: undefined,
			operationLog: [],
			opportunities: [
				{
					decision: 'eligible',
					direction: 'buy-rep',
					estimatedNetProfitEth: '1',
					estimatedNetProfitWeth: '1',
					hasRequiredInventory: true,
					pool: address,
					poolFee: 3_000,
					reportId: '1',
					requiredToken: '1',
					requiredWeth: '1',
					token: address,
					tokenSymbol: 'REP',
					timeRemaining: '10',
					windowUnit: 'blocks',
				},
			],
			paused: false,
			status: 'running',
			tokenAddresses: [],
			tokenMarkets: [],
			priceHistory: [],
			reportPaths: [],
			transactionActivity: [],
		}
		clearWalletDerivedState(state)
		expect(state.balances).toBeUndefined()
		expect(state.opportunities).toEqual([])
	})
})

describe('operator execution history', () => {
	test('persists valid records, ignores malformed lines, and calculates totals', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-test-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'history.jsonl')
		const record: ExecutionRecord = {
			actualGasCostEth: '0.002',
			blockNumber: '100',
			direction: 'sell-rep',
			estimatedNetProfitWeth: '0.05',
			estimatedProfitBeforeGasEth: '0.052',
			executedAt: '2026-07-24T00:00:00.000Z',
			pool: address,
			poolFee: 10_000,
			reportId: '7',
			requiredToken: '1',
			requiredWeth: '2',
			token: address,
			tokenSymbol: 'REP',
			trackedNetProfitEth: '0.05',
			transactionHash: `0x${'12'.repeat(32)}` as Hex,
		}
		await writeFile(path, 'not-json\n', 'utf8')
		await appendExecutionHistory(path, record)
		await appendExecutionHistory(path, record)
		const history = await loadExecutionHistory(path)
		expect(history).toEqual([record])
		const state: OperatorState = {
			activeReportCount: 0,
			balances: undefined,
			blockNumber: undefined,
			blockTimestamp: undefined,
			executionHistory: history,
			endpointChecks: [],
			gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
			lastError: undefined,
			lastPollAt: undefined,
			opportunities: [],
			operationLog: [],
			paused: false,
			status: 'running',
			tokenAddresses: [],
			tokenMarkets: [],
			priceHistory: [],
			reportPaths: [],
			transactionActivity: [],
		}
		const snapshot = operatorSnapshot(state, strategy(), submission, connectivity, fixed)
		expect(snapshot.totalEstimatedNetProfitWeth).toBe('0.05')
		expect(snapshot.totalActualGasCostEth).toBe('0.002')
		expect(snapshot.totalRevenueBeforeGasEth).toBe('0.052')
	})

	test('preflights and locks down the execution history destination', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-test-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'nested', 'history.jsonl')
		await ensureExecutionHistoryWritable(path)
		const file = Bun.file(path)
		expect(await file.exists()).toBe(true)
		expect((await file.stat()).mode & 0o777).toBe(0o600)
	})

	test('keeps full-history totals while bounding the dashboard record window', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-test-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'history.jsonl')
		const records = Array.from({ length: 501 }, (_, index) => ({
			actualGasCostEth: '0.001',
			blockNumber: index.toString(),
			direction: 'buy-rep' as const,
			estimatedNetProfitWeth: '0.002',
			estimatedProfitBeforeGasEth: '0.003',
			executedAt: new Date(index * 1_000).toISOString(),
			pool: address,
			poolFee: 3_000,
			reportId: index.toString(),
			requiredToken: '1',
			requiredWeth: '2',
			token: address,
			tokenSymbol: 'REP',
			trackedNetProfitEth: '0.002',
			transactionHash: `0x${index.toString(16).padStart(64, '0')}` as Hex,
		}))
		await writeFile(path, `${records.map(record => JSON.stringify(record)).join('\n')}\n`, 'utf8')
		const history = await loadExecutionHistory(path)
		expect(history).toHaveLength(501)
		const state: OperatorState = {
			activeReportCount: 0,
			balances: undefined,
			blockNumber: undefined,
			blockTimestamp: undefined,
			executionHistory: history,
			endpointChecks: [],
			gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
			lastError: undefined,
			lastPollAt: undefined,
			opportunities: [],
			operationLog: [],
			paused: false,
			status: 'running',
			tokenAddresses: [],
			tokenMarkets: [],
			priceHistory: [],
			reportPaths: [],
			transactionActivity: [],
		}
		const snapshot = operatorSnapshot(state, strategy(), submission, connectivity, { ...fixed, execute: true, wallet: address })
		expect(snapshot.executionHistory).toHaveLength(500)
		expect(snapshot.executionHistoryRecordCount).toBe(501)
		expect(snapshot.totalEstimatedNetProfitWeth).toBe('1.002')
		expect(snapshot.totalActualGasCostEth).toBe('0.501')
		expect(snapshot.totalTrackedNetProfitEth).toBe('1.002')
	})
})

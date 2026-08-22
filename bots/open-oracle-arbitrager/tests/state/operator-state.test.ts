import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Address, Hex } from '#ethereum'
import {
	appendExecutionHistory,
	appendExecutionHistoryIfMissing,
	clearPollFailureMetadata,
	clearWalletDerivedState,
	decimalSignedEth,
	ensureExecutionHistoryWritable,
	gameCapitalSnapshot,
	loadExecutionHistory,
	operatorSnapshot,
	parseSignedDecimalEth,
	publicPollFailure,
	updateStrategyFromRequest,
	type ExecutionHistoryFilesystem,
	type ExecutionRecord,
	type MutableStrategy,
	type OperatorState,
} from '#state/operator-state'
import type { PositionRecord } from '#state/position-store'

const temporaryDirectories: string[] = []
const address = '0x0000000000000000000000000000000000000001' as Address
const submission = { minimumBundleRelaySuccesses: 1, mode: 'public', relayUrls: ['https://relay.flashbots.net/'] } as const
const connectivity = { publicRpcUrls: ['https://rpc.example/'], readRpcUrl: 'https://rpc.example/' } as const
const fixed = { execute: false, executor: undefined, expectedChainId: 1, explorerUrl: 'https://etherscan.io', network: 'mainnet', openOracle: address, queuedWallet: undefined, savedWallet: undefined, wallet: undefined } as const

function capabilityState(): OperatorState {
	return {
		activeReportCount: 0,
		balances: undefined,
		blockNumber: undefined,
		blockTimestamp: undefined,
		endpointChecks: [],
		executionHistory: [],
		gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
		lastError: undefined,
		lastPollAt: undefined,
		operationLog: [],
		opportunities: [],
		paused: false,
		positions: [],
		priceHistory: [],
		reportPaths: [],
		status: 'syncing',
		tokenAddresses: [],
		tokenMarkets: [],
		transactionActivity: [],
	}
}

test('reports operator capability only after a complete current scan and signer readiness', () => {
	const state = capabilityState()
	expect(operatorSnapshot(state, strategy(), submission, connectivity, fixed).operatorCapable).toBe(false)
	state.status = 'running'
	state.blockNumber = '100'
	state.lastPollAt = '2026-08-20T00:00:00.000Z'
	expect(operatorSnapshot(state, strategy(), submission, connectivity, fixed).operatorCapable).toBe(true)
	expect(operatorSnapshot(state, strategy(), submission, connectivity, { ...fixed, execute: true }).operatorCapable).toBe(false)
	expect(operatorSnapshot(state, strategy(), submission, connectivity, { ...fixed, execute: true, wallet: address }).operatorCapable).toBe(true)
})

test('publishes the complete execution REP catalog to the dashboard snapshot', () => {
	const state = capabilityState()
	const forkRep = '0x0000000000000000000000000000000000000002' as Address
	state.tokenAddresses = [address, forkRep]
	expect(operatorSnapshot(state, strategy(), submission, connectivity, fixed).tokenAddresses).toEqual([address, forkRep])
})

describe('public poll failures', () => {
	test('clears stale retry timing after recovery before retaining a non-poll warning', () => {
		const state: { consecutivePollFailures: number; lastPollFailureAt: string | undefined; lastRetryAt: string | undefined; nextRetryAt: string | undefined; retryInProgress: boolean } = {
			consecutivePollFailures: 3,
			lastPollFailureAt: '2026-08-17T12:00:00.000Z',
			lastRetryAt: '2026-08-17T12:00:05.000Z',
			nextRetryAt: '2026-08-17T12:00:10.000Z',
			retryInProgress: true,
		}
		clearPollFailureMetadata(state)
		const recoveredState = { ...state, lastError: 'Report execution needs operator attention' }
		expect(recoveredState).toEqual({ consecutivePollFailures: 0, lastError: 'Report execution needs operator attention', lastPollFailureAt: undefined, lastRetryAt: undefined, nextRetryAt: undefined, retryInProgress: false })
	})

	test.each([',', ';', ')'])('redacts the complete RPC URL token when its path contains %s', delimiter => {
		const message = publicPollFailure(`RPC https://operator:protected@rpc.example/v3/key${delimiter}protected-tail request timed out`)
		expect(message).toContain('RPC https://rpc.example request timed out')
		expect(message).not.toContain('protected')
	})

	test('retains the safe cause while redacting credentials and filesystem paths', () => {
		const credentialFailure = publicPollFailure('RPC request timed out with token=protected-value')
		expect(credentialFailure).toContain('RPC request timed out with token=[redacted]')
		expect(credentialFailure).not.toContain('protected-value')
		const pathFailure = publicPollFailure('State persistence failed while reading /var/lib/zoltar/private.json')
		expect(pathFailure).toContain('State persistence failed while reading [protected path]')
		expect(pathFailure).not.toContain('/var/lib/zoltar/private.json')
		const websocketFailure = publicPollFailure('RPC wss://operator:protected-password@rpc.example/private failed')
		expect(websocketFailure).toContain('RPC [redacted URL] failed')
		expect(websocketFailure).not.toContain('protected-password')
		for (const url of ['https:operator:protected-password@rpc.example', 'ws:operator:protected-password@rpc.example']) {
			const urlFailure = publicPollFailure(`RPC ${url} failed`)
			expect(urlFailure).not.toContain('protected-password')
		}
		const delimiterPathFailure = publicPollFailure('State persistence failed at (detail)state/operator-relative-secret.json')
		expect(delimiterPathFailure).toContain('failed at [protected path]')
		expect(delimiterPathFailure).not.toContain('operator-relative-secret')
	})

	test('bounds long provider detail at a readable word boundary', () => {
		const message = publicPollFailure(`RPC https://rpc.example returned HTTP 400 while calling eth_getLogs: ${'provider response detail '.repeat(30)}`)
		expect(message).toContain('RPC https://rpc.example returned HTTP 400 while calling eth_getLogs')
		expect(message).toContain('detail… Automatic retry remains active.')
		expect(message).not.toContain('provid…')
		expect(message.length).toBeLessThan(450)
	})

	test('redacts standard authorization, JSON secret, and quoted filesystem formats', () => {
		const authorizationFailure = publicPollFailure('RPC request failed with Authorization: Basic protected-credential')
		expect(authorizationFailure).toContain('RPC request failed with Authorization: [redacted]')
		expect(authorizationFailure).not.toContain('protected-credential')
		const jsonFailure = publicPollFailure('RPC provider returned {"token":"protected value"} while reading the block')
		expect(jsonFailure).toContain('{"token":"[redacted]"}')
		expect(jsonFailure).not.toContain('protected value')
		for (const path of ['/var/lib/zoltar/private.json', 'C:\\zoltar\\private.json']) {
			const pathFailure = publicPollFailure(`State persistence failed: open '${path}'`)
			expect(pathFailure).toContain("State persistence failed: open '[protected path]'")
			expect(pathFailure).not.toContain(path)
		}
	})

	test('redacts credential fields, assigned paths, and complete quoted paths containing spaces', () => {
		const credentialsFailure = publicPollFailure('RPC request failed with credentials=protected-value')
		expect(credentialsFailure).toContain('credentials=[redacted]')
		expect(credentialsFailure).not.toContain('protected-value')
		const assignedPathFailure = publicPollFailure('State persistence failed with path=/var/lib/zoltar/private.json')
		expect(assignedPathFailure).toContain('path=[protected path]')
		expect(assignedPathFailure).not.toContain('/var/lib/zoltar/private.json')
		for (const path of ['/var/lib/zoltar/private state.json', '\\\\private-server\\zoltar\\private state.json']) {
			const pathFailure = publicPollFailure(`State persistence failed: open '${path}'`)
			expect(pathFailure).toContain("open '[protected path]'")
			expect(pathFailure).not.toContain('private state.json')
		}
		for (const path of ['.state/operator secrets.json', 'state/private.json']) {
			const pathFailure = publicPollFailure(`State persistence failed: open '${path}'`)
			expect(pathFailure).toContain("open '[protected path]'")
			expect(pathFailure).not.toContain(path)
		}
		const relativeAssignedPathFailure = publicPollFailure('State persistence failed with path=state/private.json')
		expect(relativeAssignedPathFailure).toContain('path=[protected path]')
		expect(relativeAssignedPathFailure).not.toContain('state/private.json')
		const unquotedRelativePathFailure = publicPollFailure('State persistence failed while reading state/operator-relative-secret.json')
		expect(unquotedRelativePathFailure).toContain('while reading [protected path]')
		expect(unquotedRelativePathFailure).not.toContain('operator-relative-secret')
		for (const path of ['state/operator-relative-secret', 'state/operator-relative-secret.sqlite', 'cache/operator-relative-secret.db:12']) {
			const pathFailure = publicPollFailure(`State persistence failed while reading ${path}`)
			expect(pathFailure).toContain('while reading [protected path]')
			expect(pathFailure).not.toContain('operator-relative-secret')
		}
	})

	test('redacts spaced and abbreviated credential labels', () => {
		const apiKeyFailure = publicPollFailure('RPC request failed with api key=protected-value')
		expect(apiKeyFailure).toContain('api key=[redacted]')
		expect(apiKeyFailure).not.toContain('protected-value')
		const authFailure = publicPollFailure('RPC provider returned {"auth":"Basic protected value"}')
		expect(authFailure).toContain('{"auth":"[redacted]"}')
		expect(authFailure).not.toContain('protected value')
	})

	test('redacts quoted credentials containing apostrophes and escaped quotes', () => {
		const apostropheFailure = publicPollFailure('RPC provider returned {"password":"protected\'tail value"}')
		expect(apostropheFailure).toContain('{"password":"[redacted]"}')
		expect(apostropheFailure).not.toContain("protected'tail value")
		const escapedQuoteFailure = publicPollFailure('RPC provider returned {"secret":"protected\\"tail value"}')
		expect(escapedQuoteFailure).toContain('{"secret":"[redacted]"}')
		expect(escapedQuoteFailure).not.toContain('protected')
	})

	test('translates internal chain terminology and retains automatic retry guidance for every poll category', () => {
		const reorganization = publicPollFailure('Canonical chain reorganized deeper than the configured overlap at block 100')
		expect(reorganization).toContain('tried to read blockchain data through an RPC endpoint')
		expect(reorganization).toContain('Blockchain history reorganized deeper than the configured overlap at block 100')
		expect(reorganization.toLowerCase()).not.toContain('canonical chain')
		for (const error of ['Confirmed dispute history is not durable', 'Risk policy limit rejected the opportunity']) expect(publicPollFailure(error)).toContain('Automatic retry remains active.')
	})

	test('uses whole domain words and deliberate precedence to describe the attempted action', () => {
		expect(publicPollFailure('Risk policy blocked the transaction')).toContain('tried to apply the active risk and execution limits')
		expect(publicPollFailure('Transaction receipt failed at block 100')).toContain('tried to submit or confirm a transaction')
		expect(publicPollFailure('Read RPC https://market.example/private failed')).toContain('tried to read blockchain data through an RPC endpoint')
		expect(publicPollFailure('RPC request failed with token=transaction')).toContain('tried to read blockchain data through an RPC endpoint')
	})

	test('retains the safe RPC origin and method in a polling failure', () => {
		const message = publicPollFailure('RPC https://rpc.example returned HTTP 400 while calling eth_getLogs')
		expect(message).toContain('RPC https://rpc.example returned HTTP 400 while calling eth_getLogs')
		expect(message.match(/eth_getLogs/g)).toHaveLength(1)
	})
})

function strategy(): MutableStrategy {
	return {
		maxSpotTwapTicks: 100n,
		minimumProfitBps: 100n,
		minimumProfitAttoWeth: 10n ** 16n,
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
		expect(current.minimumProfitAttoWeth).toBe(25n * 10n ** 15n)
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
					{ currentAmount1: 2n * 10n ** 18n, currentAmount2: 3n, settlerRewardAttoEth: 10n ** 17n, token1: weth, token2: address },
					{ currentAmount1: 4n * 10n ** 18n, currentAmount2: 5n, settlerRewardAttoEth: 2n * 10n ** 17n, token1: nativeEth, token2: address },
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
					centralizedPriceDeviationBps: '25',
					decision: 'eligible',
					direction: 'buy-rep',
					estimatedNetProfitEth: '1',
					estimatedNetProfitWeth: '1',
					executablePriceRepPerEth: '10',
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
			positions: [],
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
	test('subtracts nonzero lifecycle gas from open hedged P&L and separates realized P&L', () => {
		const base = {
			account: address,
			actualEntryGasCostEth: '0.01',
			capitalAtRiskWeth: '1',
			closedAt: undefined,
			direction: 'sell-rep',
			entryTransactionHash: `0x${'ab'.repeat(32)}` as Hex,
			entryTransactionHashes: [`0x${'ab'.repeat(32)}` as Hex],
			gasExpenditures: [
				{ costEth: '0.01', minedAt: new Date(0).toISOString(), transactionHash: `0x${'ab'.repeat(32)}` as Hex },
				{ costEth: '0.005', minedAt: new Date(1).toISOString(), transactionHash: `0x${'cd'.repeat(32)}` as Hex },
			],
			historyOutbox: undefined,
			hedgeAmountToken: '1',
			hedgeWeth: '1',
			hedgedProfitBeforeGasEth: '0.1',
			lifecycleGasCostEth: '0.02',
			lifecycleReceiptRecovered: false,
			lifecycleTargetBlockNumber: undefined,
			lifecycleTokenDecimals: undefined,
			lifecycleTransactionHashes: [],
			lifecycleUpdatedAt: new Date(0).toISOString(),
			lifecycleWalletTokenBefore: undefined,
			lifecycleWalletWethBefore: undefined,
			lockedToken: '1',
			lockedWeth: '1',
			manualReconciliation: undefined,
			openedAt: new Date(0).toISOString(),
			realizedNetProfitEth: undefined,
			reportId: '1',
			status: 'open',
			token: address,
			tokenSymbol: 'REP',
			withdrawnToken: '0',
			withdrawnWeth: '0',
		} satisfies PositionRecord
		const state: OperatorState = {
			activeReportCount: 0,
			consecutivePollFailures: 2,
			balances: undefined,
			blockNumber: undefined,
			blockTimestamp: undefined,
			endpointChecks: [],
			executionHistory: [],
			gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
			lastError: undefined,
			lastPollAt: undefined,
			operationLog: [],
			opportunities: [],
			paused: false,
			positions: [base, { ...base, closedAt: new Date(1).toISOString(), realizedNetProfitEth: '-0.04', reportId: '2', status: 'closed' }],
			priceHistory: [],
			reportPaths: [],
			status: 'running',
			tokenAddresses: [],
			tokenMarkets: [],
			transactionActivity: [],
		}
		const snapshot = operatorSnapshot(state, strategy(), submission, connectivity, fixed)
		expect(snapshot.consecutivePollFailures).toBe(2)
		expect(snapshot.totalHedgedProfitBeforeGasEth).toBe('0.2')
		expect(snapshot.totalOpenHedgedNetProfitEth).toBe('0.07')
		expect(snapshot.totalRealizedNetProfitEth).toBe('-0.04')
	})

	test('excludes staged entry quotes from actual position P&L totals', () => {
		const base = {
			account: address,
			actualEntryGasCostEth: '0',
			capitalAtRiskWeth: '1',
			closedAt: undefined,
			direction: 'sell-rep',
			entryTransactionHash: `0x${'ab'.repeat(32)}` as Hex,
			entryTransactionHashes: [`0x${'ab'.repeat(32)}` as Hex],
			gasExpenditures: [],
			historyOutbox: undefined,
			hedgeAmountToken: '1',
			hedgeWeth: '1',
			hedgedProfitBeforeGasEth: '9',
			lifecycleGasCostEth: '0',
			lifecycleReceiptRecovered: false,
			lifecycleTargetBlockNumber: undefined,
			lifecycleTokenDecimals: undefined,
			lifecycleTransactionHashes: [],
			lifecycleUpdatedAt: undefined,
			lifecycleWalletTokenBefore: undefined,
			lifecycleWalletWethBefore: undefined,
			lockedToken: '1',
			lockedWeth: '1',
			manualReconciliation: undefined,
			openedAt: new Date(0).toISOString(),
			realizedNetProfitEth: undefined,
			reportId: '1',
			status: 'pending-entry',
			token: address,
			tokenSymbol: 'REP',
			withdrawnToken: '0',
			withdrawnWeth: '0',
		} satisfies PositionRecord
		const state: OperatorState = {
			activeReportCount: 0,
			balances: undefined,
			blockNumber: undefined,
			blockTimestamp: undefined,
			endpointChecks: [],
			executionHistory: [],
			gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
			lastError: undefined,
			lastPollAt: undefined,
			operationLog: [],
			opportunities: [],
			paused: false,
			positions: [base, { ...base, reportId: '2', status: 'recovery-required' }],
			priceHistory: [],
			reportPaths: [],
			status: 'running',
			tokenAddresses: [],
			tokenMarkets: [],
			transactionActivity: [],
		}
		const snapshot = operatorSnapshot(state, strategy(), submission, connectivity, fixed)
		expect(snapshot.totalHedgedProfitBeforeGasEth).toBe('0')
		expect(snapshot.totalOpenHedgedNetProfitEth).toBe('0')
		expect(snapshot.totalRealizedNetProfitEth).toBe('0')
	})

	test('excludes ambiguous lifecycle receipts from actual P&L while retaining manually recorded realized P&L', () => {
		const pending = {
			account: address,
			actualEntryGasCostEth: '0.01',
			capitalAtRiskWeth: '1',
			closedAt: undefined,
			direction: 'sell-rep',
			entryTransactionHash: `0x${'ab'.repeat(32)}` as Hex,
			entryTransactionHashes: [`0x${'ab'.repeat(32)}` as Hex],
			gasExpenditures: [
				{ costEth: '0.01', minedAt: new Date(0).toISOString(), transactionHash: `0x${'ab'.repeat(32)}` as Hex },
				{ costEth: '0.005', minedAt: new Date(1).toISOString(), transactionHash: `0x${'cd'.repeat(32)}` as Hex },
			],
			historyOutbox: undefined,
			hedgeAmountToken: '1',
			hedgeWeth: '1',
			hedgedProfitBeforeGasEth: '9',
			lifecycleGasCostEth: '0',
			lifecycleReceiptRecovered: false,
			lifecycleTargetBlockNumber: '123',
			lifecycleTokenDecimals: '18',
			lifecycleTransactionHashes: [`0x${'cd'.repeat(32)}` as Hex],
			lifecycleUpdatedAt: new Date(1).toISOString(),
			lifecycleWalletTokenBefore: '1',
			lifecycleWalletWethBefore: '1',
			lockedToken: '1',
			lockedWeth: '1',
			manualReconciliation: undefined,
			openedAt: new Date(0).toISOString(),
			realizedNetProfitEth: undefined,
			reportId: '3',
			status: 'recovery-required',
			token: address,
			tokenSymbol: 'REP',
			withdrawnToken: '0',
			withdrawnWeth: '0',
		} satisfies PositionRecord
		const manuallyClosed = {
			...pending,
			closedAt: new Date(2).toISOString(),
			manualReconciliation: {
				evidence: 'Archived receipts and balances',
				externalCostEth: '0.01',
				finalWalletToken: '1',
				finalWalletWeth: '1',
				note: 'Manually reconciled',
				pnlStatus: 'recorded',
				recordedAt: new Date(2).toISOString(),
				recordedBy: address,
			},
			realizedNetProfitEth: '-0.2',
			reportId: '4',
			status: 'closed',
		} satisfies PositionRecord
		const state: OperatorState = {
			activeReportCount: 0,
			balances: undefined,
			blockNumber: undefined,
			blockTimestamp: undefined,
			endpointChecks: [],
			executionHistory: [],
			gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
			lastError: undefined,
			lastPollAt: undefined,
			operationLog: [],
			opportunities: [],
			paused: false,
			positions: [pending, manuallyClosed],
			priceHistory: [],
			reportPaths: [],
			status: 'running',
			tokenAddresses: [],
			tokenMarkets: [],
			transactionActivity: [],
		}
		const snapshot = operatorSnapshot(state, strategy(), submission, connectivity, fixed)
		expect(snapshot.totalHedgedProfitBeforeGasEth).toBe('0')
		expect(snapshot.totalOpenHedgedNetProfitEth).toBe('0')
		expect(snapshot.totalRealizedNetProfitEth).toBe('-0.2')
	})

	test('persists valid records and calculates totals', async () => {
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
		await appendExecutionHistory(path, record, 1)
		await appendExecutionHistory(path, record, 1)
		const history = await loadExecutionHistory(path, 1)
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
			positions: [],
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

	test('rejects malformed execution history instead of silently understating accounting', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-test-'))
		temporaryDirectories.push(directory)
		const path = join(directory, 'history.jsonl')
		await writeFile(path, '{"transactionHash":"torn"', 'utf8')
		await expect(loadExecutionHistory(path, 1)).rejects.toThrow('line 1')
	})

	test('rejects valid execution history bound to another chain', async () => {
		const directory = await mkdtemp(join(tmpdir(), 'zoltar-arbitrager-history-chain-'))
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
		await appendExecutionHistory(path, record, 1)
		await expect(loadExecutionHistory(path, 11_155_111)).rejects.toThrow('belongs to another chain')
	})

	test('syncs appended history and its parent directory before acknowledging the record', async () => {
		const events: string[] = []
		let opened = 0
		const fileHandle = {
			appendFile: async () => {
				events.push('file:append')
			},
			chmod: async () => {
				events.push('file:chmod')
			},
			close: async () => {
				events.push('file:close')
			},
			sync: async () => {
				events.push('file:sync')
			},
		}
		const directoryHandle = {
			appendFile: async () => {
				throw new Error('directory append is unexpected')
			},
			chmod: async () => {
				throw new Error('directory chmod is unexpected')
			},
			close: async () => {
				events.push('directory:close')
			},
			sync: async () => {
				events.push('directory:sync')
			},
		}
		const filesystem: ExecutionHistoryFilesystem = {
			mkdir: async () => {
				events.push('mkdir')
			},
			open: async () => {
				opened += 1
				return opened === 1 ? fileHandle : directoryHandle
			},
			readFile: async () => {
				throw new Error('read is unexpected')
			},
		}
		await appendExecutionHistory(
			'/history.jsonl',
			{
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
			},
			1,
			filesystem,
		)
		expect(events).toEqual(['mkdir', 'file:chmod', 'file:append', 'file:sync', 'file:close', 'directory:sync', 'directory:close'])
	})

	test('drains a replayed durable history outbox idempotently after restart', async () => {
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
		expect(await appendExecutionHistoryIfMissing(path, record, 1)).toBe(true)
		expect(await appendExecutionHistoryIfMissing(path, record, 1)).toBe(false)
		expect((await readFile(path, 'utf8')).trim().split('\n')).toHaveLength(1)
		expect(await loadExecutionHistory(path, 1)).toEqual([record])
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
		await writeFile(path, `${records.map(record => JSON.stringify({ chainId: 1, record })).join('\n')}\n`, 'utf8')
		const history = await loadExecutionHistory(path, 1)
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
			positions: [],
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

#!/usr/bin/env bun

import { resolve } from 'node:path'
import { createPublicClient, createWalletClient, formatEther, getAddress, http, mainnet, privateKeyToAccount, type Account, type Address, type Chain, type Hex, type PublicClient, type TransactionLog, type Transport, type WalletClient, zeroAddress } from '@zoltar/shared/ethereum'
import { decodeOpenOracleStatePreimage, getOpenOracleGameTuple, getOpenOracleHelperTuple, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC, OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import { erc20Abi, factoryAbi, openOracleAbi, poolAbi, quoterAbi } from './abi.js'
import { startDashboardServer } from './dashboard-server.js'
import { executionFailureDecision, flushExecutionHistory, opportunityDecision, recordConfirmedExecution, runFundedExecution, selectBestExecution, waitForResolvedTransaction } from './execution-orchestration.js'
import { appendExecutionHistory, decimalWeth, ensureExecutionHistoryWritable, loadExecutionHistory, operatorSnapshot, strategySettings, updateStrategyFromRequest, type BalanceSnapshot, type ExecutionRecord, type MutableStrategy, type OperatorState, type OpportunitySnapshot } from './operator-state.js'
import { bestSuccessful, pollUntilStopped, replaceOverlap } from './resilience.js'
import { calculateContribution, calculateFee, calculateNextAmount1, deriveTokenToSwap, evaluateBuyRep, evaluateSellRep, hasFreshSubmissionWindow, isSelfReport, meetsProfitThreshold, type ArbitrageQuote } from './strategy.js'

const WETH = getAddress('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
const REP = getAddress('0x221657776846890989a759BA2973e427DfF5C9bB')
const FACTORY = getAddress('0x1F98431c8aD98523631AE4a59f267346ea31F984')
const QUOTER = getAddress('0x61fFE014bA17989E743c5F6cB21bF9697530B21e')
const FEES = [100, 500, 3000, 10000] as const
const REORG_OVERLAP_BLOCKS = 12n

type Configuration = MutableStrategy & {
	execute: boolean
	historyFile: string
	lookbackBlocks: bigint
	once: boolean
	openOracle: Address
	privateKey: Hex | undefined
	rpcUrl: string
	ui: boolean
	uiPort: number
}

type ActiveReport = {
	latest: OpenOracleStatePreimage
	settled: boolean
}

type Pool = {
	address: Address
	fee: (typeof FEES)[number]
	liquidity: bigint
	spotTick: bigint
	twapTick: bigint
}

type RawBalances = {
	eth: bigint
	rep: bigint
	weth: bigint
}

type ExecutionCandidate = {
	opportunity: OpportunitySnapshot
	pool: Pool
	quote: ArbitrageQuote
	report: OpenOracleStatePreimage
}

type EvaluatedOpportunity = {
	candidate: ExecutionCandidate | undefined
	opportunity: OpportunitySnapshot
}

type ReadClient = PublicClient<Transport, Chain>
type WriteClient = WalletClient<Transport, Chain, Account>

function printHelp() {
	console.log(`OpenOracle arbitrager

Usage:
  ./open-oracle-arbitrager --open-oracle=0x... [options]

Modes:
  --once                         Scan once and exit
  --ui                           Serve the local dashboard on 127.0.0.1
  --execute                      Submit guarded disputes (requires PRIVATE_KEY)

Strategy:
  --minimum-profit-weth=0.01     Absolute modeled net-profit floor
  --minimum-profit-bps=100       Modeled return floor relative to hedge cost
  --max-spot-twap-ticks=100      Maximum accepted Uniswap tick deviation
  --twap-seconds=1800            Uniswap TWAP window
  --minimum-remaining-blocks=3   Inclusion buffer for block-based games
  --minimum-remaining-seconds=36 Inclusion buffer for timestamp-based games
  --poll-ms=12000                Continuous scan interval

Data and connectivity:
  --rpc-url=https://...          Mainnet RPC (or ETH_RPC_URL)
  --lookback-blocks=50000        Initial event search range
  --ui-port=4173                 Local dashboard port
  --history-file=PATH            Confirmed-submission JSONL path

Execution is off by default. See open-oracle-arbitrager-src/README.md.`)
}

function option(name: string) {
	const prefix = `--${name}=`
	const found = process.argv.find(argument => argument.startsWith(prefix))
	return found?.slice(prefix.length)
}

function requiredAddress(name: string) {
	const value = option(name) ?? process.env['OPEN_ORACLE_ADDRESS']
	if (value === undefined) throw new Error(`Missing --${name}=0x... (or OPEN_ORACLE_ADDRESS)`)
	return getAddress(value)
}

function loadConfiguration(): Configuration {
	const privateKeyValue = process.env['PRIVATE_KEY']
	if (privateKeyValue !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(privateKeyValue)) throw new Error('PRIVATE_KEY must be a 32-byte 0x-prefixed hex value')
	const privateKey = privateKeyValue as Hex | undefined
	const strategy: MutableStrategy = {
		maxSpotTwapTicks: 0n,
		minimumProfitBps: 0n,
		minimumProfitWeth: 0n,
		minimumRemainingBlocks: 1n,
		minimumRemainingSeconds: 1n,
		pollMilliseconds: 1_000,
		twapSeconds: 60,
	}
	updateStrategyFromRequest(strategy, {
		maxSpotTwapTicks: option('max-spot-twap-ticks') ?? '100',
		minimumProfitBps: option('minimum-profit-bps') ?? '100',
		minimumProfitWeth: option('minimum-profit-weth') ?? '0.01',
		minimumRemainingBlocks: option('minimum-remaining-blocks') ?? '3',
		minimumRemainingSeconds: option('minimum-remaining-seconds') ?? '36',
		pollMilliseconds: Number(option('poll-ms') ?? '12000'),
		twapSeconds: Number(option('twap-seconds') ?? '1800'),
	})
	return {
		...strategy,
		execute: process.argv.includes('--execute'),
		historyFile: resolve(option('history-file') ?? '.open-oracle-arbitrager/history.jsonl'),
		lookbackBlocks: BigInt(option('lookback-blocks') ?? '50000'),
		once: process.argv.includes('--once'),
		openOracle: requiredAddress('open-oracle'),
		privateKey,
		rpcUrl: option('rpc-url') ?? process.env['ETH_RPC_URL'] ?? 'https://ethereum-rpc.publicnode.com',
		ui: process.argv.includes('--ui'),
		uiPort: Number(option('ui-port') ?? '4173'),
	}
}

function mutableStrategy(config: MutableStrategy): MutableStrategy {
	return {
		maxSpotTwapTicks: config.maxSpotTwapTicks,
		minimumProfitBps: config.minimumProfitBps,
		minimumProfitWeth: config.minimumProfitWeth,
		minimumRemainingBlocks: config.minimumRemainingBlocks,
		minimumRemainingSeconds: config.minimumRemainingSeconds,
		pollMilliseconds: config.pollMilliseconds,
		twapSeconds: config.twapSeconds,
	}
}

function applyStrategy(target: MutableStrategy, source: MutableStrategy) {
	target.maxSpotTwapTicks = source.maxSpotTwapTicks
	target.minimumProfitBps = source.minimumProfitBps
	target.minimumProfitWeth = source.minimumProfitWeth
	target.minimumRemainingBlocks = source.minimumRemainingBlocks
	target.minimumRemainingSeconds = source.minimumRemainingSeconds
	target.pollMilliseconds = source.pollMilliseconds
	target.twapSeconds = source.twapSeconds
}

function reportId(log: TransactionLog) {
	const topic = log.topics[1]
	if (topic === undefined) throw new Error('OpenOracle event missing report id')
	return BigInt(topic)
}

function applyLogs(reports: Map<bigint, ActiveReport>, logs: readonly TransactionLog[]) {
	for (const log of logs) {
		if (log.removed === true) continue
		const id = reportId(log)
		const signature = log.topics[0]?.toLowerCase()
		if (signature === OPEN_ORACLE_REPORT_SETTLED_TOPIC.toLowerCase()) {
			const current = reports.get(id)
			if (current !== undefined) current.settled = true
			continue
		}
		if (signature !== OPEN_ORACLE_REPORT_SUBMITTED_TOPIC.toLowerCase() && signature !== OPEN_ORACLE_REPORT_DISPUTED_TOPIC.toLowerCase()) continue
		reports.set(id, {
			latest: decodeOpenOracleStatePreimage(log.data, id),
			settled: false,
		})
	}
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

function logBlockNumber(log: TransactionLog): bigint {
	if (log.blockNumber === null || log.blockNumber === undefined) throw new Error('OpenOracle log is missing its block number')
	return log.blockNumber
}

function compareLogs(left: TransactionLog, right: TransactionLog) {
	const leftBlock = logBlockNumber(left)
	const rightBlock = logBlockNumber(right)
	if (leftBlock < rightBlock) return -1
	if (leftBlock > rightBlock) return 1
	const leftIndex = BigInt(left.logIndex ?? 0)
	const rightIndex = BigInt(right.logIndex ?? 0)
	if (leftIndex < rightIndex) return -1
	if (leftIndex > rightIndex) return 1
	return 0
}

function meanTick(tickCumulatives: readonly bigint[], seconds: bigint) {
	const oldTick = tickCumulatives[0]
	const newTick = tickCumulatives[1]
	if (oldTick === undefined || newTick === undefined) throw new Error('Uniswap observation returned fewer than two ticks')
	const delta = newTick - oldTick
	let quotient = delta / seconds
	if (delta < 0n && delta % seconds !== 0n) quotient -= 1n
	return quotient
}

async function loadPool(client: ReadClient, address: Address, fee: Pool['fee'], twapSeconds: number): Promise<Pool | undefined> {
	const liquidity = await client.readContract({
		address,
		abi: poolAbi,
		functionName: 'liquidity',
	})
	if (liquidity === 0n) return undefined
	const slot0 = await client.readContract({
		address,
		abi: poolAbi,
		functionName: 'slot0',
	})
	const observation = await client.readContract({
		address,
		abi: poolAbi,
		functionName: 'observe',
		args: [[twapSeconds, 0]],
	})
	return {
		address,
		fee,
		liquidity,
		spotTick: slot0[1],
		twapTick: meanTick(observation[0], BigInt(twapSeconds)),
	}
}

async function poolsFor(client: ReadClient, twapSeconds: number) {
	const pools: Pool[] = []
	for (const fee of FEES) {
		try {
			const address = await client.readContract({
				address: FACTORY,
				abi: factoryAbi,
				functionName: 'getPool',
				args: [WETH, REP, fee],
			})
			if (address === zeroAddress) continue
			const pool = await loadPool(client, address, fee, twapSeconds)
			if (pool !== undefined) pools.push(pool)
		} catch (error) {
			console.error(`poolFee=${fee.toString()} skipped=${errorMessage(error)}`)
		}
	}
	return pools
}

async function quoteInput(client: ReadClient, tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number) {
	const result = await client.simulateContract({
		address: QUOTER,
		abi: quoterAbi,
		functionName: 'quoteExactInputSingle',
		args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
	})
	return result.result[0]
}

async function quoteOutput(client: ReadClient, tokenIn: Address, tokenOut: Address, amount: bigint, fee: number) {
	const result = await client.simulateContract({
		address: QUOTER,
		abi: quoterAbi,
		functionName: 'quoteExactOutputSingle',
		args: [{ tokenIn, tokenOut, amount, fee, sqrtPriceLimitX96: 0n }],
	})
	return result.result[0]
}

async function evaluate(client: ReadClient, report: OpenOracleStatePreimage, pool: Pool, gasPrice: bigint) {
	const game = report.game
	const gasCost = gasPrice * 600_000n
	const repWithFees = game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)
	return bestSuccessful(
		[async () => evaluateSellRep(game, await quoteInput(client, REP, WETH, game.currentAmount2, pool.fee), gasCost), async () => evaluateBuyRep(game, await quoteOutput(client, WETH, REP, repWithFees, pool.fee), gasCost)],
		candidate => candidate.netProfitWeth,
		error => console.error(`pool=${pool.address} quoteSkipped=${errorMessage(error)}`),
	)
}

async function loadBalances(client: ReadClient, wallet: WriteClient | undefined, pools: readonly Pool[]) {
	if (wallet === undefined) return undefined
	const address = wallet.account.address
	const [eth, weth, rep] = await Promise.all([
		client.getBalance({ address }),
		client.readContract({
			address: WETH,
			abi: erc20Abi,
			functionName: 'balanceOf',
			args: [address],
		}),
		client.readContract({
			address: REP,
			abi: erc20Abi,
			functionName: 'balanceOf',
			args: [address],
		}),
	])
	const raw = { eth, rep, weth }
	let repValueWeth: bigint | undefined
	if (rep === 0n) repValueWeth = 0n
	else {
		const best = await bestSuccessful(
			pools.map(pool => () => quoteInput(client, REP, WETH, rep, pool.fee)),
			value => value,
			() => undefined,
		)
		repValueWeth = best
	}
	const snapshot: BalanceSnapshot = {
		availableEth: decimalWeth(eth),
		availableRep: decimalWeth(rep),
		availableWeth: decimalWeth(weth),
		repValueWeth: repValueWeth === undefined ? undefined : decimalWeth(repValueWeth),
		totalValueWeth: repValueWeth === undefined ? undefined : decimalWeth(eth + weth + repValueWeth),
	}
	return { raw, snapshot }
}

async function approveAndWait(wallet: WriteClient, token: Address, spender: Address, amount: bigint) {
	if (amount === 0n) return 0n
	const hash = await wallet.writeContract({
		address: token,
		abi: erc20Abi,
		functionName: 'approve',
		args: [spender, amount],
	})
	const receipt = await waitForResolvedTransaction(
		hash,
		parameters => wallet.waitForTransactionReceipt(parameters),
		undefined,
		error => {
			console.error(`approval=${hash} confirmationRetry=${errorMessage(error)}`)
		},
	)
	if (receipt.status !== 'success') throw new Error(`Approval transaction reverted: ${hash}`)
	return receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n)
}

async function executeDispute(client: ReadClient, wallet: WriteClient, config: Configuration, report: OpenOracleStatePreimage, quote: ArbitrageQuote, pool: Pool, isPaused: () => boolean): Promise<ExecutionRecord> {
	const account = wallet.account
	if (account === undefined) throw new Error('Execution requires a local account')
	const game = report.game
	if (isSelfReport(account.address, game.currentReporter)) throw new Error('Self-disputes use different OpenOracle accounting and are not supported')
	const newAmount1 = calculateNextAmount1(game)
	const preparedAmount2 = await quoteInput(client, WETH, REP, newAmount1, pool.fee)
	const preparedTokenToSwap = deriveTokenToSwap(game, newAmount1, preparedAmount2)
	if (preparedTokenToSwap.toLowerCase() !== quote.tokenToSwap.toLowerCase()) throw new Error('Replacement ratio does not derive the selected arbitrage direction')
	const preparedContribution = calculateContribution(game, preparedTokenToSwap, game.token1, newAmount1, preparedAmount2)
	return runFundedExecution(isPaused, {
		approveToken1: () => approveAndWait(wallet, game.token1, config.openOracle, preparedContribution.token1),
		approveToken2: () => approveAndWait(wallet, game.token2, config.openOracle, preparedContribution.token2),
		prepare: async () => {
			const quoteBlock = await client.getBlock()
			if (quoteBlock.number === undefined) throw new Error('Quote block is missing its number')
			const refreshedPool = await loadPool(client, pool.address, pool.fee, config.twapSeconds)
			if (refreshedPool === undefined) throw new Error('Selected pool lost all active liquidity while approvals were mined')
			const deviation = refreshedPool.spotTick > refreshedPool.twapTick ? refreshedPool.spotTick - refreshedPool.twapTick : refreshedPool.twapTick - refreshedPool.spotTick
			if (deviation > config.maxSpotTwapTicks) throw new Error('Selected pool failed the spot/TWAP check after approvals')
			const gasPrice = (quoteBlock.baseFeePerGas ?? 0n) * 2n + 2n * 10n ** 9n
			const refreshedQuote = await evaluate(client, report, refreshedPool, gasPrice)
			if (refreshedQuote === undefined) throw new Error('Selected pool no longer serves either arbitrage direction')
			if (refreshedQuote.direction !== quote.direction) throw new Error('Best arbitrage direction changed while approvals were mined')
			if (!meetsProfitThreshold(refreshedQuote, config.minimumProfitWeth, config.minimumProfitBps)) throw new Error('Arbitrage no longer meets the profit threshold after approvals')
			const newAmount2 = await quoteInput(client, WETH, REP, newAmount1, refreshedPool.fee)
			const tokenToSwap = deriveTokenToSwap(game, newAmount1, newAmount2)
			if (tokenToSwap.toLowerCase() !== refreshedQuote.tokenToSwap.toLowerCase()) throw new Error('Refreshed replacement ratio does not derive the selected arbitrage direction')
			const contribution = calculateContribution(game, tokenToSwap, game.token1, newAmount1, newAmount2)
			if (contribution.token1 > preparedContribution.token1 || contribution.token2 > preparedContribution.token2) throw new Error('Refreshed dispute requires more token approval; aborting instead of submitting a stale quote')

			const submissionBlock = await client.getBlock()
			if (submissionBlock.number === undefined) throw new Error('Submission block is missing its number')
			const timeType = (game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) !== 0n
			const currentTime = timeType ? submissionBlock.timestamp : submissionBlock.number
			const minimumRemaining = timeType ? config.minimumRemainingSeconds : config.minimumRemainingBlocks
			if (
				!hasFreshSubmissionWindow({
					currentTime,
					deadline: game.reportTimestamp + game.settlementTime,
					minimumRemaining,
					quoteBlock: quoteBlock.number,
					submissionBlock: submissionBlock.number,
				})
			)
				throw new Error('Quote became stale or the inclusion window shrank while the dispute was prepared')

			const storedHash = await client.readContract({
				address: config.openOracle,
				abi: openOracleAbi,
				functionName: 'oracleGame',
				args: [report.helper.reportId],
			})
			if (storedHash.toLowerCase() !== hashOpenOracleStatePreimage(report).toLowerCase()) throw new Error('Report changed while the dispute was prepared')
			const request = {
				address: config.openOracle,
				abi: openOracleAbi,
				functionName: 'dispute',
				args: [report.helper.reportId, newAmount1, newAmount2, account.address, false, false, getOpenOracleGameTuple(game), getOpenOracleHelperTuple(report.helper), [quoteBlock.number, 1n, quoteBlock.timestamp, config.minimumRemainingSeconds]],
			} as const
			return { contribution, refreshedPool, refreshedQuote, request }
		},
		simulate: prepared => wallet.simulateContract(prepared.request),
		submit: prepared => wallet.writeContract(prepared.request),
		confirm: async (hash, prepared, approvalGasCost) => {
			const receipt = await waitForResolvedTransaction(
				hash,
				parameters => wallet.waitForTransactionReceipt(parameters),
				undefined,
				error => {
					console.error(`dispute=${hash} confirmationRetry=${errorMessage(error)}`)
				},
			)
			if (receipt.status !== 'success') throw new Error(`Dispute transaction reverted: ${hash}`)
			console.log(`report=${report.helper.reportId.toString()} dispute=${hash}`)
			return {
				actualGasCostEth: decimalWeth(approvalGasCost + receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n)),
				blockNumber: receipt.blockNumber.toString(),
				direction: prepared.refreshedQuote.direction,
				estimatedNetProfitWeth: decimalWeth(prepared.refreshedQuote.netProfitWeth),
				executedAt: new Date().toISOString(),
				pool: prepared.refreshedPool.address,
				poolFee: prepared.refreshedPool.fee,
				reportId: report.helper.reportId.toString(),
				requiredRep: decimalWeth(prepared.contribution.token2),
				requiredWeth: decimalWeth(prepared.contribution.token1),
				transactionHash: receipt.transactionHash,
			}
		},
	})
}

async function inspectReport(
	client: ReadClient,
	wallet: WriteClient | undefined,
	config: Configuration,
	report: OpenOracleStatePreimage,
	pools: readonly Pool[],
	blockNumber: bigint,
	blockTimestamp: bigint,
	gasPrice: bigint,
	balances: RawBalances | undefined,
	executionReady: boolean,
): Promise<EvaluatedOpportunity | undefined> {
	const game = report.game
	if (game.token1.toLowerCase() !== WETH.toLowerCase() || game.token2.toLowerCase() !== REP.toLowerCase()) return
	const timeType = (game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) !== 0n
	const currentTime = timeType ? blockTimestamp : blockNumber
	if (currentTime < game.reportTimestamp + game.disputeDelay || currentTime >= game.reportTimestamp + game.settlementTime) return
	const timeRemaining = game.reportTimestamp + game.settlementTime - currentTime
	const minimumRemaining = timeType ? config.minimumRemainingSeconds : config.minimumRemainingBlocks
	if (timeRemaining < minimumRemaining) {
		console.log(`report=${report.helper.reportId.toString()} skipped=insufficient-inclusion-window remaining=${timeRemaining.toString()}`)
		return
	}
	let best: { pool: Pool; quote: ArbitrageQuote } | undefined
	for (const pool of pools) {
		const deviation = pool.spotTick > pool.twapTick ? pool.spotTick - pool.twapTick : pool.twapTick - pool.spotTick
		if (deviation > config.maxSpotTwapTicks) continue
		const quote = await evaluate(client, report, pool, gasPrice)
		if (quote === undefined) continue
		if (best === undefined || quote.netProfitWeth > best.quote.netProfitWeth) best = { pool, quote }
	}
	if (best === undefined) {
		console.log(`report=${report.helper.reportId.toString()} skipped=no-trusted-liquid-pool`)
		return
	}
	const newAmount1 = calculateNextAmount1(game)
	const replacementAmount2 = await quoteInput(client, WETH, REP, newAmount1, best.pool.fee)
	const replacementTokenToSwap = deriveTokenToSwap(game, newAmount1, replacementAmount2)
	if (replacementTokenToSwap.toLowerCase() !== best.quote.tokenToSwap.toLowerCase()) {
		console.log(`report=${report.helper.reportId.toString()} skipped=replacement-ratio-direction-mismatch`)
		return
	}
	const contribution = calculateContribution(game, replacementTokenToSwap, game.token1, newAmount1, replacementAmount2)
	const hasRequiredInventory = balances === undefined ? undefined : balances.weth >= contribution.token1 && balances.rep >= contribution.token2
	const profitable = meetsProfitThreshold(best.quote, config.minimumProfitWeth, config.minimumProfitBps)
	const decision = opportunityDecision({
		account: wallet?.account.address,
		currentReporter: game.currentReporter,
		execute: config.execute,
		executionReady,
		hasRequiredInventory,
		profitable,
	})
	console.log([`report=${report.helper.reportId.toString()}`, `direction=${best.quote.direction}`, `pool=${best.pool.address}`, `fee=${best.pool.fee.toString()}`, `profitWeth=${formatEther(best.quote.netProfitWeth)}`, `decision=${decision}`].join(' '))
	const opportunity = {
		decision,
		direction: best.quote.direction,
		estimatedNetProfitWeth: decimalWeth(best.quote.netProfitWeth),
		hasRequiredInventory,
		pool: best.pool.address,
		poolFee: best.pool.fee,
		reportId: report.helper.reportId.toString(),
		requiredRep: decimalWeth(contribution.token2),
		requiredWeth: decimalWeth(contribution.token1),
		timeRemaining: timeRemaining.toString(),
		windowUnit: timeType ? 'seconds' : 'blocks',
	} satisfies OpportunitySnapshot
	const candidate = decision === 'eligible' ? { opportunity, pool: best.pool, quote: best.quote, report } : undefined
	return { candidate, opportunity }
}

async function main() {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		printHelp()
		return
	}
	const config = loadConfiguration()
	if (config.lookbackBlocks < 0n) throw new Error('lookback-blocks must be a non-negative integer')
	if (!Number.isSafeInteger(config.uiPort) || config.uiPort < 1 || config.uiPort > 65_535) throw new Error('ui-port must be an integer from 1 to 65535')
	if (config.ui && config.once) throw new Error('--ui cannot be combined with --once')
	if (config.execute && config.privateKey === undefined) throw new Error('--execute requires PRIVATE_KEY')
	if (config.execute) await ensureExecutionHistoryWritable(config.historyFile)
	const client = createPublicClient({
		chain: mainnet,
		transport: http(config.rpcUrl),
	})
	const wallet =
		config.privateKey === undefined
			? undefined
			: createWalletClient({
					account: privateKeyToAccount(config.privateKey),
					chain: mainnet,
					transport: http(config.rpcUrl),
				})
	const state: OperatorState = {
		activeReportCount: 0,
		balances: undefined,
		blockNumber: undefined,
		executionHistory: await loadExecutionHistory(config.historyFile),
		lastError: undefined,
		lastPollAt: undefined,
		opportunities: [],
		paused: false,
		status: 'starting',
	}
	const fixedState = {
		execute: config.execute,
		openOracle: config.openOracle,
		wallet: wallet?.account.address,
	}
	let pendingStrategy: MutableStrategy | undefined
	const dashboard = config.ui
		? startDashboardServer(config.uiPort, {
				getSnapshot: () => operatorSnapshot(state, pendingStrategy ?? config, fixedState),
				setPaused: paused => {
					state.paused = paused
					state.status = paused ? 'paused' : 'sleeping'
				},
				updateStrategy: value => {
					const next = mutableStrategy(pendingStrategy ?? config)
					updateStrategyFromRequest(next, value)
					pendingStrategy = next
					return strategySettings(next)
				},
			})
		: undefined
	const reports = new Map<bigint, ActiveReport>()
	const pendingHistory: ExecutionRecord[] = []
	let cachedLogs: TransactionLog[] = []
	let nextBlock: bigint | undefined
	console.log(`mode=${config.execute ? 'execute' : 'dry-run'} oracle=${config.openOracle} rpc=${config.rpcUrl}`)
	try {
		await pollUntilStopped(
			async () => {
				if (state.paused) {
					state.status = 'paused'
					return false
				}
				if (pendingStrategy !== undefined) {
					applyStrategy(config, pendingStrategy)
					pendingStrategy = undefined
				}
				state.status = 'scanning'
				state.lastError = undefined
				if (pendingHistory.length !== 0) {
					try {
						await flushExecutionHistory(pendingHistory, record => appendExecutionHistory(config.historyFile, record))
					} catch (error) {
						const message = `Confirmed dispute history is not durable: ${errorMessage(error)}`
						state.lastError = message
						console.error(`historyPersistenceFailed=${message}`)
					}
				}
				const executionReady = pendingHistory.length === 0
				const block = await client.getBlock()
				const blockNumber = block.number
				if (blockNumber === undefined) throw new Error('Latest block is missing its number')
				const initialFromBlock = blockNumber > config.lookbackBlocks ? blockNumber - config.lookbackBlocks : 0n
				const overlapFromBlock = nextBlock === undefined || nextBlock <= REORG_OVERLAP_BLOCKS ? 0n : nextBlock - REORG_OVERLAP_BLOCKS
				const fromBlockCandidate = nextBlock === undefined ? initialFromBlock : overlapFromBlock
				const fromBlock = fromBlockCandidate > blockNumber ? blockNumber : fromBlockCandidate
				const logs = await client.getLogs({
					address: config.openOracle,
					fromBlock,
					toBlock: blockNumber,
					topics: [[OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC]],
				})
				cachedLogs = replaceOverlap(cachedLogs, logs, fromBlock, logBlockNumber, compareLogs)
				reports.clear()
				applyLogs(reports, cachedLogs)
				nextBlock = blockNumber + 1n
				const pools = await poolsFor(client, config.twapSeconds)
				if (pools.length === 0) console.log('status=no-liquid-rep-weth-v3-pool')
				const balances = await loadBalances(client, wallet, pools)
				const gasPrice = (block.baseFeePerGas ?? 0n) * 2n + 2n * 10n ** 9n
				const opportunities: OpportunitySnapshot[] = []
				const candidates: ExecutionCandidate[] = []
				for (const report of reports.values()) {
					if (report.settled) continue
					try {
						const evaluated = await inspectReport(client, wallet, config, report.latest, pools, blockNumber, block.timestamp, gasPrice, balances?.raw, executionReady)
						if (evaluated !== undefined) {
							opportunities.push(evaluated.opportunity)
							if (evaluated.candidate !== undefined) candidates.push(evaluated.candidate)
						}
					} catch (error) {
						console.error(`report=${report.latest.helper.reportId.toString()} skipped=${errorMessage(error)}`)
					}
				}
				state.activeReportCount = [...reports.values()].filter(report => !report.settled).length
				state.balances = balances?.snapshot
				state.blockNumber = blockNumber.toString()
				state.lastPollAt = new Date().toISOString()
				state.opportunities = opportunities
				const selected = selectBestExecution(candidates, candidate => candidate.quote.netProfitWeth)
				if (selected !== undefined && wallet !== undefined) {
					selected.opportunity.decision = 'selected'
					try {
						const record = await executeDispute(client, wallet, config, selected.report, selected.quote, selected.pool, () => state.paused)
						selected.opportunity.decision = 'submitted'
						recordConfirmedExecution(state.executionHistory, pendingHistory, record)
						try {
							await flushExecutionHistory(pendingHistory, pending => appendExecutionHistory(config.historyFile, pending))
						} catch (error) {
							const message = `Confirmed dispute ${record.transactionHash} is visible but history persistence failed: ${errorMessage(error)}`
							state.lastError = message
							console.error(`historyPersistenceFailed=${message}`)
						}
					} catch (error) {
						const message = errorMessage(error)
						selected.opportunity.decision = executionFailureDecision(error)
						if (selected.opportunity.decision === 'execution-failed') {
							state.lastError = `Report ${selected.report.helper.reportId.toString()} execution failed: ${message}`
						}
						console.error(`report=${selected.report.helper.reportId.toString()} executionFailed=${message}`)
					}
				}
				state.status = 'sleeping'
				if (state.lastError !== undefined) state.status = 'error'
				if (state.paused) state.status = 'paused'
				return config.once
			},
			() => Bun.sleep(config.pollMilliseconds),
			config.once,
			error => {
				const message = errorMessage(error)
				state.lastError = message
				state.status = 'error'
				console.error(`pollFailed=${message}`)
			},
		)
	} finally {
		state.status = 'stopped'
		dashboard?.stop()
	}
}

main().catch(error => {
	console.error(errorMessage(error))
	process.exitCode = 1
})

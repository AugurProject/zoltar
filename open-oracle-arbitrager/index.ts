#!/usr/bin/env bun

import { resolve } from 'node:path'
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, getAddress, http, privateKeyToAccount, type Account, type Address, type Chain, type Hex, type PublicClient, type TransactionLog, type Transport, type WalletClient, zeroAddress } from '@zoltar/shared/ethereum'
import { decodeOpenOracleStatePreimage, getOpenOracleGameTuple, getOpenOracleHelperTuple, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC, OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import { erc20Abi, factoryAbi, openOracleAbi, openOracleArbitrageExecutorAbi, poolAbi, quoterAbi } from './abi.js'
import { advanceCursorAfterSuccessfulHead, cursorForHeadScan, initialCursor, operatorStatusAfterPause, scanRanges, type SyncCursor } from './block-sync.js'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, sendRawTransactionToRpc, updateConnectivityEndpointChecks, updateSubmissionEndpointChecks, validateConnectivitySettings, type ConnectivitySettings } from './connectivity.js'
import { startDashboardServer } from './dashboard-server.js'
import {
	attemptConfirmationRecovery,
	executionFailureDecision,
	executionTokenAllowed,
	flushExecutionHistory,
	fundingTransactionPlan,
	guardedTransactionSubmission,
	isExecutionPausedError,
	opportunityDecision,
	recordConfirmedExecution,
	retryPrivateSubmissionWithinWindow,
	selectBestExecution,
	simulateTrackedPrivateBundle,
	trackPrivateBundleReceiptStatuses,
	waitForResolvedTransaction,
} from './execution-orchestration.js'
import {
	appendExecutionHistory,
	clearWalletDerivedState,
	decimalSignedEth,
	decimalWeth,
	ensureExecutionHistoryWritable,
	gameCapitalSnapshot,
	loadExecutionHistory,
	operatorSnapshot,
	recordOperation,
	strategySettings,
	updateStrategyFromRequest,
	type BalanceSnapshot,
	type ExecutionRecord,
	type MutableStrategy,
	type OperatorState,
	type OpportunitySnapshot,
	type TransactionActivity,
	type DisputeStepSnapshot,
} from './operator-state.js'
import { appendPriceHistory, availableTokenBalances, createTokenCatalogTracker, discoverAugurRepTokens, formatTokenAmount, loadPriceHistory, loadTokenMarkets, missingPricePoints, pricePoints } from './market-monitor.js'
import { defaultRpcUrl, networkConfiguration, parseNetworkName, type NetworkConfiguration } from './network.js'
import { bestSuccessful, pollUntilStopped, replaceOverlap } from './resilience.js'
import { loadOperatorSettings, saveOperatorSettings, type PersistedOperatorSettings } from './settings-store.js'
import { signerCandidate } from './signer.js'
import { calculateContribution, calculateFee, calculateNextAmount1, calculateTrackedNetProfitEth, deriveTokenToSwap, evaluateBuyRep, evaluateSellRep, hasFreshSubmissionWindow, isSelfReport, meetsProfitThreshold, type ArbitrageQuote } from './strategy.js'
import {
	assertSubmissionWindowOpen,
	mergeSubmissionFailures,
	prepareSignedTransaction,
	simulateSignedBundleEveryRelay,
	SubmissionFailure,
	submitSignedBundle,
	submitSignedTransaction,
	validateSubmissionSettings,
	type SignedTransaction,
	type SubmissionSettings,
	type SubmittedTransaction,
	type SubmissionTargetResult,
} from './transaction-submission.js'

const FEES = [100, 500, 3000, 10000] as const
const REORG_OVERLAP_BLOCKS = 12n

type Configuration = MutableStrategy & {
	execute: boolean
	executor: Address | undefined
	historyFile: string
	priceHistoryFile: string
	lookbackBlocks: bigint
	network: NetworkConfiguration
	once: boolean
	openOracle: Address
	paused: boolean
	persistedPrivateKey: Hex | undefined
	privateKey: Hex | undefined
	settingsFile: string
	tokenAddresses: Address[]
	connectivity: ConnectivitySettings
	submission: SubmissionSettings
	ui: boolean
	uiPort: number
}

type ActiveReport = {
	latest: OpenOracleStatePreimage
	settled: boolean
	steps: DisputeStepSnapshot[]
}

type Pool = {
	address: Address
	fee: (typeof FEES)[number]
	liquidity: bigint
	spotTick: bigint
	token: Address
	twapTick: bigint
}

type RawBalances = {
	eth: bigint
	rep: bigint
	tokens: Map<string, bigint>
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
  ./open-oracle-arbitrager/run --open-oracle=0x... [options]

Modes:
  --once                         Scan once and exit
  --ui                           Serve the local dashboard on 127.0.0.1
  --execute                      Submit guarded disputes (key from env or local UI)
  --executor-address=0x...       Deployed atomic arbitrage executor; required with --execute
  --submission-mode=private      Submit atomic bundles (private) or one executor call (public)
  --relay-url=https://...        Bundle relay URL; repeat for multiple relays

Strategy:
  --minimum-profit-weth=0.01     Absolute modeled net-profit floor
  --minimum-profit-bps=100       Modeled return floor relative to hedge cost
  --max-spot-twap-ticks=100      Maximum accepted Uniswap tick deviation
  --twap-seconds=1800            Uniswap TWAP window
  --minimum-remaining-blocks=3   Inclusion buffer for block-based games
  --minimum-remaining-seconds=36 Inclusion buffer for timestamp-based games
  --poll-ms=1000                 Latest-head polling interval

Data and connectivity:
  --network=mainnet|sepolia      Expected network; defaults to mainnet
  --rpc-url=https://...          Read RPC (or ETH_RPC_URL)
  --public-rpc-url=https://...   Public submission RPC; repeat to fan out
  --rep-address=0x...            REP address; required on Sepolia
  --token-address=0x...          Explicit execution-token allowlist; repeat as needed
  --weth-address=0x...           Override the network WETH address
  --uniswap-factory=0x...        Override the Uniswap V3 factory
  --uniswap-quoter=0x...         Override the Uniswap V3 quoter
  --lookback-blocks=50000        Initial event search range
  --ui-port=4173                 Local dashboard port
  --history-file=PATH            Confirmed-submission JSONL path
  --price-history-file=PATH      Current-head pool-price JSONL path
  --settings-file=PATH           Persistent dashboard settings JSON path

Execution is off by default. See open-oracle-arbitrager/README.md.`)
}

function option(name: string) {
	const prefix = `--${name}=`
	const found = process.argv.find(argument => argument.startsWith(prefix))
	return found?.slice(prefix.length)
}

function options(name: string) {
	const prefix = `--${name}=`
	return process.argv.filter(argument => argument.startsWith(prefix)).map(argument => argument.slice(prefix.length))
}

function requiredAddress(name: string) {
	const value = option(name) ?? process.env['OPEN_ORACLE_ADDRESS']
	if (value === undefined) throw new Error(`Missing --${name}=0x... (or OPEN_ORACLE_ADDRESS)`)
	return getAddress(value)
}

async function loadConfiguration(): Promise<Configuration> {
	const privateKeyValue = process.env['PRIVATE_KEY']
	if (privateKeyValue !== undefined && !/^0x[0-9a-fA-F]{64}$/.test(privateKeyValue)) throw new Error('PRIVATE_KEY must be a 32-byte 0x-prefixed hex value')
	const networkName = parseNetworkName(option('network'))
	const settingsFile = resolve(option('settings-file') ?? `.open-oracle-arbitrager/settings-${networkName}.json`)
	const saved = await loadOperatorSettings(settingsFile, networkName)
	const strategy = mutableStrategy(
		saved?.strategy ?? {
			maxSpotTwapTicks: 100n,
			minimumProfitBps: 100n,
			minimumProfitWeth: 10n ** 16n,
			minimumRemainingBlocks: 3n,
			minimumRemainingSeconds: 36n,
			pollMilliseconds: 1_000,
			twapSeconds: 1_800,
		},
	)
	updateStrategyFromRequest(strategy, {
		maxSpotTwapTicks: option('max-spot-twap-ticks') ?? strategy.maxSpotTwapTicks.toString(),
		minimumProfitBps: option('minimum-profit-bps') ?? strategy.minimumProfitBps.toString(),
		minimumProfitWeth: option('minimum-profit-weth') ?? decimalWeth(strategy.minimumProfitWeth),
		minimumRemainingBlocks: option('minimum-remaining-blocks') ?? strategy.minimumRemainingBlocks.toString(),
		minimumRemainingSeconds: option('minimum-remaining-seconds') ?? strategy.minimumRemainingSeconds.toString(),
		pollMilliseconds: Number(option('poll-ms') ?? strategy.pollMilliseconds),
		twapSeconds: Number(option('twap-seconds') ?? strategy.twapSeconds),
	})
	const network = networkConfiguration(networkName, {
		factory: option('uniswap-factory') ?? process.env['UNISWAP_FACTORY_ADDRESS'],
		quoter: option('uniswap-quoter') ?? process.env['UNISWAP_QUOTER_ADDRESS'],
		rep: option('rep-address') ?? process.env['REP_ADDRESS'],
		weth: option('weth-address') ?? process.env['WETH_ADDRESS'],
	})
	const readRpcUrl = option('rpc-url') ?? process.env['ETH_RPC_URL'] ?? saved?.connectivity.readRpcUrl ?? defaultRpcUrl(networkName)
	const publicRpcUrls = options('public-rpc-url')
	const relayUrls = options('relay-url')
	const privateKey = (privateKeyValue as Hex | undefined) ?? saved?.privateKey
	const execute = process.argv.includes('--execute')
	const executorValue = option('executor-address') ?? process.env['OPEN_ORACLE_EXECUTOR_ADDRESS']
	if (execute && executorValue === undefined) throw new Error('--execute requires --executor-address=0x... (or OPEN_ORACLE_EXECUTOR_ADDRESS)')
	return {
		...strategy,
		execute,
		executor: executorValue === undefined ? undefined : getAddress(executorValue),
		historyFile: resolve(option('history-file') ?? `.open-oracle-arbitrager/history-${networkName}.jsonl`),
		priceHistoryFile: resolve(option('price-history-file') ?? `.open-oracle-arbitrager/prices-${networkName}.jsonl`),
		lookbackBlocks: BigInt(option('lookback-blocks') ?? '50000'),
		network,
		once: process.argv.includes('--once'),
		openOracle: requiredAddress('open-oracle'),
		paused: saved?.paused ?? false,
		persistedPrivateKey: saved?.privateKey,
		privateKey,
		settingsFile,
		tokenAddresses: [...new Set([network.rep, ...(saved?.tokenAddresses ?? []), ...options('token-address').map(getAddress)])],
		connectivity: validateConnectivitySettings({
			publicRpcUrls: publicRpcUrls.length === 0 ? (saved?.connectivity.publicRpcUrls ?? [readRpcUrl]) : publicRpcUrls,
			readRpcUrl,
		}),
		submission: validateSubmissionSettings({
			mode: option('submission-mode') ?? saved?.submission.mode ?? 'private',
			relayUrls: relayUrls.length === 0 ? (saved?.submission.relayUrls ?? ['https://relay.flashbots.net']) : relayUrls,
		}),
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
			if (current !== undefined) {
				current.settled = true
				current.steps.push({
					amount1: undefined,
					amount2: undefined,
					blockNumber: logBlockNumber(log).toString(),
					event: 'settled',
					reporter: undefined,
					transactionHash: log.transactionHash ?? undefined,
				})
			}
			continue
		}
		if (signature !== OPEN_ORACLE_REPORT_SUBMITTED_TOPIC.toLowerCase() && signature !== OPEN_ORACLE_REPORT_DISPUTED_TOPIC.toLowerCase()) continue
		const latest = decodeOpenOracleStatePreimage(log.data, id)
		const previous = reports.get(id)
		reports.set(id, {
			latest,
			settled: false,
			steps: [
				...(previous?.steps ?? []),
				{
					amount1: latest.game.currentAmount1.toString(),
					amount2: latest.game.currentAmount2.toString(),
					blockNumber: logBlockNumber(log).toString(),
					event: signature === OPEN_ORACLE_REPORT_SUBMITTED_TOPIC.toLowerCase() ? 'submitted' : 'disputed',
					reporter: latest.game.currentReporter,
					transactionHash: log.transactionHash ?? undefined,
				},
			],
		})
	}
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
}

function transactionLogLevel(status: TransactionActivity['status']) {
	if (status === 'reverted' || status === 'submission-failed') return 'error'
	if (status === 'confirmation-unknown') return 'warning'
	return 'info'
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

async function loadPool(client: ReadClient, address: Address, token: Address, fee: Pool['fee'], twapSeconds: number): Promise<Pool | undefined> {
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
		token,
		twapTick: meanTick(observation[0], BigInt(twapSeconds)),
	}
}

async function poolsForToken(client: ReadClient, config: Configuration, token: Address) {
	const pools: Pool[] = []
	for (const fee of FEES) {
		try {
			const address = await client.readContract({
				address: config.network.factory,
				abi: factoryAbi,
				functionName: 'getPool',
				args: [config.network.weth, token, fee],
			})
			if (address === zeroAddress) continue
			const pool = await loadPool(client, address, token, fee, config.twapSeconds)
			if (pool !== undefined) pools.push(pool)
		} catch (error) {
			console.error(`poolFee=${fee.toString()} skipped=${errorMessage(error)}`)
		}
	}
	return pools
}

async function quoteInput(client: ReadClient, quoter: Address, tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number) {
	const result = await client.simulateContract({
		address: quoter,
		abi: quoterAbi,
		functionName: 'quoteExactInputSingle',
		args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
	})
	return result.result[0]
}

async function quoteOutput(client: ReadClient, quoter: Address, tokenIn: Address, tokenOut: Address, amount: bigint, fee: number) {
	const result = await client.simulateContract({
		address: quoter,
		abi: quoterAbi,
		functionName: 'quoteExactOutputSingle',
		args: [{ tokenIn, tokenOut, amount, fee, sqrtPriceLimitX96: 0n }],
	})
	return result.result[0]
}

async function evaluate(client: ReadClient, config: Configuration, report: OpenOracleStatePreimage, pool: Pool, gasPrice: bigint) {
	const game = report.game
	const gasCost = gasPrice * 600_000n
	const repWithFees = game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)
	return bestSuccessful(
		[async () => evaluateSellRep(game, await quoteInput(client, config.network.quoter, pool.token, config.network.weth, game.currentAmount2, pool.fee), gasCost), async () => evaluateBuyRep(game, await quoteOutput(client, config.network.quoter, config.network.weth, pool.token, repWithFees, pool.fee), gasCost)],
		candidate => candidate.netProfitWeth,
		error => console.error(`pool=${pool.address} quoteSkipped=${errorMessage(error)}`),
	)
}

async function loadBalances(client: ReadClient, wallet: WriteClient | undefined, config: Configuration, pools: readonly Pool[], tokens: readonly Address[]) {
	if (wallet === undefined) return undefined
	const address = wallet.account.address
	const [eth, weth, rep] = await Promise.all([
		client.getBalance({ address }),
		client.readContract({
			address: config.network.weth,
			abi: erc20Abi,
			functionName: 'balanceOf',
			args: [address],
		}),
		client.readContract({
			address: config.network.rep,
			abi: erc20Abi,
			functionName: 'balanceOf',
			args: [address],
		}),
	])
	const tokenBalances = await availableTokenBalances(tokens, token =>
		client.readContract({
			address: token,
			abi: erc20Abi,
			functionName: 'balanceOf',
			args: [address],
		}),
	)
	const raw = { eth, rep, tokens: tokenBalances, weth }
	let repValueWeth: bigint | undefined
	if (rep === 0n) repValueWeth = 0n
	else {
		const best = await bestSuccessful(
			pools.filter(pool => pool.token.toLowerCase() === config.network.rep.toLowerCase()).map(pool => () => quoteInput(client, config.network.quoter, config.network.rep, config.network.weth, rep, pool.fee)),
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

type TrackTransaction = (activity: TransactionActivity) => void

type TrackedSubmission = SignedTransaction &
	SubmittedTransaction & {
		estimatedNetProfitEth: string | undefined
		kind: TransactionActivity['kind']
		reportId: string
		submittedAt: string
		token: Address | undefined
		tokenSymbol: string | undefined
	}

function trackedActivity(submission: TrackedSubmission, status: TransactionActivity['status'], actualGasCostEth: string | undefined = undefined, hash: Hex = submission.hash, trackedNetProfitEth: string | undefined = undefined): TransactionActivity {
	return {
		acceptedTargets: submission.acceptedTargets,
		actualGasCostEth,
		estimatedNetProfitEth: submission.estimatedNetProfitEth,
		failedTargets: submission.failedTargets,
		hash,
		kind: submission.kind,
		mode: submission.mode,
		originalHash: submission.hash,
		reportId: submission.reportId,
		status,
		submittedAt: submission.submittedAt,
		token: submission.token,
		tokenSymbol: submission.tokenSymbol,
		trackedNetProfitEth,
		updatedAt: new Date().toISOString(),
	}
}

async function submitContractTransaction(
	client: ReadClient,
	wallet: WriteClient,
	config: Configuration,
	signed: SignedTransaction,
	details: { estimatedNetProfitEth: string | undefined; kind: TransactionActivity['kind']; reportId: string; token?: Address | undefined; tokenSymbol?: string | undefined },
	isPaused: () => boolean,
	track: TrackTransaction,
): Promise<TrackedSubmission> {
	const account = wallet.account
	const signMessage = account?.signMessage
	if (account === undefined || signMessage === undefined) throw new Error('Execution requires a local relay authentication signer')
	const submittedAt = new Date().toISOString()
	const initial: TrackedSubmission = {
		...signed,
		acceptedTargets: [],
		estimatedNetProfitEth: details.estimatedNetProfitEth,
		failedTargets: [],
		kind: details.kind,
		mode: config.submission.mode,
		reportId: details.reportId,
		submittedAt,
		token: details.token,
		tokenSymbol: details.tokenSymbol,
	}
	try {
		const result = await guardedTransactionSubmission(
			isPaused,
			async () => {
				if (signed.lastValidBlockNumber !== undefined) assertSubmissionWindowOpen(signed.lastValidBlockNumber, await client.getBlockNumber())
			},
			() => {
				track(trackedActivity(initial, 'submitting'))
				return submitSignedTransaction({
					address: account.address,
					hash: signed.hash,
					maxBlockNumber: signed.maxBlockNumber,
					publicRpcUrls: config.connectivity.publicRpcUrls,
					publicSubmit: sendRawTransactionToRpc,
					serializedTransaction: signed.serializedTransaction,
					settings: config.submission,
					signMessage,
				})
			},
		)
		const submission = { ...initial, ...result }
		track(trackedActivity(submission, 'pending'))
		return submission
	} catch (error) {
		if (isExecutionPausedError(error)) throw error
		const failedTargets: readonly SubmissionTargetResult[] =
			error instanceof SubmissionFailure
				? error.failedTargets
				: [
						{
							error: errorMessage(error),
							target: config.submission.mode === 'public' ? 'public mempool' : 'private relay submission',
						},
					]
		track(trackedActivity({ ...initial, failedTargets }, 'submission-failed'))
		throw error
	}
}

async function waitForTrackedTransaction(client: ReadClient, wallet: WriteClient, config: Configuration, submission: TrackedSubmission, track: TrackTransaction) {
	const account = wallet.account
	const signMessage = account?.signMessage
	if (account === undefined || signMessage === undefined) throw new Error('Execution requires a local relay authentication signer')
	let tracked = submission
	const receipt = await waitForResolvedTransaction(
		submission.hash,
		parameters => wallet.waitForTransactionReceipt({ ...parameters, transaction: submission.transaction }),
		undefined,
		async error => {
			console.error(`transaction=${submission.hash} confirmationRetry=${errorMessage(error)}`)
			track(trackedActivity(tracked, 'confirmation-unknown'))
			if (config.submission.mode !== 'private') return
			await attemptConfirmationRecovery(
				async () => {
					const currentBlockNumber = await client.getBlockNumber()
					const retry = await retryPrivateSubmissionWithinWindow({
						currentBlockNumber,
						lastValidBlockNumber: tracked.lastValidBlockNumber,
						submit: maxBlockNumber =>
							submitSignedTransaction({
								address: account.address,
								hash: submission.hash,
								maxBlockNumber,
								publicRpcUrls: config.connectivity.publicRpcUrls,
								publicSubmit: sendRawTransactionToRpc,
								serializedTransaction: submission.serializedTransaction,
								settings: config.submission,
								signMessage,
							}),
					})
					if (!retry.attempted) {
						console.error(`transaction=${submission.hash} relayResubmissionSkipped=calldata-expired`)
						return
					}
					tracked = {
						...tracked,
						acceptedTargets: [...new Set([...tracked.acceptedTargets, ...retry.result.acceptedTargets])],
						failedTargets: retry.result.failedTargets,
						maxBlockNumber: retry.maxBlockNumber,
					}
					track(trackedActivity(tracked, 'pending'))
				},
				retryError => {
					console.error(`transaction=${submission.hash} relayResubmissionFailed=${errorMessage(retryError)}`)
					tracked = {
						...tracked,
						failedTargets: mergeSubmissionFailures(tracked.failedTargets, retryError),
					}
					track(trackedActivity(tracked, 'confirmation-unknown'))
				},
			)
		},
	)
	const actualGasCostEth = decimalWeth(receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n))
	track(trackedActivity(tracked, receipt.status === 'success' ? 'confirmed' : 'reverted', actualGasCostEth, receipt.transactionHash))
	return { receipt, tracked }
}

async function executeDispute(client: ReadClient, wallet: WriteClient, config: Configuration, report: OpenOracleStatePreimage, quote: ArbitrageQuote, pool: Pool, tokenMetadata: { decimals: number; symbol: string }, isPaused: () => boolean, track: TrackTransaction): Promise<ExecutionRecord> {
	const account = wallet.account
	const executor = config.executor
	if (account === undefined || account.signTransaction === undefined || account.signMessage === undefined) throw new Error('Execution requires a local transaction and relay signer')
	if (executor === undefined) throw new Error('Execution requires a deployed OpenOracle arbitrage executor')
	const game = report.game
	if (isSelfReport(account.address, game.currentReporter)) throw new Error('Self-disputes use different OpenOracle accounting and are not supported')
	const newAmount1 = calculateNextAmount1(game)
	const reportId = report.helper.reportId.toString()
	const quoteBlock = await client.getBlock()
	if (quoteBlock.number === undefined) throw new Error('Quote block is missing its number')
	const quoteBlockNumber = quoteBlock.number
	const signMessage = account.signMessage
	const signTransaction = account.signTransaction
	const refreshedPool = await loadPool(client, pool.address, pool.token, pool.fee, config.twapSeconds)
	if (refreshedPool === undefined) throw new Error('Selected pool lost all active liquidity')
	const deviation = refreshedPool.spotTick > refreshedPool.twapTick ? refreshedPool.spotTick - refreshedPool.twapTick : refreshedPool.twapTick - refreshedPool.spotTick
	if (deviation > config.maxSpotTwapTicks) throw new Error('Selected pool failed the final spot/TWAP check')
	const gasPrice = (quoteBlock.baseFeePerGas ?? 0n) * 2n + 2n * 10n ** 9n
	const refreshedQuote = await evaluate(client, config, report, refreshedPool, gasPrice)
	if (refreshedQuote === undefined) throw new Error('Selected pool no longer serves either arbitrage direction')
	if (refreshedQuote.direction !== quote.direction) throw new Error('Best arbitrage direction changed before submission')
	const newAmount2 = await quoteInput(client, config.network.quoter, config.network.weth, refreshedPool.token, newAmount1, refreshedPool.fee)
	const tokenToSwap = deriveTokenToSwap(game, newAmount1, newAmount2)
	if (tokenToSwap.toLowerCase() !== refreshedQuote.tokenToSwap.toLowerCase()) throw new Error('Final replacement ratio does not derive the selected arbitrage direction')
	const contribution = calculateContribution(game, tokenToSwap, game.token1, newAmount1, newAmount2)
	const timeType = (game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) !== 0n
	const currentTime = timeType ? quoteBlock.timestamp : quoteBlock.number
	const minimumRemaining = timeType ? config.minimumRemainingSeconds : config.minimumRemainingBlocks
	if (
		!hasFreshSubmissionWindow({
			currentTime,
			deadline: game.reportTimestamp + game.settlementTime,
			minimumRemaining,
			quoteBlock: quoteBlockNumber,
			submissionBlock: quoteBlockNumber,
		})
	)
		throw new Error('The final quote does not have a fresh inclusion window')
	const storedHash = await client.readContract({
		address: config.openOracle,
		abi: openOracleAbi,
		functionName: 'oracleGame',
		args: [report.helper.reportId],
	})
	if (storedHash.toLowerCase() !== hashOpenOracleStatePreimage(report).toLowerCase()) throw new Error('Report changed before submission')
	const [allowance1, allowance2] = await Promise.all([client.readContract({ address: game.token1, abi: erc20Abi, functionName: 'allowance', args: [account.address, executor] }), client.readContract({ address: game.token2, abi: erc20Abi, functionName: 'allowance', args: [account.address, executor] })])
	const plan = fundingTransactionPlan(config.submission.mode, { token1: allowance1, token2: allowance2 }, contribution)
	const request = {
		address: executor,
		abi: openOracleArbitrageExecutorAbi,
		functionName: 'dispute',
		args: [config.openOracle, newAmount1, newAmount2, getOpenOracleGameTuple(game), getOpenOracleHelperTuple(report.helper), [quoteBlockNumber, 1n, quoteBlock.timestamp, config.minimumRemainingSeconds]],
	} as const
	const targetBlockNumber = quoteBlockNumber + 1n
	const startingNonce = await client.getTransactionCount({ address: account.address, blockTag: 'pending' })
	let nonce = startingNonce
	const signedTransactions: { kind: TransactionActivity['kind']; signed: SignedTransaction; token: Address | undefined; tokenSymbol: string | undefined }[] = []
	const sign = async (to: Address, data: Hex, gasEstimate: bigint) => {
		const signed = await prepareSignedTransaction({
			baseFeePerGas: quoteBlock.baseFeePerGas ?? 0n,
			blockNumber: quoteBlockNumber,
			chainId: config.network.chain.id,
			data,
			from: account.address,
			gasEstimate,
			lastValidBlockNumber: targetBlockNumber,
			nonce,
			signTransaction,
			to,
		})
		nonce += 1n
		return signed
	}
	for (const step of plan) {
		if (step === 'execution') {
			signedTransactions.push({ kind: 'dispute', signed: await sign(executor, encodeFunctionData(request), 700_000n), token: undefined, tokenSymbol: undefined })
			continue
		}
		const token1 = step.endsWith('token1')
		const token = token1 ? game.token1 : game.token2
		let amount = token1 ? contribution.token1 : contribution.token2
		if (step.startsWith('reset')) amount = 0n
		const tokenSymbol = token1 ? 'WETH' : tokenMetadata.symbol
		signedTransactions.push({
			kind: token1 ? 'approval-weth' : 'approval-token',
			signed: await sign(token, encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [executor, amount] }), 100_000n),
			token,
			tokenSymbol,
		})
	}
	const executionSigned = signedTransactions.at(-1)?.signed
	if (executionSigned === undefined) throw new Error('Execution transaction plan is empty')
	let actualGasCost: bigint
	let estimatedNetProfit = refreshedQuote.netProfitWeth
	let receiptBlockNumber: bigint
	let executionHash = executionSigned.hash
	if (config.submission.mode === 'public') {
		await wallet.simulateContract(request)
		if (!meetsProfitThreshold(refreshedQuote, config.minimumProfitWeth, config.minimumProfitBps)) throw new Error('Arbitrage no longer meets the profit threshold at submission')
		const submission = await submitContractTransaction(client, wallet, config, executionSigned, { estimatedNetProfitEth: decimalWeth(refreshedQuote.netProfitWeth), kind: 'dispute', reportId }, isPaused, track)
		const { receipt, tracked } = await waitForTrackedTransaction(client, wallet, config, submission, track)
		if (receipt.status !== 'success') throw new Error(`Dispute transaction reverted: ${receipt.transactionHash}`)
		actualGasCost = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n)
		receiptBlockNumber = receipt.blockNumber
		executionHash = receipt.transactionHash
		const trackedNetProfitEth = decimalSignedEth(calculateTrackedNetProfitEth(refreshedQuote.profitBeforeGasWeth, actualGasCost))
		track(trackedActivity(tracked, 'confirmed', decimalWeth(actualGasCost), receipt.transactionHash, trackedNetProfitEth))
	} else {
		const serializedTransactions = signedTransactions.map(transaction => transaction.signed.serializedTransaction)
		const submittedAt = new Date().toISOString()
		let tracked = signedTransactions.map(transaction => ({
			...transaction.signed,
			acceptedTargets: [] as readonly string[],
			estimatedNetProfitEth: transaction.kind === 'dispute' ? decimalWeth(refreshedQuote.netProfitWeth) : undefined,
			failedTargets: [] as readonly SubmissionTargetResult[],
			kind: transaction.kind,
			mode: 'private' as const,
			reportId,
			submittedAt,
			token: transaction.token,
			tokenSymbol: transaction.tokenSymbol,
		}))
		const simulations = await simulateTrackedPrivateBundle(
			tracked,
			() =>
				simulateSignedBundleEveryRelay({
					address: account.address,
					relayUrls: config.submission.relayUrls,
					signMessage,
					stateBlockNumber: quoteBlockNumber,
					targetBlockNumber,
					transactions: serializedTransactions,
				}),
			(transaction, status, error) => {
				let failedTargets: readonly SubmissionTargetResult[] = []
				if (error instanceof SubmissionFailure) failedTargets = error.failedTargets
				else if (error !== undefined) {
					failedTargets = [
						{
							error: errorMessage(error),
							target: 'private relay bundle simulation',
						},
					]
				}
				track(trackedActivity({ ...transaction, failedTargets }, status))
			},
		)
		const totalGasUsed = simulations.reduce((maximum, simulation) => (simulation.totalGasUsed > maximum ? simulation.totalGasUsed : maximum), 0n)
		const simulatedNetProfit = refreshedQuote.profitBeforeGasWeth - totalGasUsed * gasPrice
		estimatedNetProfit = simulatedNetProfit
		const simulatedQuote = { ...refreshedQuote, netProfitWeth: simulatedNetProfit }
		if (!meetsProfitThreshold(simulatedQuote, config.minimumProfitWeth, config.minimumProfitBps)) {
			const error = new Error('Simulated bundle no longer meets the profit threshold')
			for (const transaction of tracked) track(trackedActivity({ ...transaction, failedTargets: [{ error: error.message, target: 'local profitability check' }] }, 'submission-failed'))
			throw error
		}
		tracked = tracked.map(transaction => ({
			...transaction,
			estimatedNetProfitEth: transaction.kind === 'dispute' ? decimalWeth(simulatedNetProfit) : undefined,
		}))
		let submission
		try {
			submission = await guardedTransactionSubmission(
				isPaused,
				async () => {
					if ((await client.getBlockNumber()) !== quoteBlockNumber) throw new Error('Bundle quote expired before submission')
				},
				async () =>
					submitSignedBundle({
						address: account.address,
						relayUrls: config.submission.relayUrls,
						signMessage,
						targetBlockNumber,
						transactions: serializedTransactions,
					}),
			)
		} catch (error) {
			const failedTargets: readonly SubmissionTargetResult[] =
				error instanceof SubmissionFailure
					? error.failedTargets
					: [
							{
								error: errorMessage(error),
								target: isExecutionPausedError(error) ? 'local pause guard' : 'private relay bundle submission',
							},
						]
			for (const transaction of tracked) track(trackedActivity({ ...transaction, failedTargets }, 'submission-failed'))
			throw error
		}
		const pending = tracked.map(transaction => ({ ...transaction, ...submission }))
		for (const transaction of pending) track(trackedActivity(transaction, 'pending'))
		while ((await client.getBlockNumber()) < targetBlockNumber) {
			await Bun.sleep(Math.min(config.pollMilliseconds, 1_000))
		}
		const receipts = await Promise.all(
			pending.map(async transaction => {
				try {
					return await client.getTransactionReceipt({ hash: transaction.hash })
				} catch (error) {
					void error
					return undefined
				}
			}),
		)
		const complete = trackPrivateBundleReceiptStatuses(pending, receipts, targetBlockNumber, (transaction, status, receipt) => {
			track(trackedActivity(transaction, status, receipt === undefined ? undefined : decimalWeth(receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n)), receipt?.transactionHash))
		})
		if (!complete) {
			throw new Error(`Atomic bundle was not completely successful in target block ${targetBlockNumber.toString()}`)
		}
		const confirmedReceipts = receipts.filter(receipt => receipt !== undefined)
		actualGasCost = confirmedReceipts.reduce((total, receipt) => total + receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n), 0n)
		const executorReceipt = confirmedReceipts.at(-1)
		if (executorReceipt === undefined) throw new Error('Executor receipt is missing from the bundle')
		receiptBlockNumber = executorReceipt.blockNumber
		executionHash = executorReceipt.transactionHash
		const trackedNetProfitEth = decimalSignedEth(calculateTrackedNetProfitEth(refreshedQuote.profitBeforeGasWeth, actualGasCost))
		for (const [index, transaction] of pending.entries()) {
			const receipt = confirmedReceipts[index]
			if (receipt === undefined) throw new Error('Bundle receipt order is incomplete')
			track(trackedActivity(transaction, 'confirmed', decimalWeth(receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n)), receipt.transactionHash, transaction.kind === 'dispute' ? trackedNetProfitEth : undefined))
		}
	}
	console.log(`report=${report.helper.reportId.toString()} dispute=${executionHash}`)
	const trackedNetProfitEth = decimalSignedEth(calculateTrackedNetProfitEth(refreshedQuote.profitBeforeGasWeth, actualGasCost))
	return {
		actualGasCostEth: decimalWeth(actualGasCost),
		blockNumber: receiptBlockNumber.toString(),
		direction: refreshedQuote.direction,
		estimatedNetProfitWeth: decimalWeth(estimatedNetProfit),
		estimatedProfitBeforeGasEth: decimalWeth(refreshedQuote.profitBeforeGasWeth),
		executedAt: new Date().toISOString(),
		pool: refreshedPool.address,
		poolFee: refreshedPool.fee,
		reportId,
		requiredToken: formatTokenAmount(contribution.token2, tokenMetadata.decimals),
		requiredWeth: decimalWeth(contribution.token1),
		token: game.token2,
		tokenSymbol: tokenMetadata.symbol,
		trackedNetProfitEth,
		transactionHash: executionHash,
	}
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
	tokenMetadata: { decimals: number; symbol: string },
	executionTokenIsAllowed: boolean,
	executionReady: boolean,
	recordDecision: (message: string, reason: string) => void,
): Promise<EvaluatedOpportunity | undefined> {
	const game = report.game
	if (game.token1.toLowerCase() !== config.network.weth.toLowerCase() || !pools.some(pool => pool.token.toLowerCase() === game.token2.toLowerCase())) {
		recordDecision('Skipped report', 'Token pair is not WETH plus a configured token with a usable pool')
		return
	}
	if (config.execute && !executionTokenIsAllowed) {
		recordDecision('Skipped report', 'Report token was observed permissionlessly and is not in the execution allowlist')
		return
	}
	const timeType = (game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) !== 0n
	const currentTime = timeType ? blockTimestamp : blockNumber
	if (currentTime < game.reportTimestamp + game.disputeDelay || currentTime >= game.reportTimestamp + game.settlementTime) {
		recordDecision('Skipped report', 'Report is outside its dispute window')
		return
	}
	const timeRemaining = game.reportTimestamp + game.settlementTime - currentTime
	const minimumRemaining = timeType ? config.minimumRemainingSeconds : config.minimumRemainingBlocks
	if (timeRemaining < minimumRemaining) {
		console.log(`report=${report.helper.reportId.toString()} skipped=insufficient-inclusion-window remaining=${timeRemaining.toString()}`)
		recordDecision('Skipped report', `Only ${timeRemaining.toString()} ${timeType ? 'seconds' : 'blocks'} remain`)
		return
	}
	let best: { pool: Pool; quote: ArbitrageQuote } | undefined
	for (const pool of pools) {
		if (pool.token.toLowerCase() !== game.token2.toLowerCase()) continue
		const deviation = pool.spotTick > pool.twapTick ? pool.spotTick - pool.twapTick : pool.twapTick - pool.spotTick
		if (deviation > config.maxSpotTwapTicks) continue
		const quote = await evaluate(client, config, report, pool, gasPrice)
		if (quote === undefined) continue
		if (best === undefined || quote.netProfitWeth > best.quote.netProfitWeth) best = { pool, quote }
	}
	if (best === undefined) {
		console.log(`report=${report.helper.reportId.toString()} skipped=no-trusted-liquid-pool`)
		recordDecision('Skipped report', 'No active pool passed quote and spot/TWAP checks')
		return
	}
	const newAmount1 = calculateNextAmount1(game)
	const replacementAmount2 = await quoteInput(client, config.network.quoter, config.network.weth, best.pool.token, newAmount1, best.pool.fee)
	const replacementTokenToSwap = deriveTokenToSwap(game, newAmount1, replacementAmount2)
	if (replacementTokenToSwap.toLowerCase() !== best.quote.tokenToSwap.toLowerCase()) {
		console.log(`report=${report.helper.reportId.toString()} skipped=replacement-ratio-direction-mismatch`)
		recordDecision('Skipped report', 'Replacement ratio selected a different swap direction')
		return
	}
	const contribution = calculateContribution(game, replacementTokenToSwap, game.token1, newAmount1, replacementAmount2)
	const tokenBalance = balances?.tokens.get(game.token2.toLowerCase())
	const hasRequiredInventory = balances === undefined || tokenBalance === undefined ? undefined : balances.weth >= contribution.token1 && tokenBalance >= contribution.token2
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
		estimatedNetProfitEth: decimalSignedEth(best.quote.netProfitWeth),
		estimatedNetProfitWeth: decimalSignedEth(best.quote.netProfitWeth),
		hasRequiredInventory,
		pool: best.pool.address,
		poolFee: best.pool.fee,
		reportId: report.helper.reportId.toString(),
		requiredToken: formatTokenAmount(contribution.token2, tokenMetadata.decimals),
		requiredWeth: decimalWeth(contribution.token1),
		token: game.token2,
		tokenSymbol: tokenMetadata.symbol,
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
	const config = await loadConfiguration()
	if (config.lookbackBlocks < 0n) throw new Error('lookback-blocks must be a non-negative integer')
	if (!Number.isSafeInteger(config.uiPort) || config.uiPort < 1 || config.uiPort > 65_535) throw new Error('ui-port must be an integer from 1 to 65535')
	if (config.ui && config.once) throw new Error('--ui cannot be combined with --once')
	if (config.execute && config.privateKey === undefined && !config.ui) throw new Error('--execute requires PRIVATE_KEY unless --ui is used to unlock the signer')
	if (config.execute) await ensureExecutionHistoryWritable(config.historyFile)
	const createClient = () =>
		createPublicClient({
			chain: config.network.chain,
			transport: http(config.connectivity.readRpcUrl),
		})
	const createWallet = () =>
		config.privateKey === undefined
			? undefined
			: createWalletClient({
					account: privateKeyToAccount(config.privateKey),
					chain: config.network.chain,
					transport: http(config.connectivity.readRpcUrl),
				})
	let client = createClient()
	let wallet = createWallet()
	if (config.execute && config.executor !== undefined) {
		const executorCode = await client.getCode({ address: config.executor })
		if (executorCode === undefined || executorCode === '0x') throw new Error(`Configured executor ${config.executor} has no contract code on ${config.network.name}`)
	}
	const state: OperatorState = {
		activeReportCount: 0,
		balances: undefined,
		blockNumber: undefined,
		blockTimestamp: undefined,
		executionHistory: await loadExecutionHistory(config.historyFile),
		endpointChecks: [...(await checkConnectivity(config.connectivity, config.network.chain.id)), ...(await checkSubmissionEndpoints(config.submission, config.network.chain.id))],
		gameCapital: { eth: '0', totalEthWeth: '0', weth: '0' },
		lastError: undefined,
		lastPollAt: undefined,
		opportunities: [],
		operationLog: [],
		paused: config.paused,
		status: 'syncing',
		tokenAddresses: config.tokenAddresses,
		tokenMarkets: [],
		priceHistory: await loadPriceHistory(config.priceHistoryFile),
		reportPaths: [],
		transactionActivity: [],
	}
	const fixedState: {
		execute: boolean
		executor: Address | undefined
		expectedChainId: number
		explorerUrl: string
		network: NetworkConfiguration['name']
		openOracle: Address
		queuedWallet: Address | null | undefined
		savedWallet: Address | undefined
		wallet: Address | undefined
	} = {
		execute: config.execute,
		executor: config.executor,
		expectedChainId: config.network.chain.id,
		explorerUrl: config.network.explorerUrl,
		network: config.network.name,
		openOracle: config.openOracle,
		queuedWallet: undefined,
		savedWallet: config.persistedPrivateKey === undefined ? undefined : privateKeyToAccount(config.persistedPrivateKey).address,
		wallet: wallet?.account.address,
	}
	let pendingStrategy: MutableStrategy | undefined
	let pendingSubmission: SubmissionSettings | undefined
	let pendingConnectivity: ConnectivitySettings | undefined
	let pendingPrivateKey: Hex | undefined
	let pendingTokenAddresses: Address[] | undefined
	let signerUpdatePending = false
	let cursor: SyncCursor | undefined
	const currentPersistedSettings = (): PersistedOperatorSettings => ({
		connectivity: pendingConnectivity ?? config.connectivity,
		paused: state.paused,
		privateKey: config.persistedPrivateKey,
		strategy: pendingStrategy ?? config,
		submission: pendingSubmission ?? config.submission,
		tokenAddresses: pendingTokenAddresses ?? config.tokenAddresses,
	})
	const persistSettings = (settings: PersistedOperatorSettings) => saveOperatorSettings(config.settingsFile, config.network.name, settings)
	let settingsUpdateQueue = Promise.resolve()
	const queueSettingsUpdate = <T>(update: () => Promise<T>) => {
		const result = settingsUpdateQueue.then(update)
		settingsUpdateQueue = result.then(
			() => undefined,
			() => undefined,
		)
		return result
	}
	const trackTransaction: TrackTransaction = activity => {
		state.transactionActivity = [activity, ...state.transactionActivity.filter(existing => existing.originalHash.toLowerCase() !== activity.originalHash.toLowerCase())].slice(0, 100)
		recordOperation(state, {
			category: 'transaction',
			details: activity.failedTargets.map(target => `${target.target}: ${target.error ?? 'failed'}`).join('; ') || undefined,
			level: transactionLogLevel(activity.status),
			message: `${activity.kind} ${activity.status}`,
			reason: `Transaction ${activity.hash}`,
			reportId: activity.reportId,
		})
	}
	const dashboard = config.ui
		? startDashboardServer(config.uiPort, {
				getSnapshot: () => operatorSnapshot(state, pendingStrategy ?? config, pendingSubmission ?? config.submission, pendingConnectivity ?? config.connectivity, fixedState),
				setPaused: paused =>
					queueSettingsUpdate(async () => {
						await persistSettings({ ...currentPersistedSettings(), paused })
						state.paused = paused
						state.status = operatorStatusAfterPause(paused, cursor?.initial === false, state.lastError !== undefined)
						recordOperation(state, { category: 'configuration', details: undefined, level: 'info', message: paused ? 'Operator paused' : 'Operator resumed', reason: 'Dashboard command saved for restart', reportId: undefined })
					}),
				updateConnectivity: async value => {
					const next = validateConnectivitySettings(value)
					await updateConnectivityEndpointChecks(state, () => checkConnectivity(next, config.network.chain.id))
					return queueSettingsUpdate(async () => {
						await persistSettings({ ...currentPersistedSettings(), connectivity: next })
						pendingConnectivity = next
						recordOperation(state, { category: 'configuration', details: next.publicRpcUrls.map(endpointLabel).join(', '), level: 'info', message: 'RPC configuration verified and saved', reason: `Read RPC ${endpointLabel(next.readRpcUrl)}`, reportId: undefined })
						return next
					})
				},
				updateSigner: async value => {
					const signerRecord = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined
					if (signerRecord !== undefined && Object.keys(signerRecord).length === 1 && signerRecord['forgetSavedSigner'] === true) {
						return queueSettingsUpdate(async () => {
							await persistSettings({ ...currentPersistedSettings(), privateKey: undefined })
							config.persistedPrivateKey = undefined
							fixedState.savedWallet = undefined
							recordOperation(state, {
								category: 'configuration',
								details: undefined,
								level: 'info',
								message: 'Saved signer forgotten',
								reason: 'Active in-memory signer unchanged',
								reportId: undefined,
							})
							return { wallet: fixedState.wallet }
						})
					}
					if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 2 || !('privateKey' in value) || !('rememberSigner' in value) || typeof value['rememberSigner'] !== 'boolean') {
						throw new Error('Signer request requires privateKey and rememberSigner, or forgetSavedSigner')
					}
					const candidate = signerCandidate(value['privateKey'])
					const rememberSigner = candidate.privateKey !== undefined && value['rememberSigner']
					return queueSettingsUpdate(async () => {
						let persistedPrivateKey = config.persistedPrivateKey
						if (candidate.privateKey === undefined) persistedPrivateKey = undefined
						else if (rememberSigner) persistedPrivateKey = candidate.privateKey
						await persistSettings({ ...currentPersistedSettings(), privateKey: persistedPrivateKey })
						config.persistedPrivateKey = persistedPrivateKey
						pendingPrivateKey = candidate.privateKey
						signerUpdatePending = true
						const address = candidate.address
						fixedState.queuedWallet = address ?? null
						fixedState.savedWallet = persistedPrivateKey === undefined ? undefined : privateKeyToAccount(persistedPrivateKey).address
						recordOperation(state, {
							category: 'configuration',
							details: undefined,
							level: 'info',
							message: address === undefined ? 'Signer clear queued and saved' : `Signer ${address} queued${rememberSigner ? ' and remembered' : ''}`,
							reason: 'Applied at the next scan boundary',
							reportId: undefined,
						})
						return { wallet: address }
					})
				},
				updateSubmission: async value => {
					const next = validateSubmissionSettings(value)
					await updateSubmissionEndpointChecks(state, () => checkSubmissionEndpoints(next, config.network.chain.id))
					return queueSettingsUpdate(async () => {
						await persistSettings({ ...currentPersistedSettings(), submission: next })
						pendingSubmission = next
						recordOperation(state, { category: 'configuration', details: next.relayUrls.join(', ') || undefined, level: 'info', message: `Submission mode ${next.mode} verified and saved`, reason: 'Applied at the next scan boundary', reportId: undefined })
						return pendingSubmission
					})
				},
				updateTokens: value => {
					if (!Array.isArray(value) || value.some(address => typeof address !== 'string')) throw new Error('Token configuration must be an array of addresses')
					const parsedAddresses: Address[] = [config.network.rep]
					for (const address of value) {
						if (typeof address !== 'string') throw new Error('Token configuration must be an array of addresses')
						parsedAddresses.push(getAddress(address))
					}
					const next = [...new Map(parsedAddresses.map(address => [address.toLowerCase(), address])).values()]
					return queueSettingsUpdate(async () => {
						await persistSettings({ ...currentPersistedSettings(), tokenAddresses: next })
						pendingTokenAddresses = next
						recordOperation(state, {
							category: 'configuration',
							details: next.join(', '),
							level: 'info',
							message: 'Execution token allowlist saved and queued',
							reason: 'Explicitly configured tokens become executable at the next block scan',
							reportId: undefined,
						})
						return next
					})
				},
				updateStrategy: async value => {
					const next = mutableStrategy(pendingStrategy ?? config)
					updateStrategyFromRequest(next, value)
					return queueSettingsUpdate(async () => {
						await persistSettings({ ...currentPersistedSettings(), strategy: next })
						pendingStrategy = next
						recordOperation(state, { category: 'configuration', details: undefined, level: 'info', message: 'Strategy update saved and queued', reason: 'Applied at the next scan boundary', reportId: undefined })
						return strategySettings(next)
					})
				},
			})
		: undefined
	const reports = new Map<bigint, ActiveReport>()
	const pendingHistory: ExecutionRecord[] = []
	let cachedLogs: TransactionLog[] = []
	const catalogForScan = createTokenCatalogTracker((configured, observed) => discoverAugurRepTokens(client, config.network.chain.id, configured, observed))
	recordOperation(state, { category: 'scan', details: undefined, level: 'info', message: 'Operator started', reason: `${config.network.name} chain ${config.network.chain.id.toString()}`, reportId: undefined })
	console.log(`network=${config.network.name} chain=${config.network.chain.id.toString()} mode=${config.execute ? 'execute' : 'dry-run'} submission=${config.submission.mode} oracle=${config.openOracle} rpc=${endpointLabel(config.connectivity.readRpcUrl)}`)
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
				if (pendingSubmission !== undefined) {
					config.submission = pendingSubmission
					pendingSubmission = undefined
				}
				if (pendingTokenAddresses !== undefined) {
					config.tokenAddresses = pendingTokenAddresses
					state.tokenAddresses = pendingTokenAddresses
					pendingTokenAddresses = undefined
				}
				if (pendingConnectivity !== undefined) {
					config.connectivity = pendingConnectivity
					pendingConnectivity = undefined
					client = createClient()
					wallet = createWallet()
				}
				if (signerUpdatePending) {
					config.privateKey = pendingPrivateKey
					wallet = createWallet()
					fixedState.wallet = wallet?.account.address
					fixedState.queuedWallet = undefined
					clearWalletDerivedState(state)
					signerUpdatePending = false
				}
				let nextError: string | undefined
				if (pendingHistory.length !== 0) {
					try {
						await flushExecutionHistory(pendingHistory, record => appendExecutionHistory(config.historyFile, record))
					} catch (error) {
						const message = `Confirmed dispute history is not durable: ${errorMessage(error)}`
						nextError = message
						console.error(`historyPersistenceFailed=${message}`)
					}
				}
				const executionReady = pendingHistory.length === 0
				const observedChainId = await client.getChainId()
				if (observedChainId !== config.network.chain.id) throw new Error(`Read RPC chain mismatch: expected ${config.network.chain.id.toString()}, received ${observedChainId.toString()}`)
				const block = await client.getBlock()
				const blockNumber = block.number
				if (blockNumber === undefined) throw new Error('Latest block is missing its number')
				const blockHash = block.hash
				if (blockHash === undefined) throw new Error('Latest block is missing its hash')
				cursor ??= initialCursor(blockNumber, config.lookbackBlocks)
				const scanCursor = cursorForHeadScan(cursor, blockNumber, blockHash, REORG_OVERLAP_BLOCKS)
				if (scanCursor === undefined) {
					state.lastError = nextError
					state.status = operatorStatusAfterPause(state.paused, true, nextError !== undefined)
					state.blockNumber = blockNumber.toString()
					state.blockTimestamp = block.timestamp.toString()
					return config.once
				}
				const ranges = scanRanges(scanCursor, blockNumber)
				for (const range of ranges) {
					const logs = await client.getLogs({
						address: config.openOracle,
						fromBlock: range.fromBlock,
						toBlock: range.toBlock,
						topics: [[OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC]],
					})
					cachedLogs = replaceOverlap(cachedLogs, logs, range.fromBlock, logBlockNumber, compareLogs)
				}
				reports.clear()
				applyLogs(reports, cachedLogs)
				let completedOpportunityCount = 0
				cursor = await advanceCursorAfterSuccessfulHead(blockNumber, blockHash, async () => {
					const observedTokens = [...reports.values()].flatMap(report => [report.latest.game.token1, report.latest.game.token2]).filter(address => address !== zeroAddress && address.toLowerCase() !== config.network.weth.toLowerCase())
					const { executionTokens, monitoringTokens: discoveredTokens } = await catalogForScan(config.tokenAddresses, observedTokens)
					state.tokenMarkets = await loadTokenMarkets(client, {
						chainId: config.network.chain.id,
						explorerUrl: config.network.explorerUrl,
						factory: config.network.factory,
						tokens: discoveredTokens,
						weth: config.network.weth,
						wallet: wallet?.account.address,
					})
					const sampledAt = new Date(Number(block.timestamp) * 1_000).toISOString()
					const samples = missingPricePoints(state.priceHistory, pricePoints(state.tokenMarkets, blockNumber, sampledAt))
					await appendPriceHistory(config.priceHistoryFile, samples)
					state.priceHistory = [...state.priceHistory, ...samples]
					const pools = (await Promise.all(discoveredTokens.map(token => poolsForToken(client, config, token)))).flat()
					if (pools.length === 0) console.log('status=no-liquid-rep-weth-v3-pool')
					const balances = await loadBalances(client, wallet, config, pools, discoveredTokens)
					const gasPrice = (block.baseFeePerGas ?? 0n) * 2n + 2n * 10n ** 9n
					const opportunities: OpportunitySnapshot[] = []
					const candidates: ExecutionCandidate[] = []
					for (const report of reports.values()) {
						if (report.settled) continue
						try {
							const reportId = report.latest.helper.reportId.toString()
							const metadata = state.tokenMarkets.find(market => market.address.toLowerCase() === report.latest.game.token2.toLowerCase())
							if (metadata === undefined) throw new Error('Token metadata is unavailable')
							const evaluated = await inspectReport(client, wallet, config, report.latest, pools, blockNumber, block.timestamp, gasPrice, balances?.raw, metadata, executionTokenAllowed(executionTokens, report.latest.game.token2), executionReady, (message, reason) =>
								recordOperation(state, { category: 'decision', details: undefined, level: 'info', message, reason, reportId }),
							)
							if (evaluated !== undefined) {
								opportunities.push(evaluated.opportunity)
								recordOperation(state, {
									category: 'decision',
									details: `direction=${evaluated.opportunity.direction} estimatedProfitEth=${evaluated.opportunity.estimatedNetProfitEth}`,
									level: evaluated.opportunity.decision === 'execution-failed' ? 'error' : 'info',
									message: `Decision: ${evaluated.opportunity.decision}`,
									reason: `Profit and inventory gates evaluated for report ${evaluated.opportunity.reportId}`,
									reportId: evaluated.opportunity.reportId,
								})
								if (evaluated.candidate !== undefined) candidates.push(evaluated.candidate)
							}
						} catch (error) {
							const reportId = report.latest.helper.reportId.toString()
							const message = errorMessage(error)
							console.error(`report=${reportId} skipped=${message}`)
							recordOperation(state, { category: 'decision', details: undefined, level: 'warning', message: 'Report evaluation failed', reason: message, reportId })
						}
					}
					state.activeReportCount = [...reports.values()].filter(report => !report.settled).length
					state.reportPaths = [...reports.entries()].map(([id, report]) => ({ reportId: id.toString(), settled: report.settled, steps: report.steps }))
					state.balances = balances?.snapshot
					state.blockNumber = blockNumber.toString()
					state.blockTimestamp = block.timestamp.toString()
					state.gameCapital = gameCapitalSnapshot(
						[...reports.values()].filter(report => !report.settled).map(report => report.latest.game),
						config.network.weth,
					)
					state.lastPollAt = new Date().toISOString()
					state.opportunities = opportunities
					const selected = selectBestExecution(candidates, candidate => candidate.quote.netProfitWeth)
					if (selected !== undefined && wallet !== undefined) {
						selected.opportunity.decision = 'selected'
						try {
							const metadata = state.tokenMarkets.find(market => market.address.toLowerCase() === selected.report.game.token2.toLowerCase())
							if (metadata === undefined) throw new Error('Token metadata is unavailable')
							const record = await executeDispute(client, wallet, config, selected.report, selected.quote, selected.pool, metadata, () => state.paused, trackTransaction)
							selected.opportunity.decision = 'submitted'
							recordConfirmedExecution(state.executionHistory, pendingHistory, record)
							try {
								await flushExecutionHistory(pendingHistory, pending => appendExecutionHistory(config.historyFile, pending))
							} catch (error) {
								const message = `Confirmed dispute ${record.transactionHash} is visible but history persistence failed: ${errorMessage(error)}`
								nextError = message
								console.error(`historyPersistenceFailed=${message}`)
							}
						} catch (error) {
							const message = errorMessage(error)
							selected.opportunity.decision = executionFailureDecision(error)
							if (selected.opportunity.decision === 'execution-failed') {
								nextError = `Report ${selected.report.helper.reportId.toString()} execution failed: ${message}`
							}
							console.error(`report=${selected.report.helper.reportId.toString()} executionFailed=${message}`)
						}
					}
					state.priceHistory = state.priceHistory.slice(-2_000)
					completedOpportunityCount = opportunities.length
				})
				state.lastError = nextError
				state.status = operatorStatusAfterPause(state.paused, true, nextError !== undefined)
				recordOperation(state, { category: 'scan', details: `${state.activeReportCount.toString()} active reports; ${completedOpportunityCount.toString()} opportunities`, level: nextError === undefined ? 'info' : 'warning', message: 'Scan completed', reason: `Block ${blockNumber.toString()}`, reportId: undefined })
				return config.once
			},
			() => Bun.sleep(config.pollMilliseconds),
			config.once,
			error => {
				const message = errorMessage(error)
				state.lastError = message
				state.status = 'error'
				recordOperation(state, { category: 'scan', details: undefined, level: 'error', message: 'Scan failed', reason: message, reportId: undefined })
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

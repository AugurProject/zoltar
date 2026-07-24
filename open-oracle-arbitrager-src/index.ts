#!/usr/bin/env bun

import { resolve } from 'node:path'
import { createPublicClient, createWalletClient, encodeFunctionData, formatEther, getAddress, http, privateKeyToAccount, type Account, type Address, type Chain, type Hex, type PublicClient, type TransactionLog, type Transport, type WalletClient, zeroAddress } from '@zoltar/shared/ethereum'
import { decodeOpenOracleStatePreimage, getOpenOracleGameTuple, getOpenOracleHelperTuple, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC, OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import { erc20Abi, factoryAbi, openOracleAbi, poolAbi, quoterAbi } from './abi.js'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, sendRawTransactionToRpc, updateConnectivityEndpointChecks, updateSubmissionEndpointChecks, validateConnectivitySettings, type ConnectivitySettings } from './connectivity.js'
import { startDashboardServer } from './dashboard-server.js'
import {
	attemptConfirmationRecovery,
	executionFailureDecision,
	flushExecutionHistory,
	guardedTransactionSubmission,
	isExecutionPausedError,
	opportunityDecision,
	recordConfirmedExecution,
	retryPrivateSubmissionWithinWindow,
	runFundedExecution,
	selectBestExecution,
	signAndSubmitOpenOracleDispute,
	waitForResolvedTransaction,
} from './execution-orchestration.js'
import {
	appendExecutionHistory,
	clearWalletDerivedState,
	decimalSignedEth,
	decimalWeth,
	ensureExecutionHistoryWritable,
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
} from './operator-state.js'
import { defaultRpcUrl, networkConfiguration, parseNetworkName, type NetworkConfiguration } from './network.js'
import { bestSuccessful, pollUntilStopped, replaceOverlap } from './resilience.js'
import { loadOperatorSettings, saveOperatorSettings, type PersistedOperatorSettings } from './settings-store.js'
import { signerCandidate } from './signer.js'
import { calculateContribution, calculateFee, calculateNextAmount1, calculateTrackedNetProfitEth, deriveTokenToSwap, evaluateBuyRep, evaluateSellRep, hasFreshSubmissionWindow, isSelfReport, meetsProfitThreshold, type ArbitrageQuote } from './strategy.js'
import { assertSubmissionWindowOpen, mergeSubmissionFailures, prepareSignedTransaction, SubmissionFailure, submitSignedTransaction, validateSubmissionSettings, type SignedTransaction, type SubmissionSettings, type SubmittedTransaction, type SubmissionTargetResult } from './transaction-submission.js'

const FEES = [100, 500, 3000, 10000] as const
const REORG_OVERLAP_BLOCKS = 12n

type Configuration = MutableStrategy & {
	execute: boolean
	historyFile: string
	lookbackBlocks: bigint
	network: NetworkConfiguration
	once: boolean
	openOracle: Address
	paused: boolean
	persistedPrivateKey: Hex | undefined
	privateKey: Hex | undefined
	settingsFile: string
	connectivity: ConnectivitySettings
	submission: SubmissionSettings
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
  --execute                      Submit guarded disputes (key from env or local UI)
  --submission-mode=public      Submit to public mempool (public) or private relays (private)
  --relay-url=https://...        Private relay URL; repeat for multiple relays

Strategy:
  --minimum-profit-weth=0.01     Absolute modeled net-profit floor
  --minimum-profit-bps=100       Modeled return floor relative to hedge cost
  --max-spot-twap-ticks=100      Maximum accepted Uniswap tick deviation
  --twap-seconds=1800            Uniswap TWAP window
  --minimum-remaining-blocks=3   Inclusion buffer for block-based games
  --minimum-remaining-seconds=36 Inclusion buffer for timestamp-based games
  --poll-ms=12000                Continuous scan interval

Data and connectivity:
  --network=mainnet|sepolia      Expected network; defaults to mainnet
  --rpc-url=https://...          Read RPC (or ETH_RPC_URL)
  --public-rpc-url=https://...   Public submission RPC; repeat to fan out
  --rep-address=0x...            REP address; required on Sepolia
  --weth-address=0x...           Override the network WETH address
  --uniswap-factory=0x...        Override the Uniswap V3 factory
  --uniswap-quoter=0x...         Override the Uniswap V3 quoter
  --lookback-blocks=50000        Initial event search range
  --ui-port=4173                 Local dashboard port
  --history-file=PATH            Confirmed-submission JSONL path
  --settings-file=PATH           Persistent dashboard settings JSON path

Execution is off by default. See open-oracle-arbitrager-src/README.md.`)
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
			pollMilliseconds: 12_000,
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
	return {
		...strategy,
		execute: process.argv.includes('--execute'),
		historyFile: resolve(option('history-file') ?? `.open-oracle-arbitrager/history-${networkName}.jsonl`),
		lookbackBlocks: BigInt(option('lookback-blocks') ?? '50000'),
		network,
		once: process.argv.includes('--once'),
		openOracle: requiredAddress('open-oracle'),
		paused: saved?.paused ?? false,
		persistedPrivateKey: saved?.privateKey,
		privateKey,
		settingsFile,
		connectivity: validateConnectivitySettings({
			publicRpcUrls: publicRpcUrls.length === 0 ? (saved?.connectivity.publicRpcUrls ?? [readRpcUrl]) : publicRpcUrls,
			readRpcUrl,
		}),
		submission: validateSubmissionSettings({
			mode: option('submission-mode') ?? saved?.submission.mode ?? 'public',
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

async function poolsFor(client: ReadClient, config: Configuration) {
	const pools: Pool[] = []
	for (const fee of FEES) {
		try {
			const address = await client.readContract({
				address: config.network.factory,
				abi: factoryAbi,
				functionName: 'getPool',
				args: [config.network.weth, config.network.rep, fee],
			})
			if (address === zeroAddress) continue
			const pool = await loadPool(client, address, fee, config.twapSeconds)
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
		[
			async () => evaluateSellRep(game, await quoteInput(client, config.network.quoter, config.network.rep, config.network.weth, game.currentAmount2, pool.fee), gasCost),
			async () => evaluateBuyRep(game, await quoteOutput(client, config.network.quoter, config.network.weth, config.network.rep, repWithFees, pool.fee), gasCost),
		],
		candidate => candidate.netProfitWeth,
		error => console.error(`pool=${pool.address} quoteSkipped=${errorMessage(error)}`),
	)
}

async function loadBalances(client: ReadClient, wallet: WriteClient | undefined, config: Configuration, pools: readonly Pool[]) {
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
	const raw = { eth, rep, weth }
	let repValueWeth: bigint | undefined
	if (rep === 0n) repValueWeth = 0n
	else {
		const best = await bestSuccessful(
			pools.map(pool => () => quoteInput(client, config.network.quoter, config.network.rep, config.network.weth, rep, pool.fee)),
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
	}

async function signContractTransaction(client: ReadClient, wallet: WriteClient, chainId: number, to: Address, data: Hex, estimateGas: () => Promise<bigint>, lastValidBlockNumber: bigint | undefined = undefined): Promise<SignedTransaction> {
	const account = wallet.account
	if (account === undefined || account.signTransaction === undefined) throw new Error('Execution requires a local transaction signer')
	const [block, gasEstimate, nonce] = await Promise.all([client.getBlock(), estimateGas(), client.getTransactionCount({ address: account.address, blockTag: 'pending' })])
	if (block.number === undefined) throw new Error('Cannot sign a transaction without the latest block number')
	return prepareSignedTransaction({
		baseFeePerGas: block.baseFeePerGas ?? 0n,
		blockNumber: block.number,
		chainId,
		data,
		from: account.address,
		gasEstimate,
		lastValidBlockNumber,
		nonce,
		signTransaction: account.signTransaction,
		to,
	})
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
		trackedNetProfitEth,
		updatedAt: new Date().toISOString(),
	}
}

async function submitContractTransaction(client: ReadClient, wallet: WriteClient, config: Configuration, signed: SignedTransaction, details: { estimatedNetProfitEth: string | undefined; kind: TransactionActivity['kind']; reportId: string }, isPaused: () => boolean, track: TrackTransaction): Promise<TrackedSubmission> {
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

async function approveAndWait(client: ReadClient, wallet: WriteClient, config: Configuration, token: Address, spender: Address, amount: bigint, reportId: string, isPaused: () => boolean, track: TrackTransaction) {
	if (amount === 0n) return 0n
	const request = {
		address: token,
		abi: erc20Abi,
		functionName: 'approve',
		args: [spender, amount],
	} as const
	const data = encodeFunctionData(request)
	const signed = await signContractTransaction(client, wallet, config.network.chain.id, token, data, () => client.estimateContractGas({ ...request, account: wallet.account }))
	const kind = token.toLowerCase() === config.network.weth.toLowerCase() ? 'approval-weth' : 'approval-rep'
	const submission = await submitContractTransaction(client, wallet, config, signed, { estimatedNetProfitEth: undefined, kind, reportId }, isPaused, track)
	const { receipt } = await waitForTrackedTransaction(client, wallet, config, submission, track)
	if (receipt.status !== 'success') throw new Error(`Approval transaction reverted: ${receipt.transactionHash}`)
	return receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n)
}

async function executeDispute(client: ReadClient, wallet: WriteClient, config: Configuration, report: OpenOracleStatePreimage, quote: ArbitrageQuote, pool: Pool, isPaused: () => boolean, track: TrackTransaction): Promise<ExecutionRecord> {
	const account = wallet.account
	if (account === undefined) throw new Error('Execution requires a local account')
	const game = report.game
	if (isSelfReport(account.address, game.currentReporter)) throw new Error('Self-disputes use different OpenOracle accounting and are not supported')
	const newAmount1 = calculateNextAmount1(game)
	const preparedAmount2 = await quoteInput(client, config.network.quoter, config.network.weth, config.network.rep, newAmount1, pool.fee)
	const preparedTokenToSwap = deriveTokenToSwap(game, newAmount1, preparedAmount2)
	if (preparedTokenToSwap.toLowerCase() !== quote.tokenToSwap.toLowerCase()) throw new Error('Replacement ratio does not derive the selected arbitrage direction')
	const preparedContribution = calculateContribution(game, preparedTokenToSwap, game.token1, newAmount1, preparedAmount2)
	const reportId = report.helper.reportId.toString()
	return runFundedExecution(isPaused, {
		approveToken1: () => approveAndWait(client, wallet, config, game.token1, config.openOracle, preparedContribution.token1, reportId, isPaused, track),
		approveToken2: () => approveAndWait(client, wallet, config, game.token2, config.openOracle, preparedContribution.token2, reportId, isPaused, track),
		prepare: async () => {
			const quoteBlock = await client.getBlock()
			if (quoteBlock.number === undefined) throw new Error('Quote block is missing its number')
			const refreshedPool = await loadPool(client, pool.address, pool.fee, config.twapSeconds)
			if (refreshedPool === undefined) throw new Error('Selected pool lost all active liquidity while approvals were mined')
			const deviation = refreshedPool.spotTick > refreshedPool.twapTick ? refreshedPool.spotTick - refreshedPool.twapTick : refreshedPool.twapTick - refreshedPool.spotTick
			if (deviation > config.maxSpotTwapTicks) throw new Error('Selected pool failed the spot/TWAP check after approvals')
			const gasPrice = (quoteBlock.baseFeePerGas ?? 0n) * 2n + 2n * 10n ** 9n
			const refreshedQuote = await evaluate(client, config, report, refreshedPool, gasPrice)
			if (refreshedQuote === undefined) throw new Error('Selected pool no longer serves either arbitrage direction')
			if (refreshedQuote.direction !== quote.direction) throw new Error('Best arbitrage direction changed while approvals were mined')
			if (!meetsProfitThreshold(refreshedQuote, config.minimumProfitWeth, config.minimumProfitBps)) throw new Error('Arbitrage no longer meets the profit threshold after approvals')
			const newAmount2 = await quoteInput(client, config.network.quoter, config.network.weth, config.network.rep, newAmount1, refreshedPool.fee)
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
			return { contribution, quoteBlockNumber: quoteBlock.number, refreshedPool, refreshedQuote, request }
		},
		simulate: prepared => wallet.simulateContract(prepared.request),
		submit: async prepared => {
			const data = encodeFunctionData(prepared.request)
			return signAndSubmitOpenOracleDispute(
				prepared.quoteBlockNumber,
				lastValidBlockNumber => signContractTransaction(client, wallet, config.network.chain.id, prepared.request.address, data, () => client.estimateContractGas({ ...prepared.request, account }), lastValidBlockNumber),
				signed => submitContractTransaction(client, wallet, config, signed, { estimatedNetProfitEth: decimalWeth(prepared.refreshedQuote.netProfitWeth), kind: 'dispute', reportId }, isPaused, track),
			)
		},
		confirm: async (submission, prepared, approvalGasCost) => {
			const { receipt, tracked } = await waitForTrackedTransaction(client, wallet, config, submission, track)
			if (receipt.status !== 'success') throw new Error(`Dispute transaction reverted: ${receipt.transactionHash}`)
			console.log(`report=${report.helper.reportId.toString()} dispute=${receipt.transactionHash}`)
			const actualGasCost = approvalGasCost + receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n)
			const trackedNetProfitEth = decimalSignedEth(calculateTrackedNetProfitEth(prepared.refreshedQuote.profitBeforeGasWeth, actualGasCost))
			track(trackedActivity(tracked, 'confirmed', decimalWeth(actualGasCost), receipt.transactionHash, trackedNetProfitEth))
			return {
				actualGasCostEth: decimalWeth(actualGasCost),
				blockNumber: receipt.blockNumber.toString(),
				direction: prepared.refreshedQuote.direction,
				estimatedNetProfitWeth: decimalWeth(prepared.refreshedQuote.netProfitWeth),
				estimatedProfitBeforeGasEth: decimalWeth(prepared.refreshedQuote.profitBeforeGasWeth),
				executedAt: new Date().toISOString(),
				pool: prepared.refreshedPool.address,
				poolFee: prepared.refreshedPool.fee,
				reportId: report.helper.reportId.toString(),
				requiredRep: decimalWeth(prepared.contribution.token2),
				requiredWeth: decimalWeth(prepared.contribution.token1),
				trackedNetProfitEth,
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
	recordDecision: (message: string, reason: string) => void,
): Promise<EvaluatedOpportunity | undefined> {
	const game = report.game
	if (game.token1.toLowerCase() !== config.network.weth.toLowerCase() || game.token2.toLowerCase() !== config.network.rep.toLowerCase()) {
		recordDecision('Skipped report', 'Token pair is not the configured WETH/REP identity')
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
	const replacementAmount2 = await quoteInput(client, config.network.quoter, config.network.weth, config.network.rep, newAmount1, best.pool.fee)
	const replacementTokenToSwap = deriveTokenToSwap(game, newAmount1, replacementAmount2)
	if (replacementTokenToSwap.toLowerCase() !== best.quote.tokenToSwap.toLowerCase()) {
		console.log(`report=${report.helper.reportId.toString()} skipped=replacement-ratio-direction-mismatch`)
		recordDecision('Skipped report', 'Replacement ratio selected a different swap direction')
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
		estimatedNetProfitEth: decimalWeth(best.quote.netProfitWeth),
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
	const state: OperatorState = {
		activeReportCount: 0,
		balances: undefined,
		blockNumber: undefined,
		executionHistory: await loadExecutionHistory(config.historyFile),
		endpointChecks: [...(await checkConnectivity(config.connectivity, config.network.chain.id)), ...(await checkSubmissionEndpoints(config.submission, config.network.chain.id))],
		lastError: undefined,
		lastPollAt: undefined,
		opportunities: [],
		operationLog: [],
		paused: config.paused,
		status: 'starting',
		transactionActivity: [],
	}
	const fixedState: {
		execute: boolean
		expectedChainId: number
		explorerUrl: string
		network: NetworkConfiguration['name']
		openOracle: Address
		queuedWallet: Address | null | undefined
		savedWallet: Address | undefined
		wallet: Address | undefined
	} = {
		execute: config.execute,
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
	let signerUpdatePending = false
	const currentPersistedSettings = (): PersistedOperatorSettings => ({
		connectivity: pendingConnectivity ?? config.connectivity,
		paused: state.paused,
		privateKey: config.persistedPrivateKey,
		strategy: pendingStrategy ?? config,
		submission: pendingSubmission ?? config.submission,
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
						state.status = paused ? 'paused' : 'sleeping'
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
	let nextBlock: bigint | undefined
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
				state.status = 'scanning'
				state.lastError = undefined
				recordOperation(state, { category: 'scan', details: undefined, level: 'info', message: 'Scan started', reason: `Using ${config.network.name} RPC`, reportId: undefined })
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
				const observedChainId = await client.getChainId()
				if (observedChainId !== config.network.chain.id) throw new Error(`Read RPC chain mismatch: expected ${config.network.chain.id.toString()}, received ${observedChainId.toString()}`)
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
				const pools = await poolsFor(client, config)
				if (pools.length === 0) console.log('status=no-liquid-rep-weth-v3-pool')
				const balances = await loadBalances(client, wallet, config, pools)
				const gasPrice = (block.baseFeePerGas ?? 0n) * 2n + 2n * 10n ** 9n
				const opportunities: OpportunitySnapshot[] = []
				const candidates: ExecutionCandidate[] = []
				for (const report of reports.values()) {
					if (report.settled) continue
					try {
						const reportId = report.latest.helper.reportId.toString()
						const evaluated = await inspectReport(client, wallet, config, report.latest, pools, blockNumber, block.timestamp, gasPrice, balances?.raw, executionReady, (message, reason) => recordOperation(state, { category: 'decision', details: undefined, level: 'info', message, reason, reportId }))
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
				state.balances = balances?.snapshot
				state.blockNumber = blockNumber.toString()
				state.lastPollAt = new Date().toISOString()
				state.opportunities = opportunities
				const selected = selectBestExecution(candidates, candidate => candidate.quote.netProfitWeth)
				if (selected !== undefined && wallet !== undefined) {
					selected.opportunity.decision = 'selected'
					try {
						const record = await executeDispute(client, wallet, config, selected.report, selected.quote, selected.pool, () => state.paused, trackTransaction)
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
				recordOperation(state, { category: 'scan', details: `${state.activeReportCount.toString()} active reports; ${opportunities.length.toString()} opportunities`, level: state.lastError === undefined ? 'info' : 'warning', message: 'Scan completed', reason: `Block ${blockNumber.toString()}`, reportId: undefined })
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

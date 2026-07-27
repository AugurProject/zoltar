#!/usr/bin/env bun

import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
	createPublicClient,
	createWalletClient,
	decodeEventLog,
	encodeFunctionData,
	formatEther,
	getAddress,
	getBalanceAtBlock,
	getTransactionCountAtBlock,
	http,
	privateKeyToAccount,
	readContractAtBlock,
	type Account,
	type Address,
	type Chain,
	type Hex,
	type PublicClient,
	type TransactionLog,
	type Transport,
	type WalletClient,
	zeroAddress,
} from '@zoltar/shared/ethereum'
import {
	decodeOpenOracleStatePreimage,
	getOpenOracleGameTuple,
	getOpenOracleHelperTuple,
	hashOpenOracleStatePreimage,
	OPEN_ORACLE_FLAG_STORE_ALL,
	OPEN_ORACLE_FLAG_TIME_TYPE,
	OPEN_ORACLE_FLAG_TRACK_DISPUTES,
	OPEN_ORACLE_REPORT_DISPUTED_TOPIC,
	OPEN_ORACLE_REPORT_SETTLED_TOPIC,
	OPEN_ORACLE_REPORT_SUBMITTED_TOPIC,
	type OpenOracleStatePreimage,
} from '@zoltar/shared/openOracle'
import { erc20Abi, factoryAbi, openOracleAbi, openOracleArbitrageExecutorAbi, openOraclePriceCoordinatorAbi, poolAbi, quoterAbi } from './abi.js'
import { advanceCursorAfterSuccessfulHead, cursorForHeadScan, initialCursor, operatorStatusAfterPause, scanRanges, type SyncCursor } from './block-sync.js'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, sendRawTransactionToRpc, updateConnectivityEndpointChecks, updateSubmissionEndpointChecks, validateConnectivitySettings, validateReadRpcUrls, type ConnectivitySettings } from './connectivity.js'
import { startDashboardServer } from './dashboard-server.js'
import { authenticateDeploymentManifest, parseDeploymentManifest, type DeploymentManifest } from './deployment-auth.js'
import {
	attemptConfirmationRecovery,
	executionFailureDecision,
	executionTokenAllowed,
	flushExecutionHistory,
	fundingTransactionPlan,
	guardedTransactionSubmission,
	isExecutionPausedError,
	journaledSubmission,
	openOracleDisputeTiming,
	opportunityDecision,
	recordConfirmedExecution,
	retryPrivateSubmissionWithinWindow,
	selectBestExecution,
	simulateTrackedPrivateBundle,
	trackPrivateBundleReceiptStatuses,
	waitForResolvedTransaction,
} from './execution-orchestration.js'
import { coordinatorPolicySafetyMismatch, gamePolicyMismatch, retainedReportIds, type CoordinatorGamePolicy } from './game-policy.js'
import {
	appendExecutionHistory,
	clearWalletDerivedState,
	decimalSignedEth,
	decimalWeth,
	ensureExecutionHistoryWritable,
	gameCapitalSnapshot,
	loadExecutionHistory,
	operatorSnapshot,
	parseDecimalWeth,
	parseSignedDecimalEth,
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
import { exactWithdrawalMatches, expectedWithdrawalToken2, hedgedProfitBeforeGasWeth, realizedNetProfitWeth, recoveredHedgedProfitBeforeGasWeth } from './position-accounting.js'
import { acquireExecutionSignerLock, acquirePositionJournalLock, loadPositionJournal, savePositionJournal, type ExclusiveProcessLock, type PositionRecord } from './position-store.js'
import { quorumValue } from './read-quorum.js'
import { bestSuccessful, compactFinalityWindow, pollUntilStopped, replaceOverlap } from './resilience.js'
import { adjustedNetProfitWeth, DEFAULT_RISK_LIMITS, riskLimitMismatch, type RiskLimits } from './safety-controls.js'
import { loadOperatorSettings, saveOperatorSettings, type PersistedOperatorSettings } from './settings-store.js'
import { signerCandidate } from './signer.js'
import { calculateFee, calculateNextAmount1, calculateTrackedNetProfitEth, deriveTokenToSwap, evaluateBuyRep, evaluateSellRep, executorFunding, hasFreshSubmissionWindow, hedgeSlippageReserveWeth, hedgeWethLimit, isSelfReport, meetsProfitThreshold, type ArbitrageQuote } from './strategy.js'
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
const MAX_LOG_SCAN_RANGE = 100n
const MAX_UNTRUSTED_DRY_RUN_REPORTS = 256

type Configuration = MutableStrategy & {
	coordinatorAddresses: Address[]
	deploymentManifest: DeploymentManifest | undefined
	execute: boolean
	executor: Address | undefined
	historyFile: string
	maxHedgeSlippageBps: bigint
	priceHistoryFile: string
	positionFile: string
	quorumRpcUrls: string[]
	lookbackBlocks: bigint
	network: NetworkConfiguration
	once: boolean
	openOracle: Address
	paused: boolean
	persistedPrivateKey: Hex | undefined
	privateKey: Hex | undefined
	settingsFile: string
	tokenAddresses: Address[]
	router: Address | undefined
	riskLimits: RiskLimits
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
	capitalAtRiskWeth: bigint
	opportunity: OpportunitySnapshot
	pool: Pool
	projectedGasCostWeth: bigint
	quote: ArbitrageQuote
	report: OpenOracleStatePreimage
}

type EvaluatedOpportunity = {
	candidate: ExecutionCandidate | undefined
	opportunity: OpportunitySnapshot
}

type ReadClient = PublicClient<Transport, Chain>
type WriteClient = WalletClient<Transport, Chain, Account>

function requiredBigint(value: unknown, description: string) {
	if (typeof value !== 'bigint') throw new Error(`${description} is not an RPC bigint`)
	return value
}

function requiredTuple(value: unknown, minimumLength: number, description: string): readonly unknown[] {
	if (!Array.isArray(value) || value.length < minimumLength) throw new Error(`${description} is not a complete RPC tuple`)
	return value
}

function requiredBigintArray(value: unknown, description: string) {
	const values = requiredTuple(value, 1, description)
	return values.map((entry, index) => requiredBigint(entry, `${description}[${index.toString()}]`))
}

function requiredRpcAddress(value: unknown, description: string) {
	if (typeof value !== 'string') throw new Error(`${description} is not an RPC address`)
	try {
		return getAddress(value)
	} catch (error) {
		void error
		throw new Error(`${description} is not a valid RPC address`)
	}
}

function printHelp() {
	console.log(`OpenOracle arbitrager

Usage:
  ./open-oracle-arbitrager/run --open-oracle=0x... [options]

Modes:
  --once                         Scan once and exit
  --ui                           Serve the local dashboard on 127.0.0.1
  --execute                      Submit guarded disputes (key from env or local UI)
  --executor-address=0x...       Deployed atomic arbitrage executor; required with --execute
  --coordinator-address=0x...    Approved Zoltar price coordinator; repeat as needed
  --deployment-manifest=PATH     Reviewed address and runtime-code-hash manifest
  --uniswap-router=0x...         Authenticated Uniswap V3 SwapRouter; required with --execute
  --submission-mode=private      Atomic bundle delivery; the only live-execution mode
  --relay-url=https://...        Bundle relay URL; repeat for multiple relays

Strategy:
  --minimum-profit-weth=0.01     Absolute modeled net-profit floor
  --minimum-profit-bps=100       Modeled return floor relative to hedge cost
  --max-spot-twap-ticks=100      Maximum accepted Uniswap tick deviation
  --twap-seconds=1800            Uniswap TWAP window
  --minimum-remaining-blocks=3   Inclusion buffer for block-based games
  --minimum-remaining-seconds=36 Inclusion buffer for timestamp-based games
  --max-hedge-slippage-bps=50    Maximum atomic hedge slippage
  --lifecycle-gas-reserve-weth=.01 Minimum settlement/withdrawal gas reserve
  --max-daily-gas-weth=.05       Daily entry and lifecycle gas-loss limit
  --max-position-weth=5          Maximum WETH-equivalent position notional
  --max-total-locked-weth=10     Maximum WETH-equivalent locked capital
  --poll-ms=1000                 Latest-head polling interval

Data and connectivity:
  --network=mainnet|sepolia      Expected network; defaults to mainnet
  --rpc-url=https://...          Read RPC (or ETH_RPC_URL)
  --quorum-rpc-url=https://...   Independent read RPC; repeat, at least one required for execution
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
  --position-file=PATH           Durable open-position recovery journal
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
	const quorumEnvironment =
		process.env['OPEN_ORACLE_QUORUM_RPC_URLS']
			?.split(',')
			.map(value => value.trim())
			.filter(Boolean) ?? []
	const quorumRpcUrls = validateReadRpcUrls([...quorumEnvironment, ...options('quorum-rpc-url')]).filter(url => url !== readRpcUrl)
	const publicRpcUrls = options('public-rpc-url')
	const relayUrls = options('relay-url')
	const privateKey = (privateKeyValue as Hex | undefined) ?? saved?.privateKey
	const execute = process.argv.includes('--execute')
	const executorValue = option('executor-address') ?? process.env['OPEN_ORACLE_EXECUTOR_ADDRESS']
	if (execute && executorValue === undefined) throw new Error('--execute requires --executor-address=0x... (or OPEN_ORACLE_EXECUTOR_ADDRESS)')
	const routerValue = option('uniswap-router') ?? process.env['UNISWAP_ROUTER_ADDRESS']
	if (execute && routerValue === undefined) throw new Error('--execute requires --uniswap-router=0x... (or UNISWAP_ROUTER_ADDRESS)')
	if (execute && quorumRpcUrls.length === 0) throw new Error('--execute requires at least one independent --quorum-rpc-url=https://... (or OPEN_ORACLE_QUORUM_RPC_URLS)')
	const coordinatorEnvironment =
		process.env['OPEN_ORACLE_COORDINATOR_ADDRESSES']
			?.split(',')
			.map(value => value.trim())
			.filter(Boolean) ?? []
	const coordinatorAddresses = [...new Map([...coordinatorEnvironment, ...options('coordinator-address')].map(value => getAddress(value)).map(address => [address.toLowerCase(), address])).values()]
	if (execute && coordinatorAddresses.length === 0) throw new Error('--execute requires at least one --coordinator-address=0x... (or OPEN_ORACLE_COORDINATOR_ADDRESSES)')
	const deploymentManifestPath = option('deployment-manifest') ?? process.env['OPEN_ORACLE_DEPLOYMENT_MANIFEST']
	if (execute && deploymentManifestPath === undefined) throw new Error('--execute requires --deployment-manifest=PATH (or OPEN_ORACLE_DEPLOYMENT_MANIFEST)')
	let deploymentManifest: DeploymentManifest | undefined
	if (deploymentManifestPath !== undefined) {
		let value: unknown
		try {
			value = JSON.parse(await readFile(resolve(deploymentManifestPath), 'utf8'))
		} catch (error) {
			if (error instanceof SyntaxError) throw new Error(`Deployment manifest is not valid JSON: ${error.message}`)
			throw error
		}
		deploymentManifest = parseDeploymentManifest(value)
	}
	const maxHedgeSlippageBps = BigInt(option('max-hedge-slippage-bps') ?? '50')
	if (maxHedgeSlippageBps < 0n || maxHedgeSlippageBps > 1_000n) throw new Error('max-hedge-slippage-bps must be from 0 to 1000')
	const riskLimits = {
		lifecycleGasReserveWeth: parseDecimalWeth(option('lifecycle-gas-reserve-weth') ?? decimalWeth(DEFAULT_RISK_LIMITS.lifecycleGasReserveWeth)),
		maxConcurrentPositions: 1,
		maxDailyGasSpendWeth: parseDecimalWeth(option('max-daily-gas-weth') ?? decimalWeth(DEFAULT_RISK_LIMITS.maxDailyGasSpendWeth)),
		maxPositionNotionalWeth: parseDecimalWeth(option('max-position-weth') ?? decimalWeth(DEFAULT_RISK_LIMITS.maxPositionNotionalWeth)),
		maxTotalLockedWeth: parseDecimalWeth(option('max-total-locked-weth') ?? decimalWeth(DEFAULT_RISK_LIMITS.maxTotalLockedWeth)),
	} satisfies RiskLimits
	if (riskLimits.maxPositionNotionalWeth > riskLimits.maxTotalLockedWeth) throw new Error('max-position-weth cannot exceed max-total-locked-weth')
	const submission = validateSubmissionSettings({
		mode: option('submission-mode') ?? saved?.submission.mode ?? 'private',
		relayUrls: relayUrls.length === 0 ? (saved?.submission.relayUrls ?? ['https://relay.flashbots.net']) : relayUrls,
	})
	if (execute && submission.mode !== 'private') throw new Error('--execute requires private bundle submission; public mempool execution is disabled for fund safety')
	return {
		...strategy,
		coordinatorAddresses,
		deploymentManifest,
		execute,
		executor: executorValue === undefined ? undefined : getAddress(executorValue),
		historyFile: resolve(option('history-file') ?? `.open-oracle-arbitrager/history-${networkName}.jsonl`),
		maxHedgeSlippageBps,
		priceHistoryFile: resolve(option('price-history-file') ?? `.open-oracle-arbitrager/prices-${networkName}.jsonl`),
		positionFile: resolve(option('position-file') ?? `.open-oracle-arbitrager/positions-${networkName}.json`),
		quorumRpcUrls,
		lookbackBlocks: BigInt(option('lookback-blocks') ?? '50000'),
		network,
		once: process.argv.includes('--once'),
		openOracle: requiredAddress('open-oracle'),
		paused: saved?.paused ?? false,
		persistedPrivateKey: saved?.privateKey,
		privateKey,
		settingsFile,
		tokenAddresses: [...new Set([network.rep, ...(saved?.tokenAddresses ?? []), ...options('token-address').map(getAddress)])],
		router: routerValue === undefined ? undefined : getAddress(routerValue),
		riskLimits,
		connectivity: validateConnectivitySettings({
			publicRpcUrls: publicRpcUrls.length === 0 ? (saved?.connectivity.publicRpcUrls ?? [readRpcUrl]) : publicRpcUrls,
			readRpcUrl,
		}),
		submission,
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

function hedgeExecutionFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], executor: Address) {
	for (const log of logs) {
		if (log.address.toLowerCase() !== executor.toLowerCase()) continue
		try {
			const decoded = decodeEventLog({ abi: openOracleArbitrageExecutorAbi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'HedgeAndDisputeExecuted') continue
			return {
				account: decoded.args.account,
				boughtToken2: decoded.args.boughtToken2,
				contribution1: decoded.args.contribution1,
				contribution2: decoded.args.contribution2,
				hedgeAmountToken2: decoded.args.hedgeAmountToken2,
				hedgeAmountWeth: decoded.args.hedgeAmountWeth,
				reportId: decoded.args.reportId,
			}
		} catch (error) {
			void error
		}
	}
	throw new Error('Confirmed executor transaction did not emit HedgeAndDisputeExecuted')
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

async function loadCoordinatorPolicies(client: ReadClient, config: Pick<Configuration, 'coordinatorAddresses' | 'network' | 'openOracle'>) {
	return Promise.all(
		config.coordinatorAddresses.map(async coordinator => {
			const [openOracle, token2, token1, settlementTime, disputeDelay, protocolFee, feePercentage, multiplier, timeType, trackDisputes, protocolFeeRecipient, callbackGasLimit] = await Promise.all([
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'openOracle' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'reputationToken' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'weth' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'settlementTime' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'disputeDelay' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'protocolFee' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'feePercentage' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'multiplier' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'timeType' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'trackDisputes' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'protocolFeeRecipient' }),
				client.readContract({ address: coordinator, abi: openOraclePriceCoordinatorAbi, functionName: 'getSettlementCallbackGasLimit' }),
			])
			if (openOracle.toLowerCase() !== config.openOracle.toLowerCase()) throw new Error(`Configured coordinator ${coordinator} uses OpenOracle ${openOracle}, not ${config.openOracle}`)
			if (token1.toLowerCase() !== config.network.weth.toLowerCase()) throw new Error(`Configured coordinator ${coordinator} uses WETH ${token1}, not ${config.network.weth}`)
			if (!trackDisputes) throw new Error(`Configured coordinator ${coordinator} does not track disputes`)
			const policy = {
				callbackGasLimit,
				coordinator,
				disputeDelay,
				feePercentage,
				flags: OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_TRACK_DISPUTES | (timeType ? OPEN_ORACLE_FLAG_TIME_TYPE : 0n),
				multiplier,
				openOracle,
				protocolFee,
				protocolFeeRecipient,
				settlementTime,
				token1,
				token2,
			} satisfies CoordinatorGamePolicy
			const safetyMismatch = coordinatorPolicySafetyMismatch(policy)
			if (safetyMismatch !== undefined) throw new Error(`Configured coordinator ${coordinator} is unsafe: ${safetyMismatch}`)
			return policy
		}),
	)
}

function requiredDeploymentIdentities(config: Configuration) {
	const identities: { address: Address; role: 'coordinator' | 'executor' | 'open-oracle' | 'token' | 'uniswap-factory' | 'uniswap-quoter' | 'uniswap-router' | 'weth' }[] = [
		{ address: config.openOracle, role: 'open-oracle' },
		{ address: config.network.weth, role: 'weth' },
		{ address: config.network.factory, role: 'uniswap-factory' },
		{ address: config.network.quoter, role: 'uniswap-quoter' },
		...config.coordinatorAddresses.map(address => ({ address, role: 'coordinator' as const })),
		...config.tokenAddresses.map(address => ({ address, role: 'token' as const })),
	]
	if (config.executor !== undefined) identities.push({ address: config.executor, role: 'executor' })
	if (config.router !== undefined) identities.push({ address: config.router, role: 'uniswap-router' })
	return identities
}

function authenticatedExecutionToken(config: Configuration, token: Address) {
	if (!config.execute) return true
	return config.deploymentManifest?.contracts.some(entry => entry.role === 'token' && entry.address.toLowerCase() === token.toLowerCase()) === true
}

async function authenticateConfiguredDeployments(clients: readonly ReadClient[], config: Configuration) {
	if (!config.execute) return
	const manifest = config.deploymentManifest
	if (manifest === undefined) throw new Error('Execution requires an authenticated deployment manifest')
	const required = [...requiredDeploymentIdentities(config), ...manifest.contracts.map(contract => ({ address: contract.address, role: contract.role }))]
	await Promise.all(
		clients.map(client =>
			authenticateDeploymentManifest(manifest, {
				chainId: config.network.chain.id,
				network: config.network.name,
				readCode: address => client.getCode({ address }),
				required,
			}),
		),
	)
}

function retainReportsAndLogs(reports: Map<bigint, ActiveReport>, logs: readonly TransactionLog[], policies: readonly CoordinatorGamePolicy[], openOracle: Address, head: bigint) {
	const retainedIds = retainedReportIds(reports, policies, openOracle, MAX_UNTRUSTED_DRY_RUN_REPORTS)
	const retainedLogs = compactFinalityWindow(
		logs.filter(log => retainedIds.has(reportId(log))),
		head,
		REORG_OVERLAP_BLOCKS,
		reportId,
		logBlockNumber,
		log => log.topics[0]?.toLowerCase() === OPEN_ORACLE_REPORT_SETTLED_TOPIC.toLowerCase(),
	)
	reports.clear()
	applyLogs(reports, retainedLogs)
	return retainedLogs
}

function candidateRiskMismatch(candidate: ExecutionCandidate, positions: readonly PositionRecord[], limits: RiskLimits, now = new Date()) {
	const openPositions = positions.filter(position => position.status !== 'closed')
	const lockedWeth = openPositions.reduce((total, position) => total + parseDecimalWeth(position.capitalAtRiskWeth), 0n)
	const day = now.toISOString().slice(0, 10)
	const dailyGasSpentWeth = positions.reduce((total, position) => total + (position.openedAt.slice(0, 10) === day ? parseDecimalWeth(position.actualEntryGasCostEth) : 0n) + (position.lifecycleUpdatedAt?.slice(0, 10) === day ? parseDecimalWeth(position.lifecycleGasCostEth) : 0n), 0n)
	return riskLimitMismatch(
		{
			capitalAtRiskWeth: candidate.capitalAtRiskWeth,
			concurrentPositions: openPositions.length,
			dailyGasSpentWeth: dailyGasSpentWeth + candidate.projectedGasCostWeth,
			projectedLockedWeth: lockedWeth + candidate.capitalAtRiskWeth,
		},
		limits,
	)
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

async function loadPool(client: ReadClient, address: Address, token: Address, fee: Pool['fee'], twapSeconds: number, blockNumber?: bigint | undefined): Promise<Pool | undefined> {
	const liquidityParameters = {
		address,
		abi: poolAbi,
		functionName: 'liquidity',
	} as const
	const liquidity = requiredBigint(blockNumber === undefined ? await client.readContract(liquidityParameters) : await readContractAtBlock(client.transport, liquidityParameters, blockNumber), 'Uniswap liquidity')
	if (liquidity === 0n) return undefined
	const slot0Parameters = {
		address,
		abi: poolAbi,
		functionName: 'slot0',
	} as const
	const slot0 = requiredTuple(blockNumber === undefined ? await client.readContract(slot0Parameters) : await readContractAtBlock(client.transport, slot0Parameters, blockNumber), 2, 'Uniswap slot0')
	const observationParameters = {
		address,
		abi: poolAbi,
		functionName: 'observe',
		args: [[twapSeconds, 0]],
	} as const
	const observation = requiredTuple(blockNumber === undefined ? await client.readContract(observationParameters) : await readContractAtBlock(client.transport, observationParameters, blockNumber), 1, 'Uniswap observation')
	const tickCumulatives = requiredBigintArray(observation[0], 'Uniswap tick cumulatives')
	return {
		address,
		fee,
		liquidity,
		spotTick: requiredBigint(slot0[1], 'Uniswap current tick'),
		token,
		twapTick: meanTick(tickCumulatives, BigInt(twapSeconds)),
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

async function quoteInput(client: ReadClient, quoter: Address, tokenIn: Address, tokenOut: Address, amountIn: bigint, fee: number, blockNumber?: bigint | undefined) {
	const parameters = {
		address: quoter,
		abi: quoterAbi,
		functionName: 'quoteExactInputSingle',
		args: [{ tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96: 0n }],
	} as const
	const result = requiredTuple(blockNumber === undefined ? await client.readContract(parameters) : await readContractAtBlock(client.transport, parameters, blockNumber), 1, 'Uniswap exact-input quote')
	return requiredBigint(result[0], 'Uniswap exact-input amount')
}

async function quoteOutput(client: ReadClient, quoter: Address, tokenIn: Address, tokenOut: Address, amount: bigint, fee: number, blockNumber?: bigint | undefined) {
	const parameters = {
		address: quoter,
		abi: quoterAbi,
		functionName: 'quoteExactOutputSingle',
		args: [{ tokenIn, tokenOut, amount, fee, sqrtPriceLimitX96: 0n }],
	} as const
	const result = requiredTuple(blockNumber === undefined ? await client.readContract(parameters) : await readContractAtBlock(client.transport, parameters, blockNumber), 1, 'Uniswap exact-output quote')
	return requiredBigint(result[0], 'Uniswap exact-output amount')
}

function safetyAdjustedQuote(quote: ArbitrageQuote, gasCost: bigint, lifecycleGasReserveWeth: bigint, config: Pick<Configuration, 'maxHedgeSlippageBps'>) {
	const slippageReserveWeth = hedgeSlippageReserveWeth(quote.direction, quote.direction === 'sell-rep' ? quote.grossProceedsWeth : quote.hedgeCostWeth, config.maxHedgeSlippageBps)
	return {
		...quote,
		netProfitWeth: adjustedNetProfitWeth({
			entryGasCostWeth: gasCost,
			hedgeSlippageReserveWeth: slippageReserveWeth,
			lifecycleGasReserveWeth,
			profitBeforeGasWeth: quote.profitBeforeGasWeth,
		}),
	}
}

async function evaluate(client: ReadClient, config: Configuration, report: OpenOracleStatePreimage, pool: Pool, gasPrice: bigint, blockNumber?: bigint | undefined) {
	const game = report.game
	const gasCost = gasPrice * 1_200_000n
	const lifecycleGasReserveWeth = [config.riskLimits.lifecycleGasReserveWeth, gasPrice * (BigInt(game.callbackGasLimit) + 1_050_000n)].reduce((maximum, value) => (value > maximum ? value : maximum), 0n)
	const repWithFees = game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)
	return bestSuccessful(
		[
			async () => safetyAdjustedQuote(evaluateSellRep(game, await quoteInput(client, config.network.quoter, pool.token, config.network.weth, game.currentAmount2, pool.fee, blockNumber), 0n), gasCost, lifecycleGasReserveWeth, config),
			async () => safetyAdjustedQuote(evaluateBuyRep(game, await quoteOutput(client, config.network.quoter, config.network.weth, pool.token, repWithFees, pool.fee, blockNumber), 0n), gasCost, lifecycleGasReserveWeth, config),
		],
		candidate => candidate.netProfitWeth,
		error => console.error(`pool=${pool.address} quoteSkipped=${errorMessage(error)}`),
	)
}

async function assertExecutionReadQuorum(clients: readonly ReadClient[], config: Configuration, report: OpenOracleStatePreimage, pool: Pool, quote: ArbitrageQuote, blockNumber: bigint, account: Address) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const game = report.game
	const newAmount1 = calculateNextAmount1(game)
	const repWithFees = game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)
	const observations = await Promise.all(
		clients.map(async (readClient, index) => {
			const [block, stateHash, refreshedPool, replacementAmount2, hedgeQuote, nonce, eth, weth, token] = await Promise.all([
				readClient.getBlock({ blockNumber }),
				readContractAtBlock(readClient.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'oracleGame', args: [report.helper.reportId] }, blockNumber),
				loadPool(readClient, pool.address, pool.token, pool.fee, config.twapSeconds, blockNumber),
				quoteInput(readClient, config.network.quoter, config.network.weth, pool.token, newAmount1, pool.fee, blockNumber),
				quote.direction === 'sell-rep' ? quoteInput(readClient, config.network.quoter, pool.token, config.network.weth, game.currentAmount2, pool.fee, blockNumber) : quoteOutput(readClient, config.network.quoter, config.network.weth, pool.token, repWithFees, pool.fee, blockNumber),
				getTransactionCountAtBlock(readClient.transport, { address: account, blockNumber }),
				getBalanceAtBlock(readClient.transport, { address: account, blockNumber }),
				readContractAtBlock(readClient.transport, { address: config.network.weth, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
				readContractAtBlock(readClient.transport, { address: game.token2, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
			])
			if (block.hash === null || refreshedPool === undefined) throw new Error('RPC quorum snapshot is missing a canonical block or active pool')
			return {
				endpoint: endpointLabel(endpoints[index] ?? ''),
				value: {
					blockHash: block.hash,
					blockTimestamp: block.timestamp,
					eth,
					hedgeQuote,
					nonce,
					poolLiquidity: refreshedPool.liquidity,
					poolSpotTick: refreshedPool.spotTick,
					poolTwapTick: refreshedPool.twapTick,
					replacementAmount2,
					stateHash,
					token,
					weth,
				},
			}
		}),
	)
	quorumValue(`execution snapshot at block ${blockNumber.toString()}`, observations)
}

async function pendingNonceWithQuorum(clients: readonly ReadClient[], config: Configuration, account: Address) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const observations = await Promise.all(
		clients.map(async (client, index) => ({
			endpoint: endpointLabel(endpoints[index] ?? ''),
			value: await client.getTransactionCount({ address: account, blockTag: 'pending' }),
		})),
	)
	return quorumValue('pending account nonce used for signing', observations)
}

async function storedReport(client: ReadClient, openOracle: Address, id: bigint, blockNumber?: bigint | undefined): Promise<OpenOracleStatePreimage> {
	const [rawGame, rawHelper] = await Promise.all([
		blockNumber === undefined ? client.readContract({ address: openOracle, abi: openOracleAbi, functionName: 'storedGame', args: [id] }) : readContractAtBlock(client.transport, { address: openOracle, abi: openOracleAbi, functionName: 'storedGame', args: [id] }, blockNumber),
		blockNumber === undefined ? client.readContract({ address: openOracle, abi: openOracleAbi, functionName: 'storedHelper', args: [id] }) : readContractAtBlock(client.transport, { address: openOracle, abi: openOracleAbi, functionName: 'storedHelper', args: [id] }, blockNumber),
	])
	const game = requiredTuple(rawGame, 20, 'Stored OpenOracle game')
	const helper = requiredTuple(rawHelper, 3, 'Stored OpenOracle helper')
	return {
		game: {
			currentAmount1: requiredBigint(game[0], 'Stored OpenOracle currentAmount1'),
			currentAmount2: requiredBigint(game[1], 'Stored OpenOracle currentAmount2'),
			currentReporter: requiredRpcAddress(game[2], 'Stored OpenOracle currentReporter'),
			reportTimestamp: requiredBigint(game[3], 'Stored OpenOracle reportTimestamp'),
			settlementTimestamp: requiredBigint(game[4], 'Stored OpenOracle settlementTimestamp'),
			token1: requiredRpcAddress(game[5], 'Stored OpenOracle token1'),
			lastReportOppoTime: requiredBigint(game[6], 'Stored OpenOracle lastReportOppoTime'),
			settlementTime: requiredBigint(game[7], 'Stored OpenOracle settlementTime'),
			escalationHalt: requiredBigint(game[8], 'Stored OpenOracle escalationHalt'),
			protocolFeeRecipient: requiredRpcAddress(game[9], 'Stored OpenOracle protocolFeeRecipient'),
			settlerReward: requiredBigint(game[10], 'Stored OpenOracle settlerReward'),
			token2: requiredRpcAddress(game[11], 'Stored OpenOracle token2'),
			numReports: requiredBigint(game[12], 'Stored OpenOracle numReports'),
			disputeDelay: requiredBigint(game[13], 'Stored OpenOracle disputeDelay'),
			feePercentage: requiredBigint(game[14], 'Stored OpenOracle feePercentage'),
			multiplier: requiredBigint(game[15], 'Stored OpenOracle multiplier'),
			callbackContract: requiredRpcAddress(game[16], 'Stored OpenOracle callbackContract'),
			callbackGasLimit: requiredBigint(game[17], 'Stored OpenOracle callbackGasLimit'),
			protocolFee: requiredBigint(game[18], 'Stored OpenOracle protocolFee'),
			flags: requiredBigint(game[19], 'Stored OpenOracle flags'),
		},
		helper: {
			blockNumber: requiredBigint(helper[2], 'Stored OpenOracle helper blockNumber'),
			blockTimestamp: requiredBigint(helper[1], 'Stored OpenOracle helper blockTimestamp'),
			creator: requiredRpcAddress(helper[0], 'Stored OpenOracle helper creator'),
			reportId: id,
		},
	}
}

async function storedReportWithQuorum(clients: readonly ReadClient[], config: Configuration, id: bigint, blockNumber: bigint) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const observations = await Promise.all(
		clients.map(async (client, index) => {
			const [block, report] = await Promise.all([client.getBlock({ blockNumber }), storedReport(client, config.openOracle, id, blockNumber)])
			if (block.hash === null || block.hash === undefined) throw new Error(`Stored report ${id.toString()} block is missing its canonical hash`)
			return {
				endpoint: endpointLabel(endpoints[index] ?? ''),
				value: {
					blockHash: block.hash,
					blockTimestamp: block.timestamp,
					report,
				},
			}
		}),
	)
	return quorumValue(`stored report ${id.toString()} at block ${blockNumber.toString()}`, observations)
}

async function lifecycleBalancesWithQuorum(clients: readonly ReadClient[], config: Configuration, account: Address, token: Address, blockNumber: bigint) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const observations = await Promise.all(
		clients.map(async (client, index) => {
			const [block, rawHolderWeth, rawHolderToken, rawWalletWeth, rawWalletToken, rawTokenDecimals] = await Promise.all([
				client.getBlock({ blockNumber }),
				readContractAtBlock(client.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'tokenHolder', args: [account, config.network.weth] }, blockNumber),
				readContractAtBlock(client.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'tokenHolder', args: [account, token] }, blockNumber),
				readContractAtBlock(client.transport, { address: config.network.weth, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
				readContractAtBlock(client.transport, { address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
				readContractAtBlock(client.transport, { address: token, abi: erc20Abi, functionName: 'decimals' }, blockNumber),
			])
			if (block.hash === null || block.hash === undefined) throw new Error(`Position lifecycle block ${blockNumber.toString()} is missing its canonical hash`)
			return {
				endpoint: endpointLabel(endpoints[index] ?? ''),
				value: {
					blockHash: block.hash,
					blockTimestamp: block.timestamp,
					holderToken: requiredBigint(rawHolderToken, 'OpenOracle token holder balance'),
					holderWeth: requiredBigint(rawHolderWeth, 'OpenOracle WETH holder balance'),
					tokenDecimals: requiredBigint(rawTokenDecimals, 'Position token decimals'),
					walletToken: requiredBigint(rawWalletToken, 'Wallet token balance'),
					walletWeth: requiredBigint(rawWalletWeth, 'Wallet WETH balance'),
				},
			}
		}),
	)
	return quorumValue(`position lifecycle balances at block ${blockNumber.toString()}`, observations)
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

async function executeDispute(
	client: ReadClient,
	readClients: readonly ReadClient[],
	wallet: WriteClient,
	config: Configuration,
	report: OpenOracleStatePreimage,
	quote: ArbitrageQuote,
	pool: Pool,
	tokenMetadata: { decimals: number; symbol: string },
	isPaused: () => boolean,
	track: TrackTransaction,
	persistPosition: (position: PositionRecord) => Promise<void>,
): Promise<ExecutionRecord> {
	const account = wallet.account
	const executor = config.executor
	if (account === undefined || account.signTransaction === undefined || account.signMessage === undefined) throw new Error('Execution requires a local transaction and relay signer')
	if (executor === undefined) throw new Error('Execution requires a deployed OpenOracle arbitrage executor')
	const router = config.router
	if (router === undefined) throw new Error('Execution requires an authenticated Uniswap router')
	const game = report.game
	if (isSelfReport(account.address, game.currentReporter)) throw new Error('Self-disputes use different OpenOracle accounting and are not supported')
	const newAmount1 = calculateNextAmount1(game)
	const reportId = report.helper.reportId.toString()
	const quoteBlock = await client.getBlock()
	if (quoteBlock.number === undefined) throw new Error('Quote block is missing its number')
	const quoteBlockNumber = quoteBlock.number
	const signMessage = account.signMessage
	const signTransaction = account.signTransaction
	const refreshedPool = await loadPool(client, pool.address, pool.token, pool.fee, config.twapSeconds, quoteBlockNumber)
	if (refreshedPool === undefined) throw new Error('Selected pool lost all active liquidity')
	const deviation = refreshedPool.spotTick > refreshedPool.twapTick ? refreshedPool.spotTick - refreshedPool.twapTick : refreshedPool.twapTick - refreshedPool.spotTick
	if (deviation > config.maxSpotTwapTicks) throw new Error('Selected pool failed the final spot/TWAP check')
	const gasPrice = (quoteBlock.baseFeePerGas ?? 0n) * 2n + 2n * 10n ** 9n
	const refreshedQuote = await evaluate(client, config, report, refreshedPool, gasPrice, quoteBlockNumber)
	if (refreshedQuote === undefined) throw new Error('Selected pool no longer serves either arbitrage direction')
	if (refreshedQuote.direction !== quote.direction) throw new Error('Best arbitrage direction changed before submission')
	const newAmount2 = await quoteInput(client, config.network.quoter, config.network.weth, refreshedPool.token, newAmount1, refreshedPool.fee, quoteBlockNumber)
	const tokenToSwap = deriveTokenToSwap(game, newAmount1, newAmount2)
	if (tokenToSwap.toLowerCase() !== refreshedQuote.tokenToSwap.toLowerCase()) throw new Error('Final replacement ratio does not derive the selected arbitrage direction')
	const hedgeLimitQuote = refreshedQuote.direction === 'sell-rep' ? refreshedQuote.grossProceedsWeth : refreshedQuote.hedgeCostWeth
	const hedgeLimit = hedgeWethLimit(refreshedQuote.direction, hedgeLimitQuote, config.maxHedgeSlippageBps)
	const funding = executorFunding(game, newAmount1, newAmount2, refreshedQuote.direction === 'buy-rep' ? hedgeLimit : 0n)
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
	await assertExecutionReadQuorum(readClients, config, report, refreshedPool, refreshedQuote, quoteBlockNumber, account.address)
	const storedHash = await client.readContract({
		address: config.openOracle,
		abi: openOracleAbi,
		functionName: 'oracleGame',
		args: [report.helper.reportId],
	})
	if (storedHash.toLowerCase() !== hashOpenOracleStatePreimage(report).toLowerCase()) throw new Error('Report changed before submission')
	const [allowance1, allowance2] = await Promise.all([client.readContract({ address: game.token1, abi: erc20Abi, functionName: 'allowance', args: [account.address, executor] }), client.readContract({ address: game.token2, abi: erc20Abi, functionName: 'allowance', args: [account.address, executor] })])
	const plan = fundingTransactionPlan(config.submission.mode, { token1: allowance1, token2: allowance2 }, funding)
	const request = {
		address: executor,
		abi: openOracleArbitrageExecutorAbi,
		functionName: 'hedgeAndDispute',
		args: [
			{
				hedgeWethLimit: hedgeLimit,
				newAmount1,
				newAmount2,
				openOracle: config.openOracle,
				poolFee: refreshedPool.fee,
				router,
				swapDeadline: quoteBlock.timestamp + 300n,
			},
			getOpenOracleGameTuple(game),
			getOpenOracleHelperTuple(report.helper),
			openOracleDisputeTiming(quoteBlockNumber, quoteBlock.timestamp),
		],
	} as const
	const targetBlockNumber = quoteBlockNumber + 1n
	const startingNonce = await pendingNonceWithQuorum(readClients, config, account.address)
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
			signedTransactions.push({ kind: 'dispute', signed: await sign(executor, encodeFunctionData(request), 1_200_000n), token: undefined, tokenSymbol: undefined })
			continue
		}
		const token1 = step.endsWith('token1')
		const token = token1 ? game.token1 : game.token2
		let amount = token1 ? funding.token1 : funding.token2
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
	const stagedPosition = {
		account: account.address,
		actualEntryGasCostEth: '0',
		capitalAtRiskWeth: decimalWeth(funding.token1 + (funding.token2 * hedgeLimitQuote + refreshedQuote.hedgeAmountRep - 1n) / refreshedQuote.hedgeAmountRep),
		closedAt: undefined,
		direction: refreshedQuote.direction,
		entryTransactionHash: executionSigned.hash,
		entryTransactionHashes: signedTransactions.map(transaction => transaction.signed.hash),
		hedgeAmountToken: formatTokenAmount(refreshedQuote.hedgeAmountRep, tokenMetadata.decimals),
		hedgeWeth: decimalWeth(hedgeLimitQuote),
		hedgedProfitBeforeGasEth: decimalSignedEth(refreshedQuote.profitBeforeGasWeth),
		lifecycleGasCostEth: '0',
		lifecycleReceiptRecovered: false,
		lifecycleTargetBlockNumber: undefined,
		lifecycleTokenDecimals: undefined,
		lifecycleTransactionHashes: [],
		lifecycleUpdatedAt: undefined,
		lifecycleWalletTokenBefore: undefined,
		lifecycleWalletWethBefore: undefined,
		lockedToken: formatTokenAmount(expectedWithdrawalToken2(refreshedQuote.direction, game.currentAmount2, newAmount2), tokenMetadata.decimals),
		lockedWeth: decimalWeth(newAmount1),
		manualReconciliation: undefined,
		openedAt: new Date().toISOString(),
		realizedNetProfitEth: undefined,
		reportId,
		status: 'pending-entry',
		token: game.token2,
		tokenSymbol: tokenMetadata.symbol,
		withdrawnToken: '0',
		withdrawnWeth: '0',
	} satisfies PositionRecord
	let actualGasCost: bigint
	let estimatedNetProfit = refreshedQuote.netProfitWeth
	let receiptBlockNumber: bigint
	let executionHash = executionSigned.hash
	let executionLogs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[] = []
	if (config.submission.mode === 'public') {
		await wallet.simulateContract(request)
		if (!meetsProfitThreshold(refreshedQuote, config.minimumProfitWeth, config.minimumProfitBps)) throw new Error('Arbitrage no longer meets the profit threshold at submission')
		await persistPosition(stagedPosition)
		const submission = await submitContractTransaction(client, wallet, config, executionSigned, { estimatedNetProfitEth: decimalWeth(refreshedQuote.netProfitWeth), kind: 'dispute', reportId }, isPaused, track)
		const { receipt, tracked } = await waitForTrackedTransaction(client, wallet, config, submission, track)
		if (receipt.status !== 'success') throw new Error(`Dispute transaction reverted: ${receipt.transactionHash}`)
		actualGasCost = receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n)
		receiptBlockNumber = receipt.blockNumber
		executionHash = receipt.transactionHash
		executionLogs = receipt.logs
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
		const lifecycleGasReserveWeth = [config.riskLimits.lifecycleGasReserveWeth, gasPrice * (BigInt(game.callbackGasLimit) + 1_050_000n)].reduce((maximum, value) => (value > maximum ? value : maximum), 0n)
		const simulatedQuote = safetyAdjustedQuote(refreshedQuote, totalGasUsed * gasPrice, lifecycleGasReserveWeth, config)
		const simulatedNetProfit = simulatedQuote.netProfitWeth
		estimatedNetProfit = simulatedNetProfit
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
				() =>
					journaledSubmission(
						() => persistPosition(stagedPosition),
						() =>
							submitSignedBundle({
								address: account.address,
								relayUrls: config.submission.relayUrls,
								signMessage,
								targetBlockNumber,
								transactions: serializedTransactions,
							}),
					),
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
		executionLogs = executorReceipt.logs
		const trackedNetProfitEth = decimalSignedEth(calculateTrackedNetProfitEth(refreshedQuote.profitBeforeGasWeth, actualGasCost))
		for (const [index, transaction] of pending.entries()) {
			const receipt = confirmedReceipts[index]
			if (receipt === undefined) throw new Error('Bundle receipt order is incomplete')
			track(trackedActivity(transaction, 'confirmed', decimalWeth(receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n)), receipt.transactionHash, transaction.kind === 'dispute' ? trackedNetProfitEth : undefined))
		}
	}
	const hedgeExecution = hedgeExecutionFromLogs(executionLogs, executor)
	if (hedgeExecution.reportId !== report.helper.reportId) throw new Error('Executor hedge event report id does not match the submitted report')
	const hedgedProfitBeforeGas = hedgedProfitBeforeGasWeth(refreshedQuote.direction, hedgeExecution.hedgeAmountWeth, game.currentAmount1, calculateFee(game.currentAmount1, game.feePercentage), calculateFee(game.currentAmount1, game.protocolFee))
	await persistPosition({
		...stagedPosition,
		actualEntryGasCostEth: decimalWeth(actualGasCost),
		entryTransactionHash: executionHash,
		hedgeAmountToken: formatTokenAmount(hedgeExecution.hedgeAmountToken2, tokenMetadata.decimals),
		hedgeWeth: decimalWeth(hedgeExecution.hedgeAmountWeth),
		hedgedProfitBeforeGasEth: decimalSignedEth(hedgedProfitBeforeGas),
		status: 'open',
	})
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
		requiredToken: formatTokenAmount(funding.token2, tokenMetadata.decimals),
		requiredWeth: decimalWeth(funding.token1),
		token: game.token2,
		tokenSymbol: tokenMetadata.symbol,
		trackedNetProfitEth,
		transactionHash: executionHash,
	}
}

function tokenDecimalsFromSnapshot(snapshot: { tokenDecimals: bigint }, reportId: string) {
	const tokenDecimals = Number(snapshot.tokenDecimals)
	if (!Number.isSafeInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 255) throw new Error(`Position ${reportId} token decimals are invalid`)
	return tokenDecimals
}

async function recoverPendingEntryWithQuorum(readClients: readonly ReadClient[], config: Configuration, position: PositionRecord, tokenDecimals: number): Promise<PositionRecord> {
	const executor = config.executor
	if (executor === undefined) throw new Error('Pending entry recovery requires the authenticated executor')
	const receipts = await transactionReceiptsWithQuorum(readClients, config, `pending entry ${position.reportId}`, position.entryTransactionHashes)
	const firstReceipt = receipts[0]
	const executorReceipt = receipts.at(-1)
	if (firstReceipt === undefined || executorReceipt === undefined || receipts.some(receipt => receipt.status !== 'success' || receipt.blockNumber !== firstReceipt.blockNumber)) {
		throw new Error('Entry bundle receipts are missing, reverted, or split across blocks')
	}
	for (const [index, receipt] of receipts.entries()) {
		const expectedHash = position.entryTransactionHashes[index]
		if (expectedHash === undefined || receipt.transactionHash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error('Entry bundle receipt hash does not match the durable journal')
	}
	const hedgeExecution = hedgeExecutionFromLogs(executorReceipt.logs, executor)
	if (hedgeExecution.account.toLowerCase() !== position.account.toLowerCase() || hedgeExecution.reportId.toString() !== position.reportId) {
		throw new Error('Executor hedge event does not match the durable position')
	}
	const actualEntryGasCost = receipts.reduce((total, receipt) => total + receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n), 0n)
	const actualProfitBeforeGas = recoveredHedgedProfitBeforeGasWeth(position.direction, parseSignedDecimalEth(position.hedgedProfitBeforeGasEth), parseDecimalWeth(position.hedgeWeth), hedgeExecution.hedgeAmountWeth)
	return {
		...position,
		actualEntryGasCostEth: decimalWeth(actualEntryGasCost),
		entryTransactionHash: executorReceipt.transactionHash,
		hedgeAmountToken: formatTokenAmount(hedgeExecution.hedgeAmountToken2, tokenDecimals),
		hedgeWeth: decimalWeth(hedgeExecution.hedgeAmountWeth),
		hedgedProfitBeforeGasEth: decimalSignedEth(actualProfitBeforeGas),
		status: 'open',
	}
}

async function transactionReceiptsWithQuorum(readClients: readonly ReadClient[], config: Configuration, label: string, transactionHashes: readonly Hex[]) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const observations = await Promise.all(
		readClients.map(async (client, index) => {
			const receipts = await Promise.all(transactionHashes.map(hash => client.getTransactionReceipt({ hash })))
			return {
				endpoint: endpointLabel(endpoints[index] ?? ''),
				value: receipts.map(receipt => ({
					blockHash: receipt.blockHash,
					blockNumber: receipt.blockNumber,
					effectiveGasPrice: receipt.effectiveGasPrice,
					gasUsed: receipt.gasUsed,
					logs: receipt.logs.map(log => ({ address: log.address, data: log.data, topics: log.topics })),
					status: receipt.status,
					transactionHash: receipt.transactionHash,
				})),
			}
		}),
	)
	return quorumValue(`${label} receipts`, observations)
}

async function recoverPendingLifecycleWithQuorum(readClients: readonly ReadClient[], config: Configuration, position: PositionRecord): Promise<PositionRecord> {
	if (position.lifecycleTransactionHashes.length === 0 || position.lifecycleTargetBlockNumber === undefined || position.lifecycleTokenDecimals === undefined || position.lifecycleWalletTokenBefore === undefined || position.lifecycleWalletWethBefore === undefined) {
		throw new Error('Lifecycle recovery journal is incomplete')
	}
	const receipts = await transactionReceiptsWithQuorum(readClients, config, `pending lifecycle ${position.reportId}`, position.lifecycleTransactionHashes)
	const firstReceipt = receipts[0]
	const targetBlockNumber = BigInt(position.lifecycleTargetBlockNumber)
	if (firstReceipt === undefined || receipts.some(receipt => receipt.status !== 'success' || receipt.blockNumber !== firstReceipt.blockNumber || receipt.blockNumber !== targetBlockNumber)) {
		throw new Error('Lifecycle bundle receipts are missing, reverted, outside the target block, or split across blocks')
	}
	for (const [index, receipt] of receipts.entries()) {
		const expectedHash = position.lifecycleTransactionHashes[index]
		if (expectedHash === undefined || receipt.transactionHash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error('Lifecycle bundle receipt hash does not match the durable journal')
	}
	const balancesAfter = await lifecycleBalancesWithQuorum(readClients, config, position.account, position.token, targetBlockNumber)
	if (balancesAfter.blockHash.toLowerCase() !== firstReceipt.blockHash.toLowerCase()) throw new Error('Lifecycle receipt and recovered balance snapshot use different canonical blocks')
	const walletWethBefore = BigInt(position.lifecycleWalletWethBefore)
	const walletTokenBefore = BigInt(position.lifecycleWalletTokenBefore)
	if (balancesAfter.walletWeth < walletWethBefore || balancesAfter.walletToken < walletTokenBefore) {
		throw new Error('Recovered lifecycle reduced a tracked wallet balance')
	}
	const withdrawnWeth = balancesAfter.walletWeth - walletWethBefore
	const withdrawnToken = balancesAfter.walletToken - walletTokenBefore
	const lifecycleGas = parseDecimalWeth(position.lifecycleGasCostEth) + receipts.reduce((total, receipt) => total + receipt.gasUsed * (receipt.effectiveGasPrice ?? 0n), 0n)
	const tokenDecimals = Number(position.lifecycleTokenDecimals)
	if (!Number.isSafeInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 255) throw new Error('Lifecycle recovery token decimals are invalid')
	const recovered = {
		...position,
		closedAt: undefined,
		lifecycleGasCostEth: decimalWeth(lifecycleGas),
		lifecycleReceiptRecovered: true,
		lifecycleUpdatedAt: new Date().toISOString(),
		realizedNetProfitEth: undefined,
		status: 'recovery-required' as const,
		withdrawnToken: formatTokenAmount(withdrawnToken, tokenDecimals),
		withdrawnWeth: decimalWeth(withdrawnWeth),
	} satisfies PositionRecord
	if (!exactWithdrawalMatches({ token2: recovered.withdrawnToken, weth: recovered.withdrawnWeth }, { token2: position.lockedToken, weth: position.lockedWeth })) return recovered
	const realized = realizedNetProfitWeth(parseSignedDecimalEth(position.hedgedProfitBeforeGasEth), parseDecimalWeth(position.actualEntryGasCostEth), lifecycleGas)
	return { ...recovered, closedAt: new Date().toISOString(), realizedNetProfitEth: decimalSignedEth(realized), status: 'closed' }
}

async function processPositionLifecycle(client: ReadClient, readClients: readonly ReadClient[], wallet: WriteClient, config: Configuration, position: PositionRecord, blockNumber: bigint, persistPosition: (position: PositionRecord) => Promise<void>) {
	const account = wallet.account
	if (account.signTransaction === undefined || account.signMessage === undefined) throw new Error('Position recovery requires a local transaction and relay signer')
	const signMessage = account.signMessage
	if (position.account.toLowerCase() !== account.address.toLowerCase()) throw new Error(`Open position ${position.reportId} belongs to ${position.account}, not the active signer`)
	const id = BigInt(position.reportId)
	const storedSnapshot = await storedReportWithQuorum(readClients, config, id, blockNumber)
	const report = storedSnapshot.report
	const game = report.game
	if (game.currentReporter === zeroAddress || game.token1.toLowerCase() !== config.network.weth.toLowerCase() || game.token2.toLowerCase() !== position.token.toLowerCase()) {
		await persistPosition({ ...position, status: 'recovery-required' })
		throw new Error(`Open position ${position.reportId} cannot be reconciled with stored OpenOracle state`)
	}
	const currentReporter = game.currentReporter.toLowerCase() === account.address.toLowerCase()
	const currentTime = (game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) === 0n ? blockNumber : storedSnapshot.blockTimestamp
	const settlementEligible = currentReporter && game.settlementTimestamp === 0n && currentTime >= game.reportTimestamp + game.settlementTime
	const balancesBefore = await lifecycleBalancesWithQuorum(readClients, config, account.address, position.token, blockNumber)
	let activePosition = position
	const entryAccountingNeedsRecovery = activePosition.status === 'pending-entry' || (activePosition.status === 'recovery-required' && activePosition.actualEntryGasCostEth === '0')
	if (entryAccountingNeedsRecovery) {
		try {
			activePosition = await recoverPendingEntryWithQuorum(readClients, config, activePosition, tokenDecimalsFromSnapshot(balancesBefore, activePosition.reportId))
			await persistPosition(activePosition)
		} catch (error) {
			await persistPosition({ ...activePosition, status: 'recovery-required' })
			throw new Error(`Pending position ${activePosition.reportId} entry receipt could not be recovered: ${errorMessage(error)}`)
		}
	}
	if ((activePosition.status === 'withdrawing' || activePosition.status === 'recovery-required') && activePosition.lifecycleTransactionHashes.length !== 0 && !activePosition.lifecycleReceiptRecovered) {
		let recovered: PositionRecord
		try {
			recovered = await recoverPendingLifecycleWithQuorum(readClients, config, activePosition)
		} catch (error) {
			await persistPosition({ ...activePosition, status: 'recovery-required' })
			throw new Error(`Pending position ${activePosition.reportId} lifecycle receipt could not be recovered: ${errorMessage(error)}`)
		}
		await persistPosition(recovered)
		if (recovered.status !== 'closed') throw new Error(`Position ${activePosition.reportId} lifecycle assets do not match the expected hedge-neutral withdrawal`)
		return 'processed' as const
	}
	if (activePosition.status === 'recovery-required' && activePosition.lifecycleReceiptRecovered) {
		throw new Error(`Position ${activePosition.reportId} has recovered lifecycle receipts but requires manual residual-asset reconciliation`)
	}
	if (currentReporter && game.settlementTimestamp === 0n && !settlementEligible) {
		return 'waiting' as const
	}
	if (!currentReporter && balancesBefore.holderWeth <= 1n && balancesBefore.holderToken <= 1n) {
		await persistPosition({ ...activePosition, status: 'recovery-required' })
		throw new Error(`Position ${activePosition.reportId} is no longer current and has no withdrawable OpenOracle balance`)
	}
	if (config.submission.mode !== 'private') throw new Error('Automatic position lifecycle requires private bundle submission')
	const tokenDecimals = tokenDecimalsFromSnapshot(balancesBefore, activePosition.reportId)

	const block = await client.getBlock({ blockNumber })
	const signTransaction = account.signTransaction
	const startingNonce = await pendingNonceWithQuorum(readClients, config, account.address)
	const targetBlockNumber = blockNumber + 1n
	const calls: { data: Hex; gas: bigint }[] = []
	if (settlementEligible) {
		calls.push({
			data: encodeFunctionData({
				abi: openOracleAbi,
				functionName: 'settle',
				args: [id, getOpenOracleGameTuple(game), getOpenOracleHelperTuple(report.helper)],
			}),
			gas: BigInt(game.callbackGasLimit) + 750_000n,
		})
	}
	calls.push({ data: encodeFunctionData({ abi: openOracleAbi, functionName: 'withdraw', args: [config.network.weth, 2n ** 256n - 1n] }), gas: 150_000n }, { data: encodeFunctionData({ abi: openOracleAbi, functionName: 'withdraw', args: [position.token, 2n ** 256n - 1n] }), gas: 150_000n })
	const signed = await Promise.all(
		calls.map((call, index) =>
			prepareSignedTransaction({
				baseFeePerGas: block.baseFeePerGas ?? 0n,
				blockNumber,
				chainId: config.network.chain.id,
				data: call.data,
				from: account.address,
				gasEstimate: call.gas,
				lastValidBlockNumber: targetBlockNumber,
				nonce: startingNonce + BigInt(index),
				signTransaction,
				to: config.openOracle,
			}),
		),
	)
	const serializedTransactions = signed.map(transaction => transaction.serializedTransaction)
	const lifecyclePosition = {
		...activePosition,
		lifecycleTargetBlockNumber: targetBlockNumber.toString(),
		lifecycleTokenDecimals: tokenDecimals.toString(),
		lifecycleTransactionHashes: signed.map(transaction => transaction.hash),
		lifecycleUpdatedAt: new Date().toISOString(),
		lifecycleWalletTokenBefore: balancesBefore.walletToken.toString(),
		lifecycleWalletWethBefore: balancesBefore.walletWeth.toString(),
		status: 'withdrawing' as const,
	} satisfies PositionRecord
	await simulateSignedBundleEveryRelay({
		address: account.address,
		relayUrls: config.submission.relayUrls,
		signMessage,
		stateBlockNumber: blockNumber,
		targetBlockNumber,
		transactions: serializedTransactions,
	})
	await guardedTransactionSubmission(
		() => false,
		async () => {
			if ((await client.getBlockNumber()) !== blockNumber) throw new Error('Position lifecycle bundle quote expired before submission')
		},
		() =>
			journaledSubmission(
				() => persistPosition(lifecyclePosition),
				() =>
					submitSignedBundle({
						address: account.address,
						relayUrls: config.submission.relayUrls,
						signMessage,
						targetBlockNumber,
						transactions: serializedTransactions,
					}),
			),
	)
	while ((await client.getBlockNumber()) < targetBlockNumber) await Bun.sleep(Math.min(config.pollMilliseconds, 1_000))
	const receipts = await Promise.all(
		signed.map(async transaction => {
			try {
				return await client.getTransactionReceipt({ hash: transaction.hash })
			} catch (error) {
				void error
				return undefined
			}
		}),
	)
	const complete = receipts.every(receipt => receipt !== undefined && receipt.status === 'success' && receipt.blockNumber === targetBlockNumber)
	if (!complete) {
		await persistPosition({ ...lifecyclePosition, status: 'recovery-required' })
		throw new Error(`Position lifecycle bundle for report ${activePosition.reportId} was not completely successful`)
	}
	const balancesAfter = await lifecycleBalancesWithQuorum(readClients, config, account.address, position.token, targetBlockNumber)
	if (balancesAfter.walletWeth < balancesBefore.walletWeth || balancesAfter.walletToken < balancesBefore.walletToken) {
		await persistPosition({ ...activePosition, status: 'recovery-required' })
		throw new Error(`Position lifecycle for report ${activePosition.reportId} reduced a tracked wallet balance`)
	}
	const withdrawnWeth = balancesAfter.walletWeth - balancesBefore.walletWeth
	const withdrawnToken = balancesAfter.walletToken - balancesBefore.walletToken
	const actualLifecycleGas = receipts.reduce((total, receipt) => total + (receipt?.gasUsed ?? 0n) * (receipt?.effectiveGasPrice ?? 0n), 0n)
	const lifecycleGas = parseDecimalWeth(activePosition.lifecycleGasCostEth) + actualLifecycleGas
	const realized = realizedNetProfitWeth(parseSignedDecimalEth(activePosition.hedgedProfitBeforeGasEth), parseDecimalWeth(activePosition.actualEntryGasCostEth), lifecycleGas)
	const reconciledPosition = {
		...lifecyclePosition,
		closedAt: undefined,
		lifecycleGasCostEth: decimalWeth(lifecycleGas),
		lifecycleReceiptRecovered: true,
		lifecycleUpdatedAt: new Date().toISOString(),
		realizedNetProfitEth: undefined,
		status: 'recovery-required',
		withdrawnToken: formatTokenAmount(withdrawnToken, tokenDecimals),
		withdrawnWeth: decimalWeth(withdrawnWeth),
	} satisfies PositionRecord
	if (!exactWithdrawalMatches({ token2: reconciledPosition.withdrawnToken, weth: reconciledPosition.withdrawnWeth }, { token2: activePosition.lockedToken, weth: activePosition.lockedWeth })) {
		await persistPosition(reconciledPosition)
		throw new Error(`Position ${activePosition.reportId} withdrew unexpected assets; manual exposure reconciliation is required`)
	}
	await persistPosition({ ...reconciledPosition, closedAt: new Date().toISOString(), realizedNetProfitEth: decimalSignedEth(realized), status: 'closed' })
	return 'processed' as const
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
	paused: boolean,
	coordinatorPolicies: readonly CoordinatorGamePolicy[],
	recordDecision: (message: string, reason: string) => void,
): Promise<EvaluatedOpportunity | undefined> {
	const game = report.game
	const policyMismatch = gamePolicyMismatch(report, coordinatorPolicies, config.openOracle)
	if (policyMismatch !== undefined) {
		recordDecision('Skipped report', policyMismatch)
		return
	}
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
	const hedgeLimitQuote = best.quote.direction === 'sell-rep' ? best.quote.grossProceedsWeth : best.quote.hedgeCostWeth
	const hedgeLimit = hedgeWethLimit(best.quote.direction, hedgeLimitQuote, config.maxHedgeSlippageBps)
	const funding = executorFunding(game, newAmount1, replacementAmount2, best.quote.direction === 'buy-rep' ? hedgeLimit : 0n)
	const tokenBalance = balances?.tokens.get(game.token2.toLowerCase())
	const hasRequiredInventory = balances === undefined || tokenBalance === undefined ? undefined : balances.weth >= funding.token1 && tokenBalance >= funding.token2
	const tokenFundingValueWeth = best.quote.hedgeAmountRep === 0n ? 0n : (funding.token2 * hedgeLimitQuote + best.quote.hedgeAmountRep - 1n) / best.quote.hedgeAmountRep
	const capitalAtRiskWeth = funding.token1 + tokenFundingValueWeth
	const profitable = meetsProfitThreshold(best.quote, config.minimumProfitWeth, config.minimumProfitBps)
	const decision = opportunityDecision({
		account: wallet?.account.address,
		currentReporter: game.currentReporter,
		execute: config.execute,
		executionReady,
		hasRequiredInventory,
		paused,
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
		requiredToken: formatTokenAmount(funding.token2, tokenMetadata.decimals),
		requiredWeth: decimalWeth(funding.token1),
		token: game.token2,
		tokenSymbol: tokenMetadata.symbol,
		timeRemaining: timeRemaining.toString(),
		windowUnit: timeType ? 'seconds' : 'blocks',
	} satisfies OpportunitySnapshot
	const projectedLifecycleGas = [config.riskLimits.lifecycleGasReserveWeth, gasPrice * (BigInt(game.callbackGasLimit) + 1_050_000n)].reduce((maximum, value) => (value > maximum ? value : maximum), 0n)
	const candidate = decision === 'eligible' ? { capitalAtRiskWeth, opportunity, pool: best.pool, projectedGasCostWeth: gasPrice * 1_200_000n + projectedLifecycleGas, quote: best.quote, report } : undefined
	return { candidate, opportunity }
}

type ExecutionLockManager = {
	acquireSigner: (account: Address) => Promise<ExclusiveProcessLock>
	release: (lock: ExclusiveProcessLock) => Promise<void>
}

async function runOperator(config: Configuration, lockManager: ExecutionLockManager | undefined, initialSignerLock: ExclusiveProcessLock | undefined) {
	if (config.lookbackBlocks < 0n) throw new Error('lookback-blocks must be a non-negative integer')
	if (!Number.isSafeInteger(config.uiPort) || config.uiPort < 1 || config.uiPort > 65_535) throw new Error('ui-port must be an integer from 1 to 65535')
	if (config.ui && config.once) throw new Error('--ui cannot be combined with --once')
	if (config.execute && config.privateKey === undefined && !config.ui) throw new Error('--execute requires PRIVATE_KEY unless --ui is used to unlock the signer')
	if (config.execute && lockManager === undefined) throw new Error('Execution requires exclusive journal and signer lock management')
	if (config.execute) await ensureExecutionHistoryWritable(config.historyFile)
	let positions = await loadPositionJournal(config.positionFile)
	if (config.execute) await savePositionJournal(config.positionFile, positions)
	const createClient = (rpcUrl = config.connectivity.readRpcUrl) =>
		createPublicClient({
			chain: config.network.chain,
			transport: http(rpcUrl),
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
	let readClients = [client, ...config.quorumRpcUrls.map(url => createClient(url))]
	let wallet = createWallet()
	if (config.execute) {
		const observedChainIds = await Promise.all(readClients.map(readClient => readClient.getChainId()))
		quorumValue(
			'configured chain id',
			observedChainIds.map((value, index) => ({ endpoint: index === 0 ? endpointLabel(config.connectivity.readRpcUrl) : endpointLabel(config.quorumRpcUrls[index - 1] ?? ''), value })),
		)
		if (observedChainIds.some(chainId => chainId !== config.network.chain.id)) throw new Error(`Read RPC quorum must use ${config.network.name} chain ${config.network.chain.id.toString()}`)
	}
	let coordinatorPolicies = await loadCoordinatorPolicies(client, config)
	await authenticateConfiguredDeployments(readClients, config)
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
		positions,
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
	let activeSignerLock = initialSignerLock
	let pendingSignerLock: ExclusiveProcessLock | undefined
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
						const keepsActiveSigner = candidate.address !== undefined && fixedState.wallet !== undefined && candidate.address.toLowerCase() === fixedState.wallet.toLowerCase()
						const keepsPendingSigner = candidate.address !== undefined && fixedState.queuedWallet !== undefined && fixedState.queuedWallet !== null && candidate.address.toLowerCase() === fixedState.queuedWallet.toLowerCase() && pendingSignerLock !== undefined
						let acquiredSignerLock: ExclusiveProcessLock | undefined
						if (config.execute && candidate.address !== undefined && !keepsActiveSigner && !keepsPendingSigner) {
							if (lockManager === undefined) throw new Error('Execution signer lock management is unavailable')
							acquiredSignerLock = await lockManager.acquireSigner(candidate.address)
						}
						let persistedPrivateKey = config.persistedPrivateKey
						if (candidate.privateKey === undefined) persistedPrivateKey = undefined
						else if (rememberSigner) persistedPrivateKey = candidate.privateKey
						try {
							await persistSettings({ ...currentPersistedSettings(), privateKey: persistedPrivateKey })
						} catch (error) {
							if (acquiredSignerLock !== undefined && lockManager !== undefined) await lockManager.release(acquiredSignerLock)
							throw error
						}
						let nextPendingSignerLock = acquiredSignerLock
						if (keepsActiveSigner) nextPendingSignerLock = undefined
						else if (keepsPendingSigner) nextPendingSignerLock = pendingSignerLock
						if (pendingSignerLock !== undefined && pendingSignerLock !== nextPendingSignerLock && lockManager !== undefined) await lockManager.release(pendingSignerLock)
						pendingSignerLock = nextPendingSignerLock
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
					if (config.execute && next.mode !== 'private') throw new Error('Execution mode requires private bundle submission; public mempool submission is disabled for fund safety')
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
						const token = getAddress(address)
						if (!authenticatedExecutionToken(config, token)) throw new Error(`Execution token ${token} is not authenticated by the deployment manifest`)
						parsedAddresses.push(token)
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
	const persistPosition = async (position: PositionRecord) => {
		positions = [position, ...positions.filter(existing => existing.reportId !== position.reportId)]
		await savePositionJournal(config.positionFile, positions)
		state.positions = positions
	}
	let cachedLogs: TransactionLog[] = []
	const catalogForScan = createTokenCatalogTracker((configured, observed) => discoverAugurRepTokens(client, config.network.chain.id, configured, observed))
	recordOperation(state, {
		category: 'scan',
		details: config.coordinatorAddresses.length === 0 ? undefined : `Approved coordinators: ${config.coordinatorAddresses.join(', ')}`,
		level: 'info',
		message: 'Operator started',
		reason: `${config.network.name} chain ${config.network.chain.id.toString()}`,
		reportId: undefined,
	})
	console.log(`network=${config.network.name} chain=${config.network.chain.id.toString()} mode=${config.execute ? 'execute' : 'dry-run'} submission=${config.submission.mode} oracle=${config.openOracle} coordinators=${config.coordinatorAddresses.join(',') || 'none'} rpc=${endpointLabel(config.connectivity.readRpcUrl)}`)
	try {
		await pollUntilStopped(
			async () => {
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
					readClients = [client, ...config.quorumRpcUrls.map(url => createClient(url))]
					wallet = createWallet()
					coordinatorPolicies = await loadCoordinatorPolicies(client, config)
					await authenticateConfiguredDeployments(readClients, config)
				}
				if (signerUpdatePending) {
					const nextSignerLock = pendingPrivateKey === undefined ? undefined : (pendingSignerLock ?? activeSignerLock)
					if (config.execute && pendingPrivateKey !== undefined && nextSignerLock === undefined) throw new Error('Queued execution signer does not hold an exclusive process lock')
					const previousSignerLock = activeSignerLock
					activeSignerLock = nextSignerLock
					pendingSignerLock = undefined
					config.privateKey = pendingPrivateKey
					wallet = createWallet()
					fixedState.wallet = wallet?.account.address
					fixedState.queuedWallet = undefined
					clearWalletDerivedState(state)
					signerUpdatePending = false
					if (previousSignerLock !== undefined && previousSignerLock !== activeSignerLock && lockManager !== undefined) await lockManager.release(previousSignerLock)
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
				const observedChainId = await client.getChainId()
				if (observedChainId !== config.network.chain.id) throw new Error(`Read RPC chain mismatch: expected ${config.network.chain.id.toString()}, received ${observedChainId.toString()}`)
				const block = await client.getBlock()
				const blockNumber = block.number
				if (blockNumber === undefined) throw new Error('Latest block is missing its number')
				const blockHash = block.hash
				if (blockHash === undefined) throw new Error('Latest block is missing its hash')
				let lifecycleProcessed = false
				if (config.execute && wallet !== undefined) {
					for (const position of positions.filter(candidate => candidate.status !== 'closed' && candidate.withdrawnWeth === '0' && candidate.withdrawnToken === '0')) {
						try {
							const result = await processPositionLifecycle(client, readClients, wallet, config, position, blockNumber, persistPosition)
							if (result === 'processed') {
								lifecycleProcessed = true
								recordOperation(state, {
									category: 'transaction',
									details: `withdrawn=${state.positions.find(candidate => candidate.reportId === position.reportId)?.withdrawnWeth ?? 'unknown'} WETH`,
									level: 'info',
									message: 'Position lifecycle completed',
									reason: `Report ${position.reportId} was settled or replaced and withdrawn`,
									reportId: position.reportId,
								})
							}
						} catch (error) {
							const message = `Position ${position.reportId} lifecycle requires attention: ${errorMessage(error)}`
							nextError = message
							recordOperation(state, { category: 'transaction', details: undefined, level: 'error', message: 'Position lifecycle failed closed', reason: message, reportId: position.reportId })
						}
					}
				}
				if (lifecycleProcessed) {
					state.lastError = nextError
					state.lastPollAt = new Date().toISOString()
					state.status = operatorStatusAfterPause(state.paused, true, nextError !== undefined)
					return config.once
				}
				const executionReady = pendingHistory.length === 0 && nextError === undefined
				cursor ??= initialCursor(blockNumber, config.lookbackBlocks)
				const scanCursor = cursorForHeadScan(cursor, blockNumber, blockHash, REORG_OVERLAP_BLOCKS)
				if (scanCursor === undefined) {
					state.lastError = nextError
					state.status = operatorStatusAfterPause(state.paused, true, nextError !== undefined)
					state.blockNumber = blockNumber.toString()
					state.blockTimestamp = block.timestamp.toString()
					return config.once
				}
				const ranges = scanRanges(scanCursor, blockNumber, MAX_LOG_SCAN_RANGE)
				for (const range of ranges) {
					const logs = await client.getLogs({
						address: config.openOracle,
						fromBlock: range.fromBlock,
						toBlock: range.toBlock,
						topics: [[OPEN_ORACLE_REPORT_SUBMITTED_TOPIC, OPEN_ORACLE_REPORT_DISPUTED_TOPIC, OPEN_ORACLE_REPORT_SETTLED_TOPIC]],
					})
					cachedLogs = replaceOverlap(cachedLogs, logs, range.fromBlock, logBlockNumber, compareLogs)
					reports.clear()
					applyLogs(reports, cachedLogs)
					cachedLogs = retainReportsAndLogs(reports, cachedLogs, coordinatorPolicies, config.openOracle, range.toBlock)
				}
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
							const evaluated = await inspectReport(
								client,
								wallet,
								config,
								report.latest,
								pools,
								blockNumber,
								block.timestamp,
								gasPrice,
								balances?.raw,
								metadata,
								executionTokenAllowed(executionTokens, report.latest.game.token2) && authenticatedExecutionToken(config, report.latest.game.token2),
								executionReady,
								state.paused,
								coordinatorPolicies,
								(message, reason) => recordOperation(state, { category: 'decision', details: undefined, level: 'info', message, reason, reportId }),
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
								if (evaluated.candidate !== undefined) {
									const mismatch = candidateRiskMismatch(evaluated.candidate, positions, config.riskLimits)
									if (mismatch === undefined) candidates.push(evaluated.candidate)
									else {
										evaluated.opportunity.decision = 'risk-limit'
										recordOperation(state, { category: 'decision', details: undefined, level: 'warning', message: 'Risk limit blocked report', reason: mismatch, reportId: evaluated.opportunity.reportId })
									}
								}
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
							const record = await executeDispute(client, readClients, wallet, config, selected.report, selected.quote, selected.pool, metadata, () => state.paused, trackTransaction, persistPosition)
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
				const settledReportIds = new Set(
					[...reports.entries()]
						.filter(([, report]) => {
							const settlement = report.steps.findLast(step => step.event === 'settled')
							return report.settled && settlement !== undefined && blockNumber > BigInt(settlement.blockNumber) + REORG_OVERLAP_BLOCKS
						})
						.map(([id]) => id),
				)
				if (settledReportIds.size !== 0) {
					for (const id of settledReportIds) reports.delete(id)
					cachedLogs = cachedLogs.filter(log => !settledReportIds.has(reportId(log)))
				}
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

async function main() {
	if (process.argv.includes('--help') || process.argv.includes('-h')) {
		printHelp()
		return
	}
	const config = await loadConfiguration()
	if (!config.execute) {
		await runOperator(config, undefined, undefined)
		return
	}
	const heldLocks = new Set<ExclusiveProcessLock>()
	const hold = async (lockPromise: Promise<ExclusiveProcessLock>) => {
		const lock = await lockPromise
		heldLocks.add(lock)
		return lock
	}
	const release = async (lock: ExclusiveProcessLock) => {
		if (!heldLocks.delete(lock)) return
		await lock.release()
	}
	try {
		await hold(acquirePositionJournalLock(config.positionFile))
		const initialSignerLock = config.privateKey === undefined ? undefined : await hold(acquireExecutionSignerLock(config.network.chain.id, privateKeyToAccount(config.privateKey).address))
		await runOperator(
			config,
			{
				acquireSigner: account => hold(acquireExecutionSignerLock(config.network.chain.id, account)),
				release,
			},
			initialSignerLock,
		)
	} finally {
		for (const lock of [...heldLocks].reverse()) await release(lock)
	}
}

main().catch(error => {
	console.error(errorMessage(error))
	process.exitCode = 1
})

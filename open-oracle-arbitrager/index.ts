#!/usr/bin/env bun

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
	parseUnits,
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
import { advanceCursorAfterSuccessfulHead, assertFinalityAnchor, cursorForHeadScan, initialCursor, operatorStatusAfterPause, scanRanges, withFinalityAnchor, type SyncCursor } from './block-sync.js'
import { checkConnectivity, checkSubmissionEndpoints, endpointLabel, updateConnectivityEndpointChecks, updateSubmissionEndpointChecks, validateConnectivitySettings, type ConnectivitySettings } from './connectivity.js'
import { applyStrategy, loadConfiguration, mutableStrategy, printHelp, type Configuration } from './configuration.js'
import { startDashboardServer } from './dashboard-server.js'
import { authenticateDeploymentManifest } from './deployment-auth.js'
import {
	assertCanonicalExecutionSnapshot,
	assertReceiptSnapshotBlockHash,
	canonicalBlockHashWithQuorum,
	executionFailureDecision,
	executionTokenAllowed,
	finalizeSubmittedLifecycleAttempt,
	fundingTransactionPlan,
	guardedTransactionSubmission,
	guardedRiskSubmission,
	isExecutionPausedError,
	journaledSubmission,
	lifecycleAllowanceMismatch,
	lifecycleLastValidBlockNumber,
	lifecycleAttemptNeedsRecovery,
	lifecycleWithdrawalMismatch,
	openOracleDisputeTiming,
	opportunityDecision,
	attemptHasFinality,
	privateEntryRecoveryIsConfirmed,
	receiptGasExpendituresWithQuorum,
	recoveredTransactionIntentMismatch,
	selectBestExecution,
	simulateTrackedPrivateBundle,
	trackPrivateBundleReceiptStatuses,
	transactionHashBySenderNonceWithQuorum,
	transactionIntentWithQuorum,
	transactionReceiptsOrMissingWithQuorum,
	transactionReceiptsWithQuorum,
} from './execution-orchestration.js'
import { coordinatorPolicySafetyMismatch, gamePolicyMismatch, retainedReportIds, type CoordinatorGamePolicy } from './game-policy.js'
import {
	appendExecutionHistoryIfMissing,
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
} from './operator-state.js'
import { applyLogs, compareLogs, logBlockNumber, reportId, type ActiveReport } from './oracle-log-state.js'
import { appendPriceHistory, availableTokenBalances, createTokenCatalogTracker, discoverAugurRepTokens, formatTokenAmount, loadPriceHistory, loadTokenMarkets, missingPricePoints, pricePoints } from './market-monitor.js'
import { expectedWithdrawalToken2, hedgedProfitBeforeGasWeth, realizedNetProfitWeth, recoveredHedgedProfitBeforeGasWeth } from './position-accounting.js'
import { acquireExecutionSignerLock, acquirePositionJournalLock, loadPositionJournal, savePositionJournal, type DurableTransactionIntent, type ExclusiveProcessLock, type PositionRecord } from './position-store.js'
import { quorumValue } from './read-quorum.js'
import { bestSuccessful, compactFinalityWindow, pollUntilStopped, replaceOverlap } from './resilience.js'
import { adjustedNetProfitWeth, positionConsumesRisk, positionRiskLimitMismatch, projectedLifecycleGasReserveWeth, type RiskLimits } from './safety-controls.js'
import type { NetworkConfiguration } from './network.js'
import { saveOperatorSettings, type PersistedOperatorSettings } from './settings-store.js'
import { signerCandidate } from './signer.js'
import {
	calculateFee,
	calculateNextAmount1,
	calculateTrackedNetProfitEth,
	deriveTokenToSwap,
	evaluateBuyRep,
	evaluateSellRep,
	executorFunding,
	fundedCapitalAtRiskWeth,
	hasFreshSubmissionWindow,
	hedgeSlippageReserveWeth,
	hedgeWethLimit,
	isSelfReport,
	meetsProfitThreshold,
	spotTwapDeviationWithinLimit,
	type ArbitrageQuote,
} from './strategy.js'
import { prepareSignedTransaction, simulateSignedBundleEveryRelay, SubmissionFailure, submitSignedBundle, validateSubmissionSettings, type SubmissionSettings, type SubmissionTargetResult } from './transaction-submission.js'
import { receiptGasCost, submitContractTransaction, trackedActivity, transactionLogLevel, waitForTrackedTransaction, type TrackTransaction } from './transaction-tracker.js'

const FEES = [100, 500, 3000, 10000] as const
const REORG_OVERLAP_BLOCKS = 12n
const MAX_LOG_SCAN_RANGE = 100n
const MAX_UNTRUSTED_DRY_RUN_REPORTS = 256

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
type RecoveryConfiguration = Pick<Configuration, 'connectivity' | 'executor' | 'openOracle' | 'quorumRpcUrls'> & {
	network: Pick<Configuration['network'], 'weth'>
	submission: Pick<Configuration['submission'], 'mode'>
}

function dateFromBlockTimestamp(timestamp: bigint) {
	const milliseconds = timestamp * 1_000n
	if (milliseconds < 0n || milliseconds > 8_640_000_000_000_000n) throw new Error('Canonical block timestamp is outside the supported date range')
	return new Date(Number(milliseconds))
}

async function confirmedGasExpenditures(readClients: readonly ReadClient[], config: Pick<Configuration, 'connectivity' | 'quorumRpcUrls'>, label: string, receipts: Parameters<typeof receiptGasExpendituresWithQuorum>[3]) {
	const expenditures = await receiptGasExpendituresWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], label, receipts)
	return expenditures.map(expenditure => ({
		costEth: decimalWeth(expenditure.costWei),
		minedAt: expenditure.minedAt,
		transactionHash: expenditure.transactionHash,
	}))
}

function durableTransactionIntent(transaction: { input: Hex; to?: Address | null | undefined; value: bigint }): DurableTransactionIntent {
	if (transaction.to === undefined || transaction.to === null) throw new Error('Contract execution transaction is missing its destination')
	return {
		data: transaction.input,
		to: transaction.to,
		value: transaction.value.toString(),
	}
}

async function recoveredTransactionIntentMismatchWithQuorum(readClients: readonly ReadClient[], config: Pick<Configuration, 'connectivity' | 'quorumRpcUrls'>, label: string, transactionHash: Hex, account: Address, nonce: string | undefined, expected: DurableTransactionIntent | undefined) {
	const actual = await transactionIntentWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], label, transactionHash)
	return recoveredTransactionIntentMismatch(expected, actual, account, nonce)
}

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

function requiredHash(value: unknown, description: string): Hex {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(value)) throw new Error(`${description} is not a 32-byte RPC hash`)
	return value as Hex
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : String(error)
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

export function lifecycleExecutionFromLogs(logs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[], executor: Address) {
	for (const log of logs) {
		if (log.address.toLowerCase() !== executor.toLowerCase()) continue
		try {
			const decoded = decodeEventLog({ abi: openOracleArbitrageExecutorAbi, data: log.data, topics: log.topics })
			if (decoded.eventName !== 'LifecycleExecuted') continue
			return {
				account: decoded.args.account,
				amount1: decoded.args.amount1,
				amount2: decoded.args.amount2,
				reportId: decoded.args.reportId,
				settlerReward: decoded.args.settlerReward,
				token1: decoded.args.token1,
				token2: decoded.args.token2,
			}
		} catch (error) {
			void error
		}
	}
	throw new Error('Confirmed executor transaction did not emit LifecycleExecuted')
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
	return positionRiskLimitMismatch({ capitalAtRiskWeth: candidate.capitalAtRiskWeth, positions, projectedGasCostWeth: candidate.projectedGasCostWeth }, limits, now)
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
	const lifecycleGasReserveWeth = projectedLifecycleGasReserveWeth({
		callbackGasLimit: BigInt(game.callbackGasLimit),
		configuredReserveWeth: config.riskLimits.lifecycleGasReserveWeth,
		gasPrice,
		submissionMode: config.submission.mode,
	})
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

async function executionReadQuorum(clients: readonly ReadClient[], config: Configuration, report: OpenOracleStatePreimage, pool: Pool, blockNumber: bigint, account: Address) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const executor = config.executor
	if (executor === undefined) throw new Error('Execution quorum requires the authenticated executor')
	const game = report.game
	const newAmount1 = calculateNextAmount1(game)
	const repWithFees = game.currentAmount2 + calculateFee(game.currentAmount2, game.feePercentage) + calculateFee(game.currentAmount2, game.protocolFee)
	const observations = await Promise.all(
		clients.map(async (readClient, index) => {
			const [block, stateHash, refreshedPool, replacementAmount2, sellHedgeQuote, buyHedgeQuote, nonce, eth, weth, token, allowance1, allowance2, internalAllowance1, internalAllowance2] = await Promise.all([
				readClient.getBlock({ blockNumber }),
				readContractAtBlock(readClient.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'oracleGame', args: [report.helper.reportId] }, blockNumber),
				loadPool(readClient, pool.address, pool.token, pool.fee, config.twapSeconds, blockNumber),
				quoteInput(readClient, config.network.quoter, config.network.weth, pool.token, newAmount1, pool.fee, blockNumber),
				quoteInput(readClient, config.network.quoter, pool.token, config.network.weth, game.currentAmount2, pool.fee, blockNumber),
				quoteOutput(readClient, config.network.quoter, config.network.weth, pool.token, repWithFees, pool.fee, blockNumber),
				getTransactionCountAtBlock(readClient.transport, { address: account, blockNumber }),
				getBalanceAtBlock(readClient.transport, { address: account, blockNumber }),
				readContractAtBlock(readClient.transport, { address: config.network.weth, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
				readContractAtBlock(readClient.transport, { address: game.token2, abi: erc20Abi, functionName: 'balanceOf', args: [account] }, blockNumber),
				readContractAtBlock(readClient.transport, { address: game.token1, abi: erc20Abi, functionName: 'allowance', args: [account, executor] }, blockNumber),
				readContractAtBlock(readClient.transport, { address: game.token2, abi: erc20Abi, functionName: 'allowance', args: [account, executor] }, blockNumber),
				readContractAtBlock(readClient.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'internalAllowance', args: [account, executor, game.token1] }, blockNumber),
				readContractAtBlock(readClient.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'internalAllowance', args: [account, executor, game.token2] }, blockNumber),
			])
			if (block.hash == null || refreshedPool === undefined) throw new Error('RPC quorum snapshot is missing a canonical block or active pool')
			return {
				endpoint: endpointLabel(endpoints[index] ?? ''),
				value: {
					allowance1: requiredBigint(allowance1, 'Executor token1 allowance'),
					allowance2: requiredBigint(allowance2, 'Executor token2 allowance'),
					internalAllowance1: requiredBigint(internalAllowance1, 'Executor internal token1 allowance'),
					internalAllowance2: requiredBigint(internalAllowance2, 'Executor internal token2 allowance'),
					baseFeePerGas: block.baseFeePerGas ?? 0n,
					blockHash: block.hash,
					blockTimestamp: block.timestamp,
					buyHedgeQuote,
					eth: requiredBigint(eth, 'Execution account ETH balance'),
					nonce,
					poolLiquidity: refreshedPool.liquidity,
					poolSpotTick: refreshedPool.spotTick,
					poolTwapTick: refreshedPool.twapTick,
					replacementAmount2,
					sellHedgeQuote,
					stateHash: requiredHash(stateHash, 'OpenOracle report state'),
					token: requiredBigint(token, 'Execution account report-token balance'),
					weth: requiredBigint(weth, 'Execution account WETH balance'),
				},
			}
		}),
	)
	return quorumValue(`execution snapshot at block ${blockNumber.toString()}`, observations)
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

async function confirmedNonceWithQuorum(clients: readonly ReadClient[], config: Pick<Configuration, 'connectivity' | 'quorumRpcUrls'>, account: Address, blockNumber: bigint) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const observations = await Promise.all(
		clients.map(async (client, index) => ({
			endpoint: endpointLabel(endpoints[index] ?? ''),
			value: await client.getTransactionCount({ address: account, blockNumber }),
		})),
	)
	return quorumValue(`confirmed account nonce at block ${blockNumber.toString()}`, observations)
}

async function currentBlockNumberWithQuorum(clients: readonly ReadClient[], config: Configuration, label: string) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const observations = await Promise.all(
		clients.map(async (client, index) => ({
			endpoint: endpointLabel(endpoints[index] ?? ''),
			value: await client.getBlockNumber(),
		})),
	)
	return quorumValue(label, observations)
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

async function lifecycleBalancesWithQuorum(clients: readonly ReadClient[], config: RecoveryConfiguration, account: Address, token: Address, blockNumber: bigint) {
	const executor = config.executor
	if (executor === undefined) throw new Error('Lifecycle balance reads require the authenticated executor')
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const observations = await Promise.all(
		clients.map(async (client, index) => {
			const [block, rawHolderWeth, rawHolderToken, rawAllowanceWeth, rawAllowanceToken, rawTokenDecimals] = await Promise.all([
				client.getBlock({ blockNumber }),
				readContractAtBlock(client.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'tokenHolder', args: [account, config.network.weth] }, blockNumber),
				readContractAtBlock(client.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'tokenHolder', args: [account, token] }, blockNumber),
				readContractAtBlock(client.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'internalAllowance', args: [account, executor, config.network.weth] }, blockNumber),
				readContractAtBlock(client.transport, { address: config.openOracle, abi: openOracleAbi, functionName: 'internalAllowance', args: [account, executor, token] }, blockNumber),
				readContractAtBlock(client.transport, { address: token, abi: erc20Abi, functionName: 'decimals' }, blockNumber),
			])
			if (block.hash === null || block.hash === undefined) throw new Error(`Position lifecycle block ${blockNumber.toString()} is missing its canonical hash`)
			return {
				endpoint: endpointLabel(endpoints[index] ?? ''),
				value: {
					blockHash: block.hash,
					blockTimestamp: block.timestamp,
					internalAllowanceToken: requiredBigint(rawAllowanceToken, 'OpenOracle token internal allowance'),
					internalAllowanceWeth: requiredBigint(rawAllowanceWeth, 'OpenOracle WETH internal allowance'),
					holderToken: requiredBigint(rawHolderToken, 'OpenOracle token holder balance'),
					holderWeth: requiredBigint(rawHolderWeth, 'OpenOracle WETH holder balance'),
					tokenDecimals: requiredBigint(rawTokenDecimals, 'Position token decimals'),
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

async function executeDispute(
	client: ReadClient,
	readClients: readonly ReadClient[],
	wallet: WriteClient,
	config: Configuration,
	report: OpenOracleStatePreimage,
	quote: ArbitrageQuote,
	pool: Pool,
	tokenMetadata: { decimals: number; symbol: string },
	positions: readonly PositionRecord[],
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
	if (quoteBlock.number === undefined || quoteBlock.hash == null) throw new Error('Quote block is missing its canonical identity')
	const quoteBlockNumber = quoteBlock.number
	const signMessage = account.signMessage
	const signTransaction = account.signTransaction
	const executionSnapshot = await executionReadQuorum(readClients, config, report, pool, quoteBlockNumber, account.address)
	assertCanonicalExecutionSnapshot({
		expectedReportStateHash: hashOpenOracleStatePreimage(report),
		localBlockHash: quoteBlock.hash,
		quorumBlockHash: executionSnapshot.blockHash,
		quorumReportStateHash: executionSnapshot.stateHash,
	})
	const refreshedPool = {
		...pool,
		liquidity: executionSnapshot.poolLiquidity,
		spotTick: executionSnapshot.poolSpotTick,
		twapTick: executionSnapshot.poolTwapTick,
	}
	if (!spotTwapDeviationWithinLimit(refreshedPool.spotTick, refreshedPool.twapTick, config.maxSpotTwapTicks)) throw new Error('Selected pool failed the final spot/TWAP check')
	const gasPrice = executionSnapshot.baseFeePerGas * 2n + 2n * 10n ** 9n
	const lifecycleGasReserveWeth = projectedLifecycleGasReserveWeth({
		callbackGasLimit: BigInt(game.callbackGasLimit),
		configuredReserveWeth: config.riskLimits.lifecycleGasReserveWeth,
		gasPrice,
		submissionMode: config.submission.mode,
	})
	const entryGasCostWeth = gasPrice * 1_200_000n
	const refreshedQuote = selectBestExecution(
		[safetyAdjustedQuote(evaluateSellRep(game, executionSnapshot.sellHedgeQuote, 0n), entryGasCostWeth, lifecycleGasReserveWeth, config), safetyAdjustedQuote(evaluateBuyRep(game, executionSnapshot.buyHedgeQuote, 0n), entryGasCostWeth, lifecycleGasReserveWeth, config)],
		candidate => candidate.netProfitWeth,
	)
	if (refreshedQuote === undefined) throw new Error('Canonical execution snapshot did not produce an arbitrage quote')
	if (refreshedQuote.direction !== quote.direction) throw new Error('Best arbitrage direction changed before submission')
	const newAmount2 = executionSnapshot.replacementAmount2
	const tokenToSwap = deriveTokenToSwap(game, newAmount1, newAmount2)
	if (tokenToSwap.toLowerCase() !== refreshedQuote.tokenToSwap.toLowerCase()) throw new Error('Final replacement ratio does not derive the selected arbitrage direction')
	const hedgeLimitQuote = refreshedQuote.direction === 'sell-rep' ? refreshedQuote.grossProceedsWeth : refreshedQuote.hedgeCostWeth
	const hedgeLimit = hedgeWethLimit(refreshedQuote.direction, hedgeLimitQuote, config.maxHedgeSlippageBps)
	const funding = executorFunding(game, newAmount1, newAmount2, refreshedQuote.direction === 'buy-rep' ? hedgeLimit : 0n)
	if (executionSnapshot.weth < funding.token1 || executionSnapshot.token < funding.token2) throw new Error('Canonical execution snapshot no longer has the inventory required by the signed bundle')
	const lockedToken = expectedWithdrawalToken2(refreshedQuote.direction, game.currentAmount2, newAmount2)
	const internalAllowanceError = lifecycleAllowanceMismatch({ token1: executionSnapshot.internalAllowance1, token2: executionSnapshot.internalAllowance2 }, { token1: newAmount1, token2: lockedToken })
	if (internalAllowanceError !== undefined) throw new Error(internalAllowanceError)
	const timeType = (game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) !== 0n
	const currentTime = timeType ? executionSnapshot.blockTimestamp : quoteBlockNumber
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
	fundingTransactionPlan({ token1: executionSnapshot.allowance1, token2: executionSnapshot.allowance2 }, funding)
	const request = {
		address: executor,
		abi: openOracleArbitrageExecutorAbi,
		functionName: 'hedgeAndDispute',
		args: [
			{
				expectedParentBlockHash: executionSnapshot.blockHash,
				hedgeWethLimit: hedgeLimit,
				newAmount1,
				newAmount2,
				openOracle: config.openOracle,
				poolFee: refreshedPool.fee,
				router,
				swapDeadline: executionSnapshot.blockTimestamp + 300n,
			},
			getOpenOracleGameTuple(game),
			getOpenOracleHelperTuple(report.helper),
			openOracleDisputeTiming(quoteBlockNumber, executionSnapshot.blockTimestamp),
		],
	} as const
	const targetBlockNumber = quoteBlockNumber + 1n
	const startingNonce = await pendingNonceWithQuorum(readClients, config, account.address)
	const executionSigned = await prepareSignedTransaction({
		baseFeePerGas: executionSnapshot.baseFeePerGas,
		blockNumber: quoteBlockNumber,
		chainId: config.network.chain.id,
		data: encodeFunctionData(request),
		from: account.address,
		gasEstimate: 1_200_000n,
		lastValidBlockNumber: targetBlockNumber,
		nonce: startingNonce,
		signTransaction,
		to: executor,
	})
	const signedTransactions = [{ kind: 'dispute' as const, signed: executionSigned, token: undefined, tokenSymbol: undefined }]
	const capitalAtRiskWeth = fundedCapitalAtRiskWeth(funding, refreshedQuote.hedgeAmountRep, hedgeLimitQuote, hedgeLimit)
	let stagedPosition = {
		account: account.address,
		actualEntryGasCostEth: '0',
		capitalAtRiskWeth: decimalWeth(capitalAtRiskWeth),
		closedAt: undefined,
		direction: refreshedQuote.direction,
		entrySubmissionBlockNumber: quoteBlockNumber.toString(),
		entrySubmissionMode: config.submission.mode,
		entryTransactionIntent: durableTransactionIntent(executionSigned.transaction),
		entryTransactionNonce: executionSigned.transaction.nonce.toString(),
		entryTransactionHash: executionSigned.hash,
		entryTransactionHashes: signedTransactions.map(transaction => transaction.signed.hash),
		executionIntent: {
			direction: refreshedQuote.direction,
			estimatedNetProfitWeth: decimalWeth(refreshedQuote.netProfitWeth),
			estimatedProfitBeforeGasEth: decimalWeth(refreshedQuote.profitBeforeGasWeth),
			pool: refreshedPool.address,
			poolFee: refreshedPool.fee,
			reportId,
			requiredToken: formatTokenAmount(funding.token2, tokenMetadata.decimals),
			requiredWeth: decimalWeth(funding.token1),
			token: game.token2,
			tokenSymbol: tokenMetadata.symbol,
		},
		expiredTransactionAttempts: [],
		gasExpenditures: [],
		historyOutbox: undefined,
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
		lockedToken: formatTokenAmount(lockedToken, tokenMetadata.decimals),
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
	let entryGasExpenditures: PositionRecord['gasExpenditures'] = []
	let receiptBlockNumber: bigint
	let executionHash = executionSigned.hash
	let executionLogs: readonly { address: Address; data: Hex; topics: readonly Hex[] }[] = []
	let quorumConfirmedPosition: PositionRecord | undefined
	if (config.submission.mode === 'public') {
		await wallet.simulateContract(request)
		if (!meetsProfitThreshold(refreshedQuote, config.minimumProfitWeth, config.minimumProfitBps)) throw new Error('Arbitrage no longer meets the profit threshold at submission')
		await guardedRiskSubmission(positionRiskLimitMismatch({ capitalAtRiskWeth, positions, projectedGasCostWeth: gasPrice * 1_200_000n + lifecycleGasReserveWeth }, config.riskLimits, dateFromBlockTimestamp(executionSnapshot.blockTimestamp)), () => persistPosition(stagedPosition))
		const submission = await submitContractTransaction(client, wallet, config, executionSigned, { estimatedNetProfitEth: decimalWeth(refreshedQuote.netProfitWeth), kind: 'dispute', reportId }, isPaused, track)
		const { receipt: observedReceipt, tracked } = await waitForTrackedTransaction(client, wallet, config, submission, track, replacement =>
			persistPosition({
				...stagedPosition,
				entryTransactionHash: replacement.transaction.hash,
				entryTransactionHashes: [replacement.transaction.hash],
				status: 'recovery-required',
			}),
		)
		const receiptPosition = {
			...stagedPosition,
			entryTransactionHash: observedReceipt.transactionHash,
			entryTransactionHashes: [observedReceipt.transactionHash],
			status: 'recovery-required' as const,
		}
		await persistPosition(receiptPosition)
		const receipts = await transactionReceiptsWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], `public entry ${reportId}`, [observedReceipt.transactionHash])
		const receipt = receipts[0]
		if (receipt === undefined) throw new Error('Public dispute receipt quorum is missing')
		actualGasCost = receiptGasCost(receipt)
		entryGasExpenditures = await confirmedGasExpenditures(readClients, config, `public entry ${reportId}`, [receipt])
		if (receipt.status !== 'success') {
			const closedAt = entryGasExpenditures[0]?.minedAt
			if (closedAt === undefined) throw new Error('Reverted public dispute gas timestamp is unavailable')
			await persistPosition({
				...receiptPosition,
				actualEntryGasCostEth: decimalWeth(actualGasCost),
				capitalAtRiskWeth: '0',
				closedAt,
				gasExpenditures: entryGasExpenditures,
				hedgedProfitBeforeGasEth: '0',
				lockedToken: '0',
				lockedWeth: '0',
				realizedNetProfitEth: decimalSignedEth(-actualGasCost),
				status: 'closed',
			})
			throw new Error(`Dispute transaction reverted: ${receipt.transactionHash}`)
		}
		const transactionIntentMismatch = await recoveredTransactionIntentMismatchWithQuorum(readClients, config, `public entry ${reportId}`, receipt.transactionHash, receiptPosition.account, receiptPosition.entryTransactionNonce, receiptPosition.entryTransactionIntent)
		if (transactionIntentMismatch !== undefined) {
			await persistPosition({
				...receiptPosition,
				actualEntryGasCostEth: decimalWeth(actualGasCost),
				gasExpenditures: entryGasExpenditures,
				status: 'recovery-required',
			})
			throw new Error(`Public dispute replacement failed intent authentication: ${transactionIntentMismatch}`)
		}
		let publicHedgeExecution: ReturnType<typeof hedgeExecutionFromLogs> | undefined
		try {
			publicHedgeExecution = hedgeExecutionFromLogs(receipt.logs, executor)
		} catch (error) {
			if (!(error instanceof Error) || error.message !== 'Confirmed executor transaction did not emit HedgeAndDisputeExecuted') throw error
			publicHedgeExecution = undefined
		}
		if (publicHedgeExecution === undefined || publicHedgeExecution.account.toLowerCase() !== account.address.toLowerCase() || publicHedgeExecution.reportId !== report.helper.reportId) {
			await persistPosition({
				...receiptPosition,
				actualEntryGasCostEth: decimalWeth(actualGasCost),
				gasExpenditures: entryGasExpenditures,
				status: 'recovery-required',
			})
			throw new Error(`Public dispute was replaced by a transaction without the expected executor event: ${receipt.transactionHash}`)
		}
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
		const relaySimulations = await simulateTrackedPrivateBundle(
			tracked,
			() =>
				simulateSignedBundleEveryRelay({
					address: account.address,
					minimumSuccessfulRelays: config.submission.minimumRelaySuccesses,
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
		const totalGasUsed = relaySimulations.successful.reduce((maximum, result) => (result.simulation.totalGasUsed > maximum ? result.simulation.totalGasUsed : maximum), 0n)
		const simulatedQuote = safetyAdjustedQuote(refreshedQuote, totalGasUsed * gasPrice, lifecycleGasReserveWeth, config)
		const simulatedNetProfit = simulatedQuote.netProfitWeth
		if (!meetsProfitThreshold(simulatedQuote, config.minimumProfitWeth, config.minimumProfitBps)) {
			const error = new Error('Simulated bundle no longer meets the profit threshold')
			for (const transaction of tracked) track(trackedActivity({ ...transaction, failedTargets: [{ error: error.message, target: 'local profitability check' }] }, 'submission-failed'))
			throw error
		}
		tracked = tracked.map(transaction => ({
			...transaction,
			estimatedNetProfitEth: transaction.kind === 'dispute' ? decimalWeth(simulatedNetProfit) : undefined,
		}))
		stagedPosition = {
			...stagedPosition,
			executionIntent: {
				...stagedPosition.executionIntent,
				estimatedNetProfitWeth: decimalWeth(simulatedNetProfit),
			},
		}
		let submission
		try {
			submission = await guardedTransactionSubmission(
				isPaused,
				async () => {
					if ((await currentBlockNumberWithQuorum(readClients, config, 'execution submission head')) !== quoteBlockNumber) throw new Error('Bundle quote expired before submission')
					const canonicalHash = await canonicalBlockHashWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], 'execution submission', quoteBlockNumber)
					if (canonicalHash.toLowerCase() !== executionSnapshot.blockHash.toLowerCase()) throw new Error('Bundle canonical parent changed before submission')
				},
				() =>
					guardedRiskSubmission(positionRiskLimitMismatch({ capitalAtRiskWeth, positions, projectedGasCostWeth: totalGasUsed * gasPrice + lifecycleGasReserveWeth }, config.riskLimits, dateFromBlockTimestamp(executionSnapshot.blockTimestamp)), () =>
						journaledSubmission(
							() => persistPosition(stagedPosition),
							() =>
								submitSignedBundle({
									address: account.address,
									relayUrls: relaySimulations.successful.map(result => result.relayUrl),
									signMessage,
									targetBlockNumber,
									transactions: serializedTransactions,
								}),
						),
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
		let recoveredEntry: Awaited<ReturnType<typeof recoverPendingEntryWithQuorum>>
		try {
			recoveredEntry = await recoverPendingEntryWithQuorum(readClients, config, stagedPosition, tokenMetadata.decimals, targetBlockNumber)
		} catch (error) {
			for (const transaction of pending) track(trackedActivity(transaction, 'confirmation-unknown'))
			throw new Error(`Atomic bundle receipt quorum failed: ${errorMessage(error)}`)
		}
		const confirmedReceipts = recoveredEntry.receipts
		const entryConfirmed = trackPrivateBundleReceiptStatuses(pending, confirmedReceipts, targetBlockNumber, (transaction, status, receipt) => {
			if (receipt === undefined) throw new Error('Quorum-confirmed receipt is missing')
			track(trackedActivity(transaction, status, decimalWeth(receiptGasCost(receipt)), receipt.transactionHash))
		})
		quorumConfirmedPosition = recoveredEntry.position
		actualGasCost = confirmedReceipts.reduce((total, receipt) => total + receiptGasCost(receipt), 0n)
		if (!entryConfirmed || !privateEntryRecoveryIsConfirmed(recoveredEntry.position)) {
			await persistPosition(recoveredEntry.position)
			throw new Error(`Atomic bundle transaction reverted: ${recoveredEntry.position.entryTransactionHash}`)
		}
		const executorReceipt = confirmedReceipts.at(-1)
		if (executorReceipt === undefined) throw new Error('Executor receipt is missing from the bundle')
		receiptBlockNumber = executorReceipt.blockNumber
		executionHash = executorReceipt.transactionHash
		executionLogs = executorReceipt.logs
		const trackedNetProfitEth = decimalSignedEth(calculateTrackedNetProfitEth(refreshedQuote.profitBeforeGasWeth, actualGasCost))
		for (const [index, transaction] of pending.entries()) {
			const receipt = confirmedReceipts[index]
			if (receipt === undefined) throw new Error('Bundle receipt order is incomplete')
			track(trackedActivity(transaction, 'confirmed', decimalWeth(receiptGasCost(receipt)), receipt.transactionHash, transaction.kind === 'dispute' ? trackedNetProfitEth : undefined))
		}
	}
	let confirmedPosition = quorumConfirmedPosition
	if (confirmedPosition === undefined) {
		const hedgeExecution = hedgeExecutionFromLogs(executionLogs, executor)
		if (hedgeExecution.reportId !== report.helper.reportId) throw new Error('Executor hedge event report id does not match the submitted report')
		const hedgedProfitBeforeGas = hedgedProfitBeforeGasWeth(refreshedQuote.direction, hedgeExecution.hedgeAmountWeth, game.currentAmount1, calculateFee(game.currentAmount1, game.feePercentage), calculateFee(game.currentAmount1, game.protocolFee))
		confirmedPosition = {
			...stagedPosition,
			actualEntryGasCostEth: decimalWeth(actualGasCost),
			entryTransactionHash: executionHash,
			entryTransactionHashes: [executionHash],
			gasExpenditures: entryGasExpenditures,
			hedgeAmountToken: formatTokenAmount(hedgeExecution.hedgeAmountToken2, tokenMetadata.decimals),
			hedgeWeth: decimalWeth(hedgeExecution.hedgeAmountWeth),
			hedgedProfitBeforeGasEth: decimalSignedEth(hedgedProfitBeforeGas),
			status: 'open',
		}
	}
	if (confirmedPosition === undefined) throw new Error('Confirmed position accounting is unavailable')
	const record = executionRecordForConfirmedPosition(confirmedPosition, receiptBlockNumber, executionHash)
	await persistPosition({ ...confirmedPosition, historyOutbox: record })
	console.log(`report=${report.helper.reportId.toString()} dispute=${executionHash}`)
	return record
}

function tokenDecimalsFromSnapshot(snapshot: { tokenDecimals: bigint }, reportId: string) {
	const tokenDecimals = Number(snapshot.tokenDecimals)
	if (!Number.isSafeInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 255) throw new Error(`Position ${reportId} token decimals are invalid`)
	return tokenDecimals
}

export function executionRecordForConfirmedPosition(position: PositionRecord, blockNumber: bigint, transactionHash: Hex): ExecutionRecord {
	const intent = position.executionIntent
	if (intent === undefined) throw new Error(`Position ${position.reportId} is missing its durable execution intent`)
	const executedAt = position.gasExpenditures.find(expenditure => expenditure.transactionHash.toLowerCase() === transactionHash.toLowerCase())?.minedAt ?? position.gasExpenditures.at(-1)?.minedAt
	if (executedAt === undefined) throw new Error(`Position ${position.reportId} is missing its confirmed execution timestamp`)
	return {
		...intent,
		actualGasCostEth: position.actualEntryGasCostEth,
		blockNumber: blockNumber.toString(),
		executedAt,
		trackedNetProfitEth: decimalSignedEth(calculateTrackedNetProfitEth(parseSignedDecimalEth(position.hedgedProfitBeforeGasEth), parseDecimalWeth(position.actualEntryGasCostEth))),
		transactionHash,
	}
}

export async function recoverPendingEntryWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, position: PositionRecord, tokenDecimals: number, expectedBlockNumber?: bigint | undefined) {
	const executor = config.executor
	if (executor === undefined) throw new Error('Pending entry recovery requires the authenticated executor')
	const journaledPrivateTargetBlockNumber = position.entrySubmissionMode === 'private' && position.entrySubmissionBlockNumber !== undefined ? BigInt(position.entrySubmissionBlockNumber) + 1n : undefined
	if (expectedBlockNumber !== undefined && journaledPrivateTargetBlockNumber !== undefined && expectedBlockNumber !== journaledPrivateTargetBlockNumber) {
		throw new Error('Private entry target block does not match the durable journal')
	}
	const privateTargetBlockNumber = expectedBlockNumber ?? journaledPrivateTargetBlockNumber
	const receipts = await transactionReceiptsWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], `pending entry ${position.reportId}`, position.entryTransactionHashes)
	const firstReceipt = receipts[0]
	const executorReceipt = receipts.at(-1)
	if (firstReceipt === undefined || executorReceipt === undefined) throw new Error('Entry bundle receipts are missing, reverted, or split across blocks')
	const publicEntry = position.entrySubmissionMode === 'public' && expectedBlockNumber === undefined && receipts.length === 1
	const atomicPrivateEntry = position.entrySubmissionMode === 'private' && privateTargetBlockNumber !== undefined && receipts.length === 1
	const invalidPrivateReceipt = atomicPrivateEntry
		? firstReceipt.status === 'success' && firstReceipt.blockNumber !== privateTargetBlockNumber
		: !publicEntry && receipts.some(receipt => receipt.status !== 'success' || receipt.blockNumber !== firstReceipt.blockNumber || receipt.blockHash.toLowerCase() !== firstReceipt.blockHash.toLowerCase() || (privateTargetBlockNumber !== undefined && receipt.blockNumber !== privateTargetBlockNumber))
	if (invalidPrivateReceipt) throw new Error('Entry bundle receipts are missing, reverted, or split across blocks')
	const canonicalReceiptBlockHash = await canonicalBlockHashWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], `pending entry ${position.reportId}`, firstReceipt.blockNumber)
	assertReceiptSnapshotBlockHash(firstReceipt.blockHash, canonicalReceiptBlockHash, 'Entry')
	for (const [index, receipt] of receipts.entries()) {
		const expectedHash = position.entryTransactionHashes[index]
		if (expectedHash === undefined || receipt.transactionHash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error('Entry bundle receipt hash does not match the durable journal')
	}
	const actualEntryGasCost = receipts.reduce((total, receipt) => total + receiptGasCost(receipt), 0n)
	const gasExpenditures = await confirmedGasExpenditures(readClients, config, `pending entry ${position.reportId}`, receipts)
	const transactionIntentMismatch =
		publicEntry && executorReceipt.status === 'success' ? await recoveredTransactionIntentMismatchWithQuorum(readClients, config, `pending public entry ${position.reportId}`, executorReceipt.transactionHash, position.account, position.entryTransactionNonce, position.entryTransactionIntent) : undefined
	if (transactionIntentMismatch !== undefined) {
		return {
			position: {
				...position,
				actualEntryGasCostEth: decimalWeth(actualEntryGasCost),
				entryTransactionHash: executorReceipt.transactionHash,
				gasExpenditures,
				status: 'recovery-required' as const,
			},
			receipts,
		}
	}
	let hedgeExecution: ReturnType<typeof hedgeExecutionFromLogs> | undefined
	try {
		hedgeExecution = hedgeExecutionFromLogs(executorReceipt.logs, executor)
	} catch (error) {
		if (!(error instanceof Error) || error.message !== 'Confirmed executor transaction did not emit HedgeAndDisputeExecuted') throw error
		if (!publicEntry && !(atomicPrivateEntry && executorReceipt.status === 'reverted')) throw new Error('Executor hedge event is missing from the durable entry receipt')
	}
	if (hedgeExecution === undefined || hedgeExecution.account.toLowerCase() !== position.account.toLowerCase() || hedgeExecution.reportId.toString() !== position.reportId) {
		if ((publicEntry || atomicPrivateEntry) && executorReceipt.status === 'reverted') {
			const closedAt = gasExpenditures.at(-1)?.minedAt
			if (closedAt === undefined) throw new Error('Recovered atomic entry gas timestamp is unavailable')
			return {
				position: {
					...position,
					actualEntryGasCostEth: decimalWeth(actualEntryGasCost),
					capitalAtRiskWeth: '0',
					closedAt,
					entryTransactionHash: executorReceipt.transactionHash,
					gasExpenditures,
					hedgedProfitBeforeGasEth: '0',
					lockedToken: '0',
					lockedWeth: '0',
					realizedNetProfitEth: decimalSignedEth(-actualEntryGasCost),
					status: 'closed' as const,
				},
				receipts,
			}
		}
		if (publicEntry) {
			return {
				position: {
					...position,
					actualEntryGasCostEth: decimalWeth(actualEntryGasCost),
					entryTransactionHash: executorReceipt.transactionHash,
					gasExpenditures,
					status: 'recovery-required' as const,
				},
				receipts,
			}
		}
		throw new Error('Executor hedge event does not match the durable position')
	}
	const actualProfitBeforeGas = recoveredHedgedProfitBeforeGasWeth(position.direction, parseSignedDecimalEth(position.hedgedProfitBeforeGasEth), parseDecimalWeth(position.hedgeWeth), hedgeExecution.hedgeAmountWeth)
	const confirmedPosition = {
		...position,
		actualEntryGasCostEth: decimalWeth(actualEntryGasCost),
		entryTransactionHash: executorReceipt.transactionHash,
		gasExpenditures,
		hedgeAmountToken: formatTokenAmount(hedgeExecution.hedgeAmountToken2, tokenDecimals),
		hedgeWeth: decimalWeth(hedgeExecution.hedgeAmountWeth),
		hedgedProfitBeforeGasEth: decimalSignedEth(actualProfitBeforeGas),
		status: 'open' as const,
	} satisfies PositionRecord
	return {
		position: {
			...confirmedPosition,
			historyOutbox: executionRecordForConfirmedPosition(confirmedPosition, executorReceipt.blockNumber, executorReceipt.transactionHash),
		},
		receipts,
	}
}

export async function expireEntryWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, position: PositionRecord, currentBlockNumber: bigint, expiredAt: string) {
	if (position.entrySubmissionMode === undefined || position.entrySubmissionBlockNumber === undefined) throw new Error('Only a journaled atomic entry can expire without inclusion')
	if (position.entryTransactionHashes.length !== 1) throw new Error('Only an atomic entry can expire automatically')
	const targetBlockNumber = BigInt(position.entrySubmissionBlockNumber) + 1n
	if (!attemptHasFinality(currentBlockNumber, targetBlockNumber)) throw new Error('Entry target block is not sufficiently confirmed')
	const optionalReceipts = await transactionReceiptsOrMissingWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], `expired entry ${position.reportId}`, position.entryTransactionHashes)
	const executorReceipt = optionalReceipts.at(-1)
	if (executorReceipt !== undefined) throw new Error('Entry executor receipt exists and requires normal recovery')
	const transactionHash = position.entryTransactionHashes[0]
	if (transactionHash === undefined) throw new Error('Atomic entry transaction hash is missing')
	if (position.entryTransactionNonce === undefined) throw new Error('Atomic entry transaction nonce is missing')
	return {
		...position,
		actualEntryGasCostEth: '0',
		capitalAtRiskWeth: '0',
		closedAt: expiredAt,
		expiredTransactionAttempts: [
			...(position.expiredTransactionAttempts ?? []),
			{
				kind: 'entry' as const,
				nonce: position.entryTransactionNonce,
				targetBlockNumber: targetBlockNumber.toString(),
				transactionHash,
			},
		],
		gasExpenditures: [],
		hedgedProfitBeforeGasEth: '0',
		lockedToken: '0',
		lockedWeth: '0',
		realizedNetProfitEth: '0',
		status: 'expired-not-included' as const,
	} satisfies PositionRecord
}

export async function reconcileExpiredAttemptsWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, position: PositionRecord, currentBlockNumber: bigint) {
	if (position.manualReconciliation !== undefined) return position
	const attempts = position.expiredTransactionAttempts ?? []
	if (attempts.length === 0) return position
	const receipts = await transactionReceiptsOrMissingWithQuorum(
		readClients,
		[config.connectivity.readRpcUrl, ...config.quorumRpcUrls],
		`expired atomic attempts ${position.reportId}`,
		attempts.map(attempt => attempt.transactionHash),
	)
	const found = attempts.flatMap((attempt, index) => {
		const receipt = receipts[index]
		return receipt === undefined ? [] : [{ attempt, receipt }]
	})
	const finalityBlockNumber = currentBlockNumber > REORG_OVERLAP_BLOCKS ? currentBlockNumber - REORG_OVERLAP_BLOCKS : 0n
	const finalizedFound = found.filter(({ receipt }) => receipt.blockNumber <= finalityBlockNumber)
	const confirmedNonce = await confirmedNonceWithQuorum(readClients, config, position.account, finalityBlockNumber)
	const impossible = attempts.filter((attempt, index) => receipts[index] === undefined && BigInt(attempt.nonce) < confirmedNonce)
	if (finalizedFound.length === 0 && impossible.length === 0) return position
	const successful = finalizedFound.find(({ receipt }) => receipt.status === 'success')
	const expenditures =
		finalizedFound.length === 0
			? []
			: await confirmedGasExpenditures(
					readClients,
					config,
					`expired atomic attempts ${position.reportId}`,
					finalizedFound.map(({ receipt }) => receipt),
				)
	const knownGasHashes = new Set(position.gasExpenditures.map(expenditure => expenditure.transactionHash.toLowerCase()))
	const newExpenditures = expenditures.filter(expenditure => !knownGasHashes.has(expenditure.transactionHash.toLowerCase()))
	const entryHashes = new Set(finalizedFound.filter(({ attempt }) => attempt.kind === 'entry').map(({ attempt }) => attempt.transactionHash.toLowerCase()))
	const entryGas = newExpenditures.filter(expenditure => entryHashes.has(expenditure.transactionHash.toLowerCase())).reduce((total, expenditure) => total + parseDecimalWeth(expenditure.costEth), 0n)
	const lifecycleGas = newExpenditures.filter(expenditure => !entryHashes.has(expenditure.transactionHash.toLowerCase())).reduce((total, expenditure) => total + parseDecimalWeth(expenditure.costEth), 0n)
	const totalGas = entryGas + lifecycleGas
	const completedHashes = new Set([...finalizedFound.filter(({ receipt }) => receipt.status === 'reverted').map(({ attempt }) => attempt.transactionHash.toLowerCase()), ...impossible.map(attempt => attempt.transactionHash.toLowerCase())])
	return {
		...position,
		actualEntryGasCostEth: decimalWeth(parseDecimalWeth(position.actualEntryGasCostEth) + entryGas),
		expiredTransactionAttempts: attempts.filter(attempt => !completedHashes.has(attempt.transactionHash.toLowerCase())),
		gasExpenditures: [...position.gasExpenditures, ...newExpenditures],
		lifecycleGasCostEth: decimalWeth(parseDecimalWeth(position.lifecycleGasCostEth) + lifecycleGas),
		lifecycleUpdatedAt: lifecycleGas === 0n ? position.lifecycleUpdatedAt : (newExpenditures.find(expenditure => !entryHashes.has(expenditure.transactionHash.toLowerCase()))?.minedAt ?? position.lifecycleUpdatedAt),
		realizedNetProfitEth: position.realizedNetProfitEth === undefined ? undefined : decimalSignedEth(parseSignedDecimalEth(position.realizedNetProfitEth) - totalGas),
		status: successful === undefined ? position.status : 'recovery-required',
	} satisfies PositionRecord
}

function withoutLifecycleAttempt(position: PositionRecord, preserveExpiredAttempt = false) {
	const transactionHash = position.lifecycleTransactionHashes[0]
	const targetBlockNumber = position.lifecycleTargetBlockNumber
	const nonce = position.lifecycleTransactionNonce
	if (preserveExpiredAttempt && (transactionHash === undefined || targetBlockNumber === undefined || nonce === undefined)) {
		throw new Error('Expired lifecycle attempt is missing its durable hash, target block, or nonce')
	}
	return {
		...position,
		expiredTransactionAttempts: preserveExpiredAttempt && transactionHash !== undefined && targetBlockNumber !== undefined && nonce !== undefined ? [...(position.expiredTransactionAttempts ?? []), { kind: 'lifecycle' as const, nonce, targetBlockNumber, transactionHash }] : position.expiredTransactionAttempts,
		lifecycleReceiptBlockHash: undefined,
		lifecycleReceiptBlockNumber: undefined,
		lifecycleSettlerRewardEth: undefined,
		lifecycleSubmissionBlockNumber: undefined,
		lifecycleSubmissionMode: undefined,
		lifecycleTargetBlockNumber: undefined,
		lifecycleTokenDecimals: undefined,
		lifecycleTransactionIntent: undefined,
		lifecycleTransactionNonce: undefined,
		lifecycleTransactionHashes: [],
		lifecycleWalletTokenBefore: undefined,
		lifecycleWalletWethBefore: undefined,
	}
}

function rollbackProvisionalLifecycleAccounting(position: PositionRecord) {
	const transactionHash = position.lifecycleTransactionHashes[0]
	if (transactionHash === undefined) return position
	const expenditure = position.lifecycleReceiptBlockHash === undefined ? undefined : position.gasExpenditures.find(candidate => candidate.transactionHash.toLowerCase() === transactionHash.toLowerCase())
	const provisionalGas = expenditure === undefined ? 0n : parseDecimalWeth(expenditure.costEth)
	const recordedLifecycleGas = parseDecimalWeth(position.lifecycleGasCostEth)
	if (provisionalGas > recordedLifecycleGas) throw new Error('Provisional lifecycle gas exceeds the recorded lifecycle total')
	return {
		...position,
		closedAt: undefined,
		gasExpenditures: position.gasExpenditures.filter(candidate => candidate.transactionHash.toLowerCase() !== transactionHash.toLowerCase()),
		lifecycleGasCostEth: decimalWeth(recordedLifecycleGas - provisionalGas),
		lifecycleReceiptBlockHash: undefined,
		lifecycleReceiptBlockNumber: undefined,
		lifecycleReceiptRecovered: false,
		lifecycleSettlerRewardEth: undefined,
		lifecycleUpdatedAt: undefined,
		realizedNetProfitEth: undefined,
		withdrawnToken: '0',
		withdrawnWeth: '0',
	} satisfies PositionRecord
}

export async function recoverPendingLifecycleWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, position: PositionRecord, currentBlockNumber?: bigint | undefined): Promise<PositionRecord> {
	if (position.lifecycleTransactionHashes.length !== 1 || position.lifecycleTargetBlockNumber === undefined || position.lifecycleTokenDecimals === undefined || position.lifecycleSubmissionMode === undefined) {
		throw new Error('Atomic lifecycle recovery journal is incomplete')
	}
	const executor = config.executor
	if (executor === undefined) throw new Error('Atomic lifecycle recovery requires the authenticated executor')
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	const targetBlockNumber = BigInt(position.lifecycleTargetBlockNumber)
	let receipts
	try {
		receipts = await transactionReceiptsWithQuorum(readClients, endpoints, `pending lifecycle ${position.reportId}`, position.lifecycleTransactionHashes)
	} catch (error) {
		if (currentBlockNumber === undefined || !attemptHasFinality(currentBlockNumber, targetBlockNumber)) throw error
		const optionalReceipts = await transactionReceiptsOrMissingWithQuorum(readClients, endpoints, `expired lifecycle ${position.reportId}`, position.lifecycleTransactionHashes)
		if (optionalReceipts.some(receipt => receipt !== undefined)) throw error
		return {
			...withoutLifecycleAttempt(rollbackProvisionalLifecycleAccounting(position), true),
			lifecycleReceiptRecovered: false,
			lifecycleUpdatedAt: new Date().toISOString(),
			status: 'open',
		}
	}
	const receipt = receipts[0]
	const expectedHash = position.lifecycleTransactionHashes[0]
	if (receipt === undefined || expectedHash === undefined || receipt.transactionHash.toLowerCase() !== expectedHash.toLowerCase()) throw new Error('Lifecycle receipt hash does not match the durable journal')
	const lifecycleGasExpenditures = await confirmedGasExpenditures(readClients, config, `pending lifecycle ${position.reportId}`, [receipt])
	const previousExpenditure = position.lifecycleReceiptBlockHash === undefined ? undefined : position.gasExpenditures.find(expenditure => expenditure.transactionHash.toLowerCase() === receipt.transactionHash.toLowerCase())
	const previousGas = previousExpenditure === undefined ? 0n : parseDecimalWeth(previousExpenditure.costEth)
	const canonicalGas = lifecycleGasExpenditures.reduce((total, expenditure) => total + parseDecimalWeth(expenditure.costEth), 0n)
	const recordedLifecycleGas = parseDecimalWeth(position.lifecycleGasCostEth)
	if (previousGas > recordedLifecycleGas) throw new Error('Previously recorded lifecycle gas exceeds the lifecycle total')
	const lifecycleGas = recordedLifecycleGas - previousGas + canonicalGas
	const accountedPosition = {
		...position,
		gasExpenditures: [...(previousExpenditure === undefined ? position.gasExpenditures : position.gasExpenditures.filter(expenditure => expenditure.transactionHash.toLowerCase() !== receipt.transactionHash.toLowerCase())), ...lifecycleGasExpenditures],
		lifecycleGasCostEth: decimalWeth(lifecycleGas),
		lifecycleUpdatedAt: lifecycleGasExpenditures[0]?.minedAt ?? position.lifecycleUpdatedAt,
	} satisfies PositionRecord
	const transactionIntentMismatch =
		position.lifecycleSubmissionMode === 'public' && receipt.status === 'success'
			? await recoveredTransactionIntentMismatchWithQuorum(readClients, config, `pending public lifecycle ${position.reportId}`, receipt.transactionHash, position.account, position.lifecycleTransactionNonce, position.lifecycleTransactionIntent)
			: undefined
	if (transactionIntentMismatch !== undefined) {
		return {
			...accountedPosition,
			lifecycleReceiptRecovered: true,
			status: 'recovery-required',
		}
	}
	let execution: ReturnType<typeof lifecycleExecutionFromLogs> | undefined
	if (receipt.status === 'success') {
		try {
			execution = lifecycleExecutionFromLogs(receipt.logs, executor)
		} catch (error) {
			if (!(error instanceof Error) || error.message !== 'Confirmed executor transaction did not emit LifecycleExecuted') throw error
			execution = undefined
		}
	}
	if (execution === undefined) {
		if (receipt.status === 'success') {
			return {
				...accountedPosition,
				lifecycleReceiptRecovered: true,
				status: 'recovery-required',
			}
		}
		return {
			...withoutLifecycleAttempt(accountedPosition),
			lifecycleReceiptRecovered: false,
			status: 'open',
		}
	}
	if (receipt.blockNumber !== targetBlockNumber) throw new Error('Lifecycle executor transaction was included outside its signed parent-block target')
	const tokenDecimals = Number(position.lifecycleTokenDecimals)
	if (!Number.isSafeInteger(tokenDecimals) || tokenDecimals < 0 || tokenDecimals > 255) throw new Error('Lifecycle recovery token decimals are invalid')
	const expectedWeth = parseDecimalWeth(position.lockedWeth)
	const expectedToken = parseUnits(position.lockedToken, tokenDecimals)
	if (
		execution.account.toLowerCase() !== position.account.toLowerCase() ||
		execution.reportId.toString() !== position.reportId ||
		execution.token1.toLowerCase() !== config.network.weth.toLowerCase() ||
		execution.token2.toLowerCase() !== position.token.toLowerCase() ||
		execution.amount1 !== expectedWeth ||
		execution.amount2 !== expectedToken
	) {
		throw new Error('Lifecycle executor event does not match the durable position')
	}
	return {
		...accountedPosition,
		closedAt: undefined,
		lifecycleReceiptBlockHash: receipt.blockHash,
		lifecycleReceiptBlockNumber: receipt.blockNumber.toString(),
		lifecycleReceiptRecovered: true,
		lifecycleSettlerRewardEth: decimalWeth(execution.settlerReward),
		realizedNetProfitEth: undefined,
		status: 'closed-pending-finality',
		withdrawnToken: position.lockedToken,
		withdrawnWeth: position.lockedWeth,
	}
}

async function finalityDescendantHashWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, reportId: string, blockNumber: bigint) {
	const endpoints = [config.connectivity.readRpcUrl, ...config.quorumRpcUrls]
	if (readClients.length !== endpoints.length) throw new Error(`Lifecycle finality ${reportId} block readers and endpoints differ`)
	const blocks = await Promise.allSettled(readClients.map(client => client.getBlock({ blockNumber })))
	const observations: { endpoint: string; value: Hex }[] = []
	for (const [index, result] of blocks.entries()) {
		if (result.status === 'rejected' || result.value.hash == null) return undefined
		observations.push({
			endpoint: endpointLabel(endpoints[index] ?? ''),
			value: result.value.hash,
		})
	}
	return quorumValue(`lifecycle ${reportId} finality descendant ${blockNumber.toString()}`, observations)
}

export async function finalizeLifecycleAfterFinalityWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, position: PositionRecord, currentBlockNumber: bigint): Promise<PositionRecord> {
	if (position.status !== 'closed-pending-finality') return position
	if (position.lifecycleReceiptBlockNumber === undefined || position.lifecycleReceiptBlockHash === undefined) throw new Error('Pending lifecycle finality evidence is incomplete')
	const receiptBlockNumber = BigInt(position.lifecycleReceiptBlockNumber)
	if (!attemptHasFinality(currentBlockNumber, receiptBlockNumber)) return position
	const refreshed = await recoverPendingLifecycleWithQuorum(readClients, config, position, currentBlockNumber)
	if (refreshed.status !== 'closed-pending-finality') return refreshed
	if (refreshed.lifecycleReceiptBlockNumber === undefined || !attemptHasFinality(currentBlockNumber, BigInt(refreshed.lifecycleReceiptBlockNumber))) return refreshed
	const finalityDescendantBlockNumber = BigInt(refreshed.lifecycleReceiptBlockNumber) + REORG_OVERLAP_BLOCKS
	if ((await finalityDescendantHashWithQuorum(readClients, config, refreshed.reportId, finalityDescendantBlockNumber)) === undefined) return refreshed
	const closedAt = refreshed.lifecycleUpdatedAt
	if (closedAt === undefined) throw new Error('Finalized lifecycle receipt timestamp is unavailable')
	if (refreshed.lifecycleSettlerRewardEth === undefined) throw new Error('Finalized lifecycle settler reward evidence is unavailable')
	const realized = realizedNetProfitWeth(parseSignedDecimalEth(refreshed.hedgedProfitBeforeGasEth), parseDecimalWeth(refreshed.lifecycleSettlerRewardEth), parseDecimalWeth(refreshed.actualEntryGasCostEth), parseDecimalWeth(refreshed.lifecycleGasCostEth))
	return {
		...withoutLifecycleAttempt(refreshed),
		closedAt,
		lifecycleSettlerRewardEth: refreshed.lifecycleSettlerRewardEth,
		realizedNetProfitEth: decimalSignedEth(realized),
		status: 'closed',
	} satisfies PositionRecord
}

export async function discoverPublicReplacementWithQuorum(readClients: readonly ReadClient[], config: RecoveryConfiguration, position: PositionRecord, blockNumber: bigint, kind: 'entry' | 'lifecycle', persistPosition: (position: PositionRecord) => Promise<void>) {
	const submissionBlockNumber = kind === 'entry' ? position.entrySubmissionBlockNumber : position.lifecycleSubmissionBlockNumber
	const transactionNonce = kind === 'entry' ? position.entryTransactionNonce : position.lifecycleTransactionNonce
	if (submissionBlockNumber === undefined || transactionNonce === undefined) return position
	const discoveredHash = await transactionHashBySenderNonceWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], `pending public ${kind} ${position.reportId}`, {
		account: position.account,
		fromBlockNumber: BigInt(submissionBlockNumber),
		nonce: BigInt(transactionNonce),
		toBlockNumber: blockNumber,
	})
	if (discoveredHash === undefined) return position
	const currentHashes = kind === 'entry' ? position.entryTransactionHashes : position.lifecycleTransactionHashes
	if (currentHashes.length === 1 && currentHashes[0]?.toLowerCase() === discoveredHash.toLowerCase()) return position
	const updated =
		kind === 'entry'
			? {
					...position,
					entryTransactionHash: discoveredHash,
					entryTransactionHashes: [discoveredHash],
					status: 'recovery-required' as const,
				}
			: {
					...position,
					lifecycleTransactionHashes: [discoveredHash],
					status: 'recovery-required' as const,
				}
	await persistPosition(updated)
	return updated
}

export async function processPositionLifecycle(client: ReadClient, readClients: readonly ReadClient[], wallet: WriteClient, config: Configuration, position: PositionRecord, blockNumber: bigint, persistPosition: (position: PositionRecord) => Promise<void>, track: TrackTransaction) {
	const account = wallet.account
	const executor = config.executor
	if (account.signTransaction === undefined || account.signMessage === undefined) throw new Error('Position recovery requires a local transaction and relay signer')
	if (executor === undefined) throw new Error('Position recovery requires the authenticated executor parent-block guard')
	const signMessage = account.signMessage
	if (position.account.toLowerCase() !== account.address.toLowerCase()) throw new Error(`Open position ${position.reportId} belongs to ${position.account}, not the active signer`)
	if (position.status === 'closed-pending-finality') {
		const finalized = await finalizeLifecycleAfterFinalityWithQuorum(readClients, config, position, blockNumber)
		if (finalized !== position) await persistPosition(finalized)
		if (finalized.status === 'closed') return 'processed' as const
		if (finalized.status === 'open') return 'progressed' as const
		return 'waiting' as const
	}
	const id = BigInt(position.reportId)
	const storedSnapshot = await storedReportWithQuorum(readClients, config, id, blockNumber)
	const report = storedSnapshot.report
	const game = report.game
	const balancesBefore = await lifecycleBalancesWithQuorum(readClients, config, account.address, position.token, blockNumber)
	if (balancesBefore.blockHash.toLowerCase() !== storedSnapshot.blockHash.toLowerCase()) throw new Error('Lifecycle state reads use different canonical blocks')
	let activePosition = position
	if (activePosition.entrySubmissionMode === 'public' || activePosition.lifecycleSubmissionMode === 'public') {
		let pendingKind: 'entry' | 'lifecycle' | undefined
		if (activePosition.actualEntryGasCostEth === '0' && activePosition.entrySubmissionMode === 'public') pendingKind = 'entry'
		else if (lifecycleAttemptNeedsRecovery(activePosition) && activePosition.lifecycleSubmissionMode === 'public') pendingKind = 'lifecycle'
		if (pendingKind !== undefined) activePosition = await discoverPublicReplacementWithQuorum(readClients, config, activePosition, blockNumber, pendingKind, persistPosition)
	}
	const entryAccountingNeedsRecovery = activePosition.status === 'pending-entry' || (activePosition.status === 'recovery-required' && activePosition.actualEntryGasCostEth === '0')
	if (entryAccountingNeedsRecovery) {
		try {
			activePosition = (await recoverPendingEntryWithQuorum(readClients, config, activePosition, tokenDecimalsFromSnapshot(balancesBefore, activePosition.reportId))).position
			await persistPosition(activePosition)
			if (activePosition.status === 'recovery-required') throw new Error('Successful public entry receipt does not match the durable execution intent and executor event')
		} catch (error) {
			const targetBlockNumber = activePosition.entrySubmissionBlockNumber === undefined ? undefined : BigInt(activePosition.entrySubmissionBlockNumber) + 1n
			if (activePosition.entrySubmissionMode !== undefined && targetBlockNumber !== undefined && attemptHasFinality(blockNumber, targetBlockNumber)) {
				try {
					activePosition = await expireEntryWithQuorum(readClients, config, activePosition, blockNumber, dateFromBlockTimestamp(storedSnapshot.blockTimestamp).toISOString())
					await persistPosition(activePosition)
					return 'processed' as const
				} catch (expirationError) {
					throw new Error(`Pending position ${activePosition.reportId} could not prove non-inclusion after finality: ${errorMessage(expirationError)}`)
				}
			}
			await persistPosition({ ...activePosition, status: 'recovery-required' })
			throw new Error(`Pending position ${activePosition.reportId} entry receipt could not be recovered: ${errorMessage(error)}`)
		}
	}
	if (activePosition.status === 'closed' || activePosition.status === 'expired-not-included') return 'processed' as const
	if (activePosition.status === 'recovery-required' && (activePosition.expiredTransactionAttempts?.length ?? 0) !== 0) {
		throw new Error(`Position ${activePosition.reportId} has a previously expired transaction with unexpected canonical evidence`)
	}
	if (lifecycleAttemptNeedsRecovery(activePosition)) {
		let recovered: PositionRecord
		try {
			recovered = await recoverPendingLifecycleWithQuorum(readClients, config, activePosition, blockNumber)
		} catch (error) {
			await persistPosition({ ...activePosition, status: 'recovery-required' })
			throw new Error(`Pending position ${activePosition.reportId} lifecycle receipt could not be recovered: ${errorMessage(error)}`)
		}
		await persistPosition(recovered)
		return recovered.status === 'closed' ? ('processed' as const) : ('progressed' as const)
	}
	if (activePosition.status === 'recovery-required' && activePosition.lifecycleReceiptRecovered) {
		throw new Error(`Position ${activePosition.reportId} has recovered lifecycle receipts but requires manual residual-asset reconciliation`)
	}
	if (game.currentReporter === zeroAddress || game.token1.toLowerCase() !== config.network.weth.toLowerCase() || game.token2.toLowerCase() !== activePosition.token.toLowerCase()) {
		await persistPosition({ ...activePosition, status: 'recovery-required' })
		throw new Error(`Open position ${activePosition.reportId} cannot be reconciled with stored OpenOracle state`)
	}
	const currentReporter = game.currentReporter.toLowerCase() === account.address.toLowerCase()
	const currentTime = (game.flags & OPEN_ORACLE_FLAG_TIME_TYPE) === 0n ? blockNumber : storedSnapshot.blockTimestamp
	const settlementEligible = currentReporter && game.settlementTimestamp === 0n && currentTime >= game.reportTimestamp + game.settlementTime
	if (currentReporter && game.settlementTimestamp === 0n && !settlementEligible) {
		return 'waiting' as const
	}
	const tokenDecimals = tokenDecimalsFromSnapshot(balancesBefore, activePosition.reportId)
	const expectedWeth = parseDecimalWeth(activePosition.lockedWeth)
	const expectedToken = parseUnits(activePosition.lockedToken, tokenDecimals)
	const willSettle = currentReporter && game.settlementTimestamp === 0n
	const withdrawalMismatch = lifecycleWithdrawalMismatch({
		currentReporter,
		expectedToken,
		expectedWeth,
		holderToken: balancesBefore.holderToken,
		holderWeth: balancesBefore.holderWeth,
		willSettle,
	})
	if (withdrawalMismatch !== undefined) {
		await persistPosition({ ...activePosition, status: 'recovery-required' })
		throw new Error(`Position ${activePosition.reportId} cannot execute atomically: ${withdrawalMismatch}`)
	}
	const allowanceMismatch = lifecycleAllowanceMismatch({ token1: balancesBefore.internalAllowanceWeth, token2: balancesBefore.internalAllowanceToken }, { token1: expectedWeth, token2: expectedToken })
	if (allowanceMismatch !== undefined) throw new Error(`Position ${activePosition.reportId} cannot execute atomically: ${allowanceMismatch}`)

	const block = await client.getBlock({ blockNumber })
	if (block.hash == null || block.hash.toLowerCase() !== storedSnapshot.blockHash.toLowerCase()) throw new Error('Lifecycle quote and quorum snapshot use different canonical blocks')
	const signTransaction = account.signTransaction
	const startingNonce = await pendingNonceWithQuorum(readClients, config, account.address)
	const targetBlockNumber = blockNumber + 1n
	const lifecycleCall = {
		data: encodeFunctionData({
			abi: openOracleArbitrageExecutorAbi,
			functionName: 'settleAndWithdraw',
			args: [
				{
					amount1: expectedWeth,
					amount2: expectedToken,
					expectedParentBlockHash: storedSnapshot.blockHash,
					openOracle: config.openOracle,
					parentBlockNumber: blockNumber,
				},
				getOpenOracleGameTuple(game),
				getOpenOracleHelperTuple(report.helper),
			],
		}),
		gas: BigInt(game.callbackGasLimit) + 900_000n,
		kind: 'settle' as const,
		to: executor,
	}
	const signed = await prepareSignedTransaction({
		baseFeePerGas: block.baseFeePerGas ?? 0n,
		blockNumber,
		chainId: config.network.chain.id,
		data: lifecycleCall.data,
		from: account.address,
		gasEstimate: lifecycleCall.gas,
		lastValidBlockNumber: lifecycleLastValidBlockNumber(targetBlockNumber),
		nonce: startingNonce,
		signTransaction,
		to: lifecycleCall.to,
	})
	const lifecyclePosition = {
		...activePosition,
		lifecycleSubmissionBlockNumber: blockNumber.toString(),
		lifecycleSubmissionMode: config.submission.mode,
		lifecycleTargetBlockNumber: targetBlockNumber.toString(),
		lifecycleTokenDecimals: tokenDecimals.toString(),
		lifecycleTransactionIntent: durableTransactionIntent(signed.transaction),
		lifecycleTransactionNonce: startingNonce.toString(),
		lifecycleTransactionHashes: [signed.hash],
		lifecycleUpdatedAt: new Date().toISOString(),
		lifecycleWalletTokenBefore: undefined,
		lifecycleWalletWethBefore: undefined,
		status: 'withdrawing' as const,
	} satisfies PositionRecord
	if (config.submission.mode === 'public') {
		await persistPosition(lifecyclePosition)
		const submission = await submitContractTransaction(client, wallet, config, signed, { estimatedNetProfitEth: undefined, kind: lifecycleCall.kind, reportId: activePosition.reportId }, () => false, track)
		const { receipt } = await waitForTrackedTransaction(client, wallet, config, submission, track, replacement =>
			persistPosition({
				...lifecyclePosition,
				lifecycleTransactionHashes: [replacement.transaction.hash],
				status: 'recovery-required',
			}),
		)
		const observedPosition = {
			...lifecyclePosition,
			lifecycleTransactionHashes: [receipt.transactionHash],
			status: 'recovery-required' as const,
		}
		await persistPosition(observedPosition)
		try {
			const recovered = await recoverPendingLifecycleWithQuorum(readClients, config, observedPosition, receipt.blockNumber)
			await persistPosition(recovered)
			return recovered.status === 'closed' ? ('processed' as const) : ('progressed' as const)
		} catch (error) {
			throw new Error(`Pending position ${activePosition.reportId} public lifecycle receipt could not be recovered: ${errorMessage(error)}`)
		}
	}
	const relaySimulations = await simulateSignedBundleEveryRelay({
		address: account.address,
		minimumSuccessfulRelays: config.submission.minimumRelaySuccesses,
		relayUrls: config.submission.relayUrls,
		signMessage,
		stateBlockNumber: blockNumber,
		targetBlockNumber,
		transactions: [signed.serializedTransaction],
	})
	await guardedTransactionSubmission(
		() => false,
		async () => {
			if ((await currentBlockNumberWithQuorum(readClients, config, 'lifecycle submission head')) !== blockNumber) throw new Error('Position lifecycle bundle quote expired before submission')
			const canonicalHash = await canonicalBlockHashWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], 'lifecycle submission', blockNumber)
			if (canonicalHash.toLowerCase() !== storedSnapshot.blockHash.toLowerCase()) throw new Error('Position lifecycle canonical parent changed before submission')
		},
		() =>
			journaledSubmission(
				() => persistPosition(lifecyclePosition),
				() =>
					submitSignedBundle({
						address: account.address,
						relayUrls: relaySimulations.successful.map(result => result.relayUrl),
						signMessage,
						targetBlockNumber,
						transactions: [signed.serializedTransaction],
					}),
			),
	)
	while ((await client.getBlockNumber()) < targetBlockNumber) await Bun.sleep(Math.min(config.pollMilliseconds, 1_000))
	try {
		await finalizeSubmittedLifecycleAttempt(lifecyclePosition, pending => recoverPendingLifecycleWithQuorum(readClients, config, pending, targetBlockNumber), persistPosition)
	} catch (error) {
		throw new Error(`Pending position ${activePosition.reportId} lifecycle receipt could not be recovered: ${errorMessage(error)}`)
	}
	return 'progressed' as const
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
		if (!spotTwapDeviationWithinLimit(pool.spotTick, pool.twapTick, config.maxSpotTwapTicks)) continue
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
	const capitalAtRiskWeth = fundedCapitalAtRiskWeth(funding, best.quote.hedgeAmountRep, hedgeLimitQuote, hedgeLimit)
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
	const projectedLifecycleGas = projectedLifecycleGasReserveWeth({
		callbackGasLimit: BigInt(game.callbackGasLimit),
		configuredReserveWeth: config.riskLimits.lifecycleGasReserveWeth,
		gasPrice,
		submissionMode: config.submission.mode,
	})
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
	const executionHistory = await loadExecutionHistory(config.historyFile)
	for (const position of positions) {
		const record = position.historyOutbox
		if (record !== undefined && !executionHistory.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) executionHistory.unshift(record)
	}
	const state: OperatorState = {
		activeReportCount: 0,
		balances: undefined,
		blockNumber: undefined,
		blockTimestamp: undefined,
		executionHistory,
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
				getSnapshot: () => operatorSnapshot(state, pendingStrategy ?? config, pendingSubmission ?? config.submission, pendingConnectivity ?? config.connectivity, fixedState, config.riskLimits),
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
					await updateSubmissionEndpointChecks(state, () => checkSubmissionEndpoints(next, config.network.chain.id))
					return queueSettingsUpdate(async () => {
						await persistSettings({ ...currentPersistedSettings(), submission: next })
						pendingSubmission = next
						recordOperation(state, { category: 'configuration', details: next.relayUrls.map(endpointLabel).join(', ') || undefined, level: 'info', message: `Submission mode ${next.mode} verified and saved`, reason: 'Applied at the next scan boundary', reportId: undefined })
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
	const persistPosition = async (position: PositionRecord) => {
		const nextPositions = [position, ...positions.filter(existing => existing.reportId !== position.reportId)]
		await savePositionJournal(config.positionFile, nextPositions)
		positions = nextPositions
		state.positions = nextPositions
	}
	const flushHistoryOutboxes = async () => {
		for (const position of positions.filter(candidate => candidate.historyOutbox !== undefined)) {
			const record = position.historyOutbox
			if (record === undefined) continue
			if (!state.executionHistory.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) state.executionHistory.unshift(record)
			await appendExecutionHistoryIfMissing(config.historyFile, record)
			await persistPosition({ ...position, historyOutbox: undefined })
		}
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
				if (positions.some(position => position.historyOutbox !== undefined)) {
					try {
						await flushHistoryOutboxes()
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
				if (cursor?.finalityAnchorNumber !== undefined && cursor.finalityAnchorHash !== undefined) {
					const anchor = await client.getBlock({ blockNumber: cursor.finalityAnchorNumber })
					if (anchor.hash == null) throw new Error('Finality anchor block is missing its canonical hash')
					assertFinalityAnchor(cursor, cursor.finalityAnchorNumber, anchor.hash)
				}
				let lifecycleProcessed = false
				if (config.execute && wallet !== undefined) {
					for (const position of positions.filter(candidate => candidate.status !== 'recovery-required' && candidate.manualReconciliation === undefined && (candidate.expiredTransactionAttempts?.length ?? 0) !== 0)) {
						try {
							const reconciled = await reconcileExpiredAttemptsWithQuorum(readClients, config, position, blockNumber)
							if (reconciled !== position) {
								await persistPosition(reconciled)
								recordOperation(state, {
									category: 'transaction',
									details: `entryGas=${reconciled.actualEntryGasCostEth} ETH lifecycleGas=${reconciled.lifecycleGasCostEth} ETH`,
									level: 'info',
									message: 'Late atomic revert gas reconciled',
									reason: (reconciled.expiredTransactionAttempts?.length ?? 0) === 0 ? `Report ${position.reportId} expired transaction monitoring completed` : `Report ${position.reportId} expired transaction monitoring remains active`,
									reportId: position.reportId,
								})
							}
						} catch (error) {
							const message = `Position ${position.reportId} expired transaction requires attention: ${errorMessage(error)}`
							nextError = message
							recordOperation(state, { category: 'transaction', details: undefined, level: 'error', message: 'Expired transaction monitoring failed closed', reason: message, reportId: position.reportId })
						}
					}
					for (const position of positions.filter(candidate => positionConsumesRisk(candidate.status))) {
						try {
							const result = await processPositionLifecycle(client, readClients, wallet, config, position, blockNumber, persistPosition, trackTransaction)
							if (result === 'processed' || result === 'progressed') {
								lifecycleProcessed = true
								recordOperation(state, {
									category: 'transaction',
									details: `withdrawn=${state.positions.find(candidate => candidate.reportId === position.reportId)?.withdrawnWeth ?? 'unknown'} WETH`,
									level: 'info',
									message: result === 'processed' ? 'Position lifecycle completed' : 'Position lifecycle advanced',
									reason: result === 'processed' ? `Report ${position.reportId} was settled and withdrawn` : `Report ${position.reportId} completed one durable public lifecycle transaction`,
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
				const executionReady = positions.every(position => position.historyOutbox === undefined) && nextError === undefined
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
									const mismatch = candidateRiskMismatch(evaluated.candidate, positions, config.riskLimits, dateFromBlockTimestamp(block.timestamp))
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
							const record = await executeDispute(client, readClients, wallet, config, selected.report, selected.quote, selected.pool, metadata, positions, () => state.paused, trackTransaction, persistPosition)
							selected.opportunity.decision = 'submitted'
							if (!state.executionHistory.some(existing => existing.transactionHash.toLowerCase() === record.transactionHash.toLowerCase())) state.executionHistory.unshift(record)
							try {
								await flushHistoryOutboxes()
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
				const finalityAnchorNumber = blockNumber > REORG_OVERLAP_BLOCKS ? blockNumber - REORG_OVERLAP_BLOCKS : 0n
				const finalityAnchor = await client.getBlock({ blockNumber: finalityAnchorNumber })
				if (finalityAnchor.hash == null) throw new Error('Finality anchor block is missing its canonical hash')
				cursor = withFinalityAnchor(cursor, finalityAnchorNumber, finalityAnchor.hash)
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

if (import.meta.main) {
	main().catch(error => {
		console.error(errorMessage(error))
		process.exitCode = 1
	})
}

import { encodeFunctionData, type Address, type Hex, zeroAddress } from '#ethereum'
import { STANDARD_UNISWAP_FEES } from '#core/uniswap-v4'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_TIME_TYPE, type OpenOracleStatePreimage } from '@zoltar/shared/openOracle'
import { erc20Abi, openOracleArbitrageExecutorAbi } from '#contracts/abi'
import { type Configuration } from '#config/configuration'
import {
	assertCanonicalExecutionSnapshot,
	buildHedgeExecutionPayload,
	canonicalBlockHashWithQuorum,
	fundingTransactionPlan,
	guardedTransactionSubmission,
	guardedRiskSubmission,
	isExecutionPausedError,
	journaledSubmission,
	lifecycleAllowanceMismatch,
	openOracleDisputeTiming,
	privateEntryRecoveryIsConfirmed,
	selectBestExecution,
	simulateTrackedPrivateBundle,
	trackPrivateBundleReceiptStatuses,
	transactionReceiptsWithQuorum,
} from '#execution/execution-orchestration'
import { decimalSignedEth, decimalWeth, type BalanceSnapshot, type ExecutionRecord } from '#state/operator-state'
import { availableTokenBalances, formatTokenAmount } from '#monitoring/market-monitor'
import { centralizedMarketConfigurationAllowsExecution, centralizedPriceAllowsExecution, type CentralizedMarketEstimate } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { marketConsensusAllowsExecution, type MarketConsensusEstimate } from '@zoltar/bot-shared/monitoring/market-consensus'

const FEES = STANDARD_UNISWAP_FEES
import { expectedWithdrawalToken2, hedgedProfitBeforeGasWeth } from '#core/position-accounting'
import { type PositionRecord } from '#state/position-store'
import { bestSuccessful } from '#monitoring/resilience'
import { positionRiskLimitMismatch, projectedLifecycleGasReserveAttoWeth } from '#core/safety-controls'
import {
	calculateFee,
	calculateNextAmount1,
	calculateTrackedNetProfitEth,
	deriveTokenToSwap,
	evaluateBuyRep,
	evaluateSellRep,
	executorFunding,
	fundedCapitalAtRiskAttoWeth,
	hasFreshSubmissionWindow,
	hedgeWethLimitAttoEth,
	isSelfReport,
	meetsProfitThreshold,
	spotTwapDeviationWithinLimit,
	type ArbitrageQuote,
} from '#core/strategy'
import { prepareSignedTransaction, simulateSignedBundleEveryRelay, submitConfiguredSignedBundle, SubmissionFailure, type SubmissionTargetResult } from '#execution/transaction-submission'
import { receiptGasCost, submitContractTransaction, trackedActivity, waitForTrackedTransaction, type TrackTransaction } from '#execution/transaction-tracker'
import type { Venue } from '#core/venue-strategy'
import type { Pool, ReadClient, WriteClient } from '#core/operator-types'
import { errorMessage } from '#core/rpc-validation'
import { executionReadQuorum, quoteInput, safetyAdjustedQuote } from '#monitoring/opportunity-evaluation'
import { operationalFailureDisposition } from '#monitoring/resilience'
import { confirmedGasExpenditures, currentBlockNumberWithQuorum, dateFromBlockTimestamp, durableTransactionIntent, hedgeExecutionFromLogs, pendingNonceWithQuorum, recoveredTransactionIntentMismatchWithQuorum } from '#execution/recovery-support'
import { executionRecordForConfirmedPosition, recoverPendingEntryWithQuorum } from '#execution/position-lifecycle'

export async function loadBalances(client: ReadClient, wallet: WriteClient | undefined, config: Configuration, pools: readonly Pool[], tokens: readonly Address[]) {
	if (wallet === undefined) return undefined
	const address = wallet.account.address
	const [ethAttoEth, attoWeth, repAttoRep] = await Promise.all([
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
	const raw = { ethAttoEth, repAttoRep, tokens: tokenBalances, attoWeth }
	let repValueAttoWeth: bigint | undefined
	if (repAttoRep === 0n) repValueAttoWeth = 0n
	else {
		const best = await bestSuccessful(
			pools.filter(pool => pool.token.toLowerCase() === config.network.rep.toLowerCase()).map(pool => () => quoteInput(client, config.network.quoter, config.network.rep, config.network.weth, repAttoRep, pool.fee)),
			value => value,
			() => undefined,
		)
		repValueAttoWeth = best
	}
	const snapshot: BalanceSnapshot = {
		availableEth: decimalWeth(ethAttoEth),
		availableRep: decimalWeth(repAttoRep),
		availableWeth: decimalWeth(attoWeth),
		repValueWeth: repValueAttoWeth === undefined ? undefined : decimalWeth(repValueAttoWeth),
		totalValueWeth: repValueAttoWeth === undefined ? undefined : decimalWeth(ethAttoEth + attoWeth + repValueAttoWeth),
	}
	return { raw, snapshot }
}

export async function executeDispute(
	client: ReadClient,
	readClients: readonly ReadClient[],
	wallet: WriteClient,
	config: Configuration,
	report: OpenOracleStatePreimage,
	quote: ArbitrageQuote,
	pool: Pool,
	hedgeVenue: Venue,
	hedgeFee: (typeof FEES)[number],
	tokenMetadata: { decimals: number; symbol: string },
	positions: readonly PositionRecord[],
	centralizedMarket: CentralizedMarketEstimate | undefined,
	marketConsensus: MarketConsensusEstimate | undefined,
	marketEvidenceStillCanonical: () => Promise<boolean>,
	isPaused: () => boolean,
	track: TrackTransaction,
	persistPosition: (position: PositionRecord) => Promise<void>,
): Promise<ExecutionRecord> {
	const account = wallet.account
	const executor = config.executor
	if (account === undefined || account.signTransaction === undefined || account.signMessage === undefined) throw new Error('Execution requires a local transaction and relay signer')
	if (executor === undefined) throw new Error('Execution requires a deployed OpenOracle arbitrage executor')
	let router = config.router
	let hedgePool = pool.address
	if (hedgeVenue === 'uniswap-v2') {
		router = config.v2Router
		hedgePool = pool.v2Pair ?? zeroAddress
	} else if (hedgeVenue === 'uniswap-v4') {
		router = config.v4PoolManager
		hedgePool = config.v4PoolManager ?? zeroAddress
	}
	if (router === undefined) throw new Error('Execution requires an authenticated Uniswap router')
	if (hedgePool === zeroAddress) throw new Error('Execution requires a discovered or configured Uniswap pool')
	const game = report.game
	if (isSelfReport(account.address, game.currentReporter)) throw new Error('Self-disputes use different OpenOracle accounting and are not supported')
	const newAmount1 = calculateNextAmount1(game)
	const reportId = report.helper.reportId.toString()
	const quoteBlock = await client.getBlock()
	if (quoteBlock.number === undefined || quoteBlock.hash == null) throw new Error('Quote block is missing its canonical identity')
	const quoteBlockNumber = quoteBlock.number
	const signMessage = account.signMessage
	const signTransaction = account.signTransaction
	const executionSnapshot = await executionReadQuorum(readClients, config, report, pool, hedgeVenue, hedgeFee, quoteBlockNumber, account.address)
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
	const lifecycleGasReserveAttoWeth = projectedLifecycleGasReserveAttoWeth({
		callbackGasLimit: BigInt(game.callbackGasLimit),
		configuredReserveAttoWeth: config.riskLimits.lifecycleGasReserveAttoWeth,
		gasPrice,
		submissionMode: config.submission.mode,
	})
	const entryGasCostAttoWeth = gasPrice * 1_200_000n
	const refreshedQuote = selectBestExecution(
		[safetyAdjustedQuote(evaluateSellRep(game, executionSnapshot.sellHedgeQuote, 0n), entryGasCostAttoWeth, lifecycleGasReserveAttoWeth, config), safetyAdjustedQuote(evaluateBuyRep(game, executionSnapshot.buyHedgeQuote, 0n), entryGasCostAttoWeth, lifecycleGasReserveAttoWeth, config)],
		candidate => candidate.netProfitAttoWeth,
	)
	if (refreshedQuote === undefined) throw new Error('Canonical execution snapshot did not produce an arbitrage quote')
	if (refreshedQuote.direction !== quote.direction) throw new Error('Best arbitrage direction changed before submission')
	const referenceWeth = refreshedQuote.direction === 'sell-rep' ? refreshedQuote.grossProceedsAttoWeth : refreshedQuote.hedgeCostAttoWeth
	const refreshedDexPriceRepPerEth = referenceWeth === 0n ? 0n : (refreshedQuote.hedgeAmountAttoRep * 10n ** 18n) / referenceWeth
	const finalMarketPriceAllowsExecution = () =>
		centralizedMarketConfigurationAllowsExecution(config.centralizedMarkets) &&
		(marketConsensus === undefined
			? !config.centralizedMarkets.requiredForExecution && centralizedPriceAllowsExecution(refreshedDexPriceRepPerEth, centralizedMarket, config.centralizedMarkets, game.token2)
			: marketConsensusAllowsExecution(
					refreshedDexPriceRepPerEth,
					marketConsensus,
					{
						maximumDeviationBps: config.centralizedMarkets.maximumDexDeviationBps,
						maximumObservationAgeMilliseconds: config.centralizedMarkets.maximumObservationAgeMilliseconds,
						requiredForExecution: config.centralizedMarkets.requiredForExecution,
					},
					game.token2,
					config.network.chain.id,
				))
	if (!finalMarketPriceAllowsExecution() || !(await marketEvidenceStillCanonical())) {
		throw new Error('Final executable DEX price is not confirmed by independent market consensus')
	}
	const newAmount2 = executionSnapshot.replacementAmount2
	const tokenToSwap = deriveTokenToSwap(game, newAmount1, newAmount2)
	if (tokenToSwap.toLowerCase() !== refreshedQuote.tokenToSwap.toLowerCase()) throw new Error('Final replacement ratio does not derive the selected arbitrage direction')
	const hedgeLimitQuote = refreshedQuote.direction === 'sell-rep' ? refreshedQuote.grossProceedsAttoWeth : refreshedQuote.hedgeCostAttoWeth
	const hedgeLimit = hedgeWethLimitAttoEth(refreshedQuote.direction, hedgeLimitQuote, config.maxHedgeSlippageBps)
	const funding = executorFunding(game, newAmount1, newAmount2, refreshedQuote.direction === 'buy-rep' ? hedgeLimit : 0n)
	if (executionSnapshot.weth < funding.token1 || executionSnapshot.token < funding.token2) throw new Error('Canonical execution snapshot no longer has the inventory required by the signed bundle')
	const lockedToken = expectedWithdrawalToken2(refreshedQuote.direction, game.currentAmount2, newAmount2)
	const replacementCredit1 = 2n * newAmount1 + calculateFee(newAmount1, game.feePercentage)
	const replacementCredit2 = 2n * newAmount2 + calculateFee(newAmount2, game.feePercentage)
	const internalAllowanceError = lifecycleAllowanceMismatch({ token1: executionSnapshot.internalAllowance1, token2: executionSnapshot.internalAllowance2 }, { token1: replacementCredit1 > newAmount1 ? replacementCredit1 : newAmount1, token2: replacementCredit2 > lockedToken ? replacementCredit2 : lockedToken })
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
	const executionPayload = buildHedgeExecutionPayload({
		expectedParentBlockHash: executionSnapshot.blockHash,
		executionIntent: {
			direction: refreshedQuote.direction,
			estimatedNetProfitWeth: decimalWeth(refreshedQuote.netProfitAttoWeth),
			estimatedProfitBeforeGasEth: decimalWeth(refreshedQuote.profitBeforeGasAttoWeth),
			reportId,
			requiredToken: formatTokenAmount(funding.token2, tokenMetadata.decimals),
			requiredWeth: decimalWeth(funding.token1),
			token: game.token2,
			tokenSymbol: tokenMetadata.symbol,
		},
		hedgePool,
		hedgeWethLimitAttoEth: hedgeLimit,
		newAmount1,
		newAmount2,
		openOracle: config.openOracle,
		router,
		selectedFee: hedgeFee,
		swapDeadline: executionSnapshot.blockTimestamp + 300n,
		venue: hedgeVenue,
	})
	const request = {
		address: executor,
		abi: openOracleArbitrageExecutorAbi,
		functionName: 'hedgeAndDispute',
		args: [executionPayload.hedgeRequest, getOpenOracleGameTuple(game), getOpenOracleHelperTuple(report.helper), openOracleDisputeTiming(quoteBlockNumber, executionSnapshot.blockTimestamp)],
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
	const capitalAtRiskAttoWeth = fundedCapitalAtRiskAttoWeth(funding, refreshedQuote.hedgeAmountAttoRep, hedgeLimitQuote, hedgeLimit)
	let stagedPosition = {
		account: account.address,
		actualEntryGasCostEth: '0',
		capitalAtRiskWeth: decimalWeth(capitalAtRiskAttoWeth),
		closedAt: undefined,
		direction: refreshedQuote.direction,
		entrySubmissionBlockNumber: quoteBlockNumber.toString(),
		entrySubmissionMode: config.submission.mode,
		entryTransactionIntent: durableTransactionIntent(executionSigned.transaction),
		entryTransactionNonce: executionSigned.transaction.nonce.toString(),
		entryTransactionHash: executionSigned.hash,
		entryTransactionHashes: signedTransactions.map(transaction => transaction.signed.hash),
		executionIntent: executionPayload.executionIntent,
		expiredTransactionAttempts: [],
		gasExpenditures: [],
		historyOutbox: undefined,
		hedgeAmountToken: formatTokenAmount(refreshedQuote.hedgeAmountAttoRep, tokenMetadata.decimals),
		hedgeWeth: decimalWeth(hedgeLimitQuote),
		hedgedProfitBeforeGasEth: decimalSignedEth(refreshedQuote.profitBeforeGasAttoWeth),
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
		reportAmount1: newAmount1.toString(),
		reportAmount2: newAmount2.toString(),
		reportFeePercentage: game.feePercentage.toString(),
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
		if (!meetsProfitThreshold(refreshedQuote, config.minimumProfitAttoWeth, config.minimumProfitBps)) throw new Error('Arbitrage no longer meets the profit threshold at submission')
		const submission = await submitContractTransaction(client, wallet, config, executionSigned, { estimatedNetProfitEth: decimalWeth(refreshedQuote.netProfitAttoWeth), kind: 'dispute', reportId }, isPaused, track, {
			beforeSubmit: async () => {
				if (!finalMarketPriceAllowsExecution() || !(await marketEvidenceStillCanonical())) throw new Error('Market consensus expired or no longer confirms the price before transaction submission')
			},
			persistPending: () => guardedRiskSubmission(positionRiskLimitMismatch({ capitalAtRiskAttoWeth, positions, projectedGasCostAttoWeth: gasPrice * 1_200_000n + lifecycleGasReserveAttoWeth }, config.riskLimits, dateFromBlockTimestamp(executionSnapshot.blockTimestamp)), () => persistPosition(stagedPosition)),
		})
		const { receipt: observedReceipt, tracked } = await waitForTrackedTransaction(client, wallet, config, submission, track, replacement =>
			persistPosition({
				...stagedPosition,
				entryTransactionHash: replacement.transaction.hash,
				entryTransactionHashes: [replacement.transaction.hash],
			}),
		)
		const receiptPosition = {
			...stagedPosition,
			entryTransactionHash: observedReceipt.transactionHash,
			entryTransactionHashes: [observedReceipt.transactionHash],
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
		const trackedNetProfitEth = decimalSignedEth(calculateTrackedNetProfitEth(refreshedQuote.profitBeforeGasAttoWeth, actualGasCost))
		track(trackedActivity(tracked, 'confirmed', decimalWeth(actualGasCost), receipt.transactionHash, trackedNetProfitEth))
	} else {
		const serializedTransactions = signedTransactions.map(transaction => transaction.signed.serializedTransaction)
		const submittedAt = new Date().toISOString()
		let tracked = signedTransactions.map(transaction => ({
			...transaction.signed,
			acceptedTargets: [] as readonly string[],
			estimatedNetProfitEth: transaction.kind === 'dispute' ? decimalWeth(refreshedQuote.netProfitAttoWeth) : undefined,
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
					minimumSuccessfulRelays: config.submission.minimumBundleRelaySuccesses,
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
		const simulatedQuote = safetyAdjustedQuote(refreshedQuote, totalGasUsed * gasPrice, lifecycleGasReserveAttoWeth, config)
		const simulatedNetProfit = simulatedQuote.netProfitAttoWeth
		if (!meetsProfitThreshold(simulatedQuote, config.minimumProfitAttoWeth, config.minimumProfitBps)) {
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
					if (!finalMarketPriceAllowsExecution() || !(await marketEvidenceStillCanonical())) throw new Error('Market consensus expired or no longer confirms the price before transaction submission')
				},
				() =>
					guardedRiskSubmission(positionRiskLimitMismatch({ capitalAtRiskAttoWeth, positions, projectedGasCostAttoWeth: totalGasUsed * gasPrice + lifecycleGasReserveAttoWeth }, config.riskLimits, dateFromBlockTimestamp(executionSnapshot.blockTimestamp)), () =>
						journaledSubmission(
							() => persistPosition(stagedPosition),
							() =>
								submitConfiguredSignedBundle(config.submission, {
									address: account.address,
									relayUrls: relaySimulations.successful.map(result => result.relayUrl),
									signMessage,
									targetBlockNumber,
									transactions: serializedTransactions,
								}),
							async () => {
								if (!finalMarketPriceAllowsExecution() || !(await marketEvidenceStillCanonical())) throw new Error('Market consensus expired or no longer confirms the price before transaction submission')
							},
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
			if (operationalFailureDisposition(error) === 'connectivity-degraded') throw error
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
		const trackedNetProfitEth = decimalSignedEth(calculateTrackedNetProfitEth(refreshedQuote.profitBeforeGasAttoWeth, actualGasCost))
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
		const hedgedProfitBeforeGas = hedgedProfitBeforeGasWeth(refreshedQuote.direction, hedgeExecution.hedgeAmountAttoWeth, game.currentAmount1, calculateFee(game.currentAmount1, game.feePercentage), calculateFee(game.currentAmount1, game.protocolFee))
		confirmedPosition = {
			...stagedPosition,
			actualEntryGasCostEth: decimalWeth(actualGasCost),
			entryTransactionHash: executionHash,
			entryTransactionHashes: [executionHash],
			gasExpenditures: entryGasExpenditures,
			hedgeAmountToken: formatTokenAmount(hedgeExecution.hedgeAmountToken2, tokenMetadata.decimals),
			hedgeWeth: decimalWeth(hedgeExecution.hedgeAmountAttoWeth),
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

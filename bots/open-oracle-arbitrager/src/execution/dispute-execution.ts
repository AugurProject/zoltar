import type { Configuration } from '#config/configuration'
import { openOracleArbitrageExecutorAbi } from '#contracts/abi'
import type { Pool, ReadClient, WriteClient } from '#core/operator-types'
import { expectedWithdrawalToken2, hedgedProfitBeforeGasToken1 } from '#core/position-accounting'
import { plannedGasPriceAttoEth, positionRiskLimitMismatch, projectedLifecycleGasReserveAttoWeth } from '#core/safety-controls'
import {
	calculateFee,
	chargesFees,
	gameFee,
	calculateNextAmount1,
	calculateTrackedNetProfitEth,
	deriveTokenToSwap,
	evaluateBuyRep,
	evaluateSellRep,
	executorFunding,
	executableDexPriceRepPerEth,
	fundedCapitalAtRiskAttoWeth,
	hasFreshSubmissionWindow,
	hedgeReferenceToken1,
	hedgeWethLimitAttoEth,
	isSelfReport,
	meetsProfitThreshold,
	spotTwapDeviationWithinLimit,
	type ArbitrageQuote,
} from '#core/strategy'
import { STANDARD_UNISWAP_FEES } from '#core/uniswap-v4'
import type { Venue } from '#core/venue-strategy'
import {
	assertCanonicalExecutionSnapshot,
	buildHedgeExecutionPayload,
	canonicalBlockHashWithQuorum,
	fundingTransactionPlan,
	guardedExecutionStep,
	guardedRiskSubmission,
	guardedTransactionSubmission,
	isExecutionPausedError,
	journaledSubmission,
	lifecycleAllowanceMismatch,
	openOracleDisputeTiming,
	privateEntryRecoveryIsConfirmed,
	selectBestExecution,
	simulateTrackedPrivateBundle,
	trackPrivateBundleReceiptStatuses,
	transactionReceiptsWithQuorum,
	waitForTargetBlock,
} from '#execution/execution-orchestration'
import { recoverPendingEntryWithQuorum } from '#execution/position-lifecycle'
import { confirmedGasExpenditures, currentBlockNumberWithQuorum, dateFromBlockTimestamp, durableTransactionIntent, hedgeExecutionFromLogs, pendingNonceWithQuorum, recoveredTransactionIntentMismatchWithQuorum } from '#execution/recovery-support'
import { prepareSignedTransaction, simulateSignedBundleEveryRelay, SubmissionFailure, submitConfiguredSignedBundle, type SubmissionTargetResult } from '#execution/transaction-submission'
import { receiptGasCost, submitContractTransaction, trackedActivity, waitForTrackedTransaction, type TrackTransaction } from '#execution/transaction-tracker'
import { formatTokenAmount } from '#monitoring/market-monitor'
import { executionReadQuorum, safetyAdjustedQuote } from '#monitoring/opportunity-evaluation'
import { decimalSignedEth, decimalWeth } from '#state/operator-state'
import type { PositionRecord } from '#state/position-store'
import { formatPositionCollateralAmount, type PositionCollateral } from '#state/position-collateral'
import { attoWethValue } from '#core/collateral-valuation'
import { encodeFunctionData, zeroAddress, type Address, type Hex } from '@zoltar/bot-shared/ethereum'
import { errorMessage } from '@zoltar/core-shared/errors/errorMessage'
import { centralizedMarketConfigurationAllowsExecution, centralizedPriceAllowsExecution, type CentralizedMarketEstimate } from '@zoltar/bot-shared/monitoring/centralized-markets'
import { marketConsensusAllowsExecution, type MarketConsensusEstimate } from '@zoltar/bot-shared/monitoring/market-consensus'
import { operationalFailureDisposition } from '@zoltar/bot-shared/monitoring/resilience'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_TIME_TYPE, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'

const FEES = STANDARD_UNISWAP_FEES

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
	/** Metadata of a non-WETH report collateral; undefined for WETH. */
	collateralMetadata: { decimals: number; symbol: string } | undefined,
	positions: readonly PositionRecord[],
	centralizedMarket: CentralizedMarketEstimate | undefined,
	marketConsensus: MarketConsensusEstimate | undefined,
	marketEvidenceStillCanonical: () => Promise<boolean>,
	isPaused: () => boolean,
	track: TrackTransaction,
	persistPosition: (position: PositionRecord) => Promise<void>,
	archivedDailyGasSpentAttoWeth = 0n,
): Promise<PositionRecord> {
	const account = wallet.account
	const executor = config.executor
	if (account === undefined || account.signTransaction === undefined || account.signMessage === undefined) throw new Error('Execution requires a local transaction and relay signer')
	if (executor === undefined) throw new Error('Execution requires a deployed OpenOracle arbitrage executor')
	let router = config.router
	let hedgePool = pool.address
	if (hedgeVenue === 'uniswap-v2') {
		router = config.v2Router
		hedgePool = pool.address
	} else if (hedgeVenue === 'uniswap-v4') {
		router = config.v4PoolManager
		hedgePool = config.v4PoolManager ?? zeroAddress
	}
	if (router === undefined) throw new Error('Execution requires an authenticated Uniswap router')
	if (hedgePool === zeroAddress) throw new Error('Execution requires a discovered or configured Uniswap pool')
	const game = report.game
	if (isSelfReport(account.address, game.currentReporter)) throw new Error('Self-disputes use different OpenOracle accounting and are not supported')
	const wethCollateral = game.token1.toLowerCase() === config.network.weth.toLowerCase()
	if (!wethCollateral && collateralMetadata === undefined) throw new Error('Non-WETH collateral execution requires collateral token metadata')
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
	if (pool.venue === 'uniswap-v3' && (executionSnapshot.v3State === undefined || !spotTwapDeviationWithinLimit(executionSnapshot.v3State.spotTick, executionSnapshot.v3State.twapTick, config.maxSpotTwapTicks))) throw new Error('Selected V3 pool failed the final spot/TWAP check')
	const gasPrice = plannedGasPriceAttoEth(executionSnapshot.baseFeePerGas)
	const lifecycleGasReserveAttoWeth = projectedLifecycleGasReserveAttoWeth({
		callbackGasLimit: BigInt(game.callbackGasLimit),
		configuredReserveAttoWeth: config.riskLimits.lifecycleGasReserveAttoWeth,
		gasPrice,
		submissionMode: config.submission.mode,
	})
	const entryGasCostAttoWeth = gasPrice * 1_200_000n
	const newAmount2 = executionSnapshot.replacementAmount2
	const tokenToSwap = deriveTokenToSwap(game, newAmount1, newAmount2)
	const refreshedQuote = selectBestExecution(
		[
			safetyAdjustedQuote(evaluateSellRep(game, executionSnapshot.sellHedgeQuote, 0n, executionSnapshot.valuation), entryGasCostAttoWeth, lifecycleGasReserveAttoWeth, config),
			safetyAdjustedQuote(evaluateBuyRep(game, executionSnapshot.buyHedgeQuote, 0n, executionSnapshot.valuation), entryGasCostAttoWeth, lifecycleGasReserveAttoWeth, config),
		].filter(candidate => candidate.tokenToSwap.toLowerCase() === tokenToSwap.toLowerCase()),
		candidate => candidate.netProfitAttoWeth,
	)
	if (refreshedQuote === undefined) throw new Error('Canonical execution snapshot did not produce an arbitrage quote')
	if (refreshedQuote.direction !== quote.direction) throw new Error('Best arbitrage direction changed before submission')
	const refreshedDexPriceRepPerEth = executableDexPriceRepPerEth(refreshedQuote)
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
	if (tokenToSwap.toLowerCase() !== refreshedQuote.tokenToSwap.toLowerCase()) throw new Error('Final replacement ratio does not derive the selected arbitrage direction')
	const hedgeLimitQuote = hedgeReferenceToken1(refreshedQuote)
	const hedgeLimit = hedgeWethLimitAttoEth(refreshedQuote.direction, hedgeLimitQuote, config.maxHedgeSlippageBps)
	const funding = executorFunding(game, newAmount1, newAmount2, refreshedQuote.direction === 'buy-rep' ? hedgeLimit : 0n)
	const collateral: PositionCollateral | undefined =
		collateralMetadata === undefined || wethCollateral ? undefined : { decimals: collateralMetadata.decimals, symbol: collateralMetadata.symbol, token: game.token1, valuationAttoWeth: executionSnapshot.valuation.attoWeth.toString(), valuationUnits: executionSnapshot.valuation.units.toString() }
	const collateralPosition = { collateral }
	if (executionSnapshot.token1 < funding.token1 || executionSnapshot.token < funding.token2) throw new Error('Canonical execution snapshot no longer has the inventory required by the signed bundle')
	const lockedToken = expectedWithdrawalToken2(refreshedQuote.direction, game.currentAmount2, newAmount2)
	const replacementFeePercentage = chargesFees({ ...game, currentAmount1: newAmount1 }) ? game.feePercentage : 0n
	const replacementCredit1 = 2n * newAmount1 + calculateFee(newAmount1, replacementFeePercentage)
	const replacementCredit2 = 2n * newAmount2 + calculateFee(newAmount2, replacementFeePercentage) + (lockedToken - newAmount2)
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
			...(collateral === undefined ? {} : { collateralSymbol: collateral.symbol }),
			direction: refreshedQuote.direction,
			estimatedNetProfitWeth: decimalWeth(refreshedQuote.netProfitAttoWeth),
			estimatedProfitBeforeGasEth: decimalWeth(refreshedQuote.profitBeforeGasAttoWeth),
			reportId,
			requiredToken: formatTokenAmount(funding.token2, tokenMetadata.decimals),
			requiredWeth: formatPositionCollateralAmount(collateralPosition, funding.token1),
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
	const capitalAtRiskAttoWeth = fundedCapitalAtRiskAttoWeth(funding, refreshedQuote.hedgeAmountAttoRep, hedgeLimitQuote, hedgeLimit, refreshedQuote.valuation)
	let stagedPosition = {
		account: account.address,
		actualEntryGasCostEth: '0',
		capitalAtRiskWeth: decimalWeth(capitalAtRiskAttoWeth),
		closedAt: undefined,
		...(collateral === undefined ? {} : { collateral }),
		direction: refreshedQuote.direction,
		entrySubmissionBlockNumber: quoteBlockNumber.toString(),
		entrySubmissionMode: config.submission.mode,
		entryTransactionIntent: durableTransactionIntent(executionSigned.transaction),
		entryTransactionNonce: executionSigned.transaction.nonce.toString(),
		positionId: executionSigned.hash,
		entryTransactionHash: executionSigned.hash,
		entryTransactionHashes: signedTransactions.map(transaction => transaction.signed.hash),
		executionIntent: executionPayload.executionIntent,
		expiredTransactionAttempts: [],
		gasExpenditures: [],
		historyOutbox: undefined,
		hedgeAmountToken: formatTokenAmount(refreshedQuote.hedgeAmountAttoRep, tokenMetadata.decimals),
		hedgeWeth: formatPositionCollateralAmount(collateralPosition, hedgeLimitQuote),
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
		lockedWeth: formatPositionCollateralAmount(collateralPosition, newAmount1),
		manualReconciliation: undefined,
		openedAt: new Date().toISOString(),
		reportAmount1: newAmount1.toString(),
		reportAmount2: newAmount2.toString(),
		reportDisputeIndex: game.numReports.toString(),
		reportFeePercentage: replacementFeePercentage.toString(),
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
	let receiptBlockHash: Hex
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
			persistPending: () =>
				guardedRiskSubmission(positionRiskLimitMismatch({ archivedDailyGasSpentAttoWeth, capitalAtRiskAttoWeth, positions, projectedGasCostAttoWeth: gasPrice * 1_200_000n + lifecycleGasReserveAttoWeth }, config.riskLimits, dateFromBlockTimestamp(executionSnapshot.blockTimestamp)), () =>
					persistPosition(stagedPosition),
				),
		})
		const { receipt: observedReceipt, tracked } = await waitForTrackedTransaction(
			client,
			wallet,
			config,
			submission,
			track,
			replacement =>
				persistPosition({
					...stagedPosition,
					entryTransactionHash: replacement.transaction.hash,
					entryTransactionHashes: [replacement.transaction.hash],
				}),
			isPaused,
		)
		const receiptPosition = {
			...stagedPosition,
			entryTransactionHash: observedReceipt.transactionHash,
			entryTransactionHashes: [observedReceipt.transactionHash],
		}
		await persistPosition(receiptPosition)
		const receipts = await transactionReceiptsWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], `public entry ${reportId}`, [observedReceipt.transactionHash], config.rpcQuorum)
		const receipt = receipts[0]
		if (receipt === undefined) throw new Error('Public dispute receipt quorum is missing')
		actualGasCost = receiptGasCost(receipt)
		entryGasExpenditures = await confirmedGasExpenditures(readClients, config, `public entry ${reportId}`, [receipt])
		if (receipt.status !== 'success') {
			const closedAt = entryGasExpenditures[0]?.includedAt
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
		receiptBlockHash = receipt.blockHash
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
			profitBeforeGasAttoEth: undefined,
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
					const canonicalHash = await canonicalBlockHashWithQuorum(readClients, [config.connectivity.readRpcUrl, ...config.quorumRpcUrls], 'execution submission', quoteBlockNumber, config.rpcQuorum)
					if (canonicalHash.toLowerCase() !== executionSnapshot.blockHash.toLowerCase()) throw new Error('Bundle canonical parent changed before submission')
					if (!finalMarketPriceAllowsExecution() || !(await marketEvidenceStillCanonical())) throw new Error('Market consensus expired or no longer confirms the price before transaction submission')
				},
				() =>
					guardedRiskSubmission(positionRiskLimitMismatch({ archivedDailyGasSpentAttoWeth, capitalAtRiskAttoWeth, positions, projectedGasCostAttoWeth: totalGasUsed * gasPrice + lifecycleGasReserveAttoWeth }, config.riskLimits, dateFromBlockTimestamp(executionSnapshot.blockTimestamp)), () =>
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
								await guardedExecutionStep(isPaused, async () => {})
								if (!finalMarketPriceAllowsExecution() || !(await marketEvidenceStillCanonical())) throw new Error('Market consensus expired or no longer confirms the price before transaction submission')
								await guardedExecutionStep(isPaused, async () => {})
							},
						),
					),
			)
		} catch (error) {
			if (isExecutionPausedError(error)) throw error
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
		await waitForTargetBlock(client, isPaused, config.pollMilliseconds, targetBlockNumber)
		await guardedExecutionStep(isPaused, async () => {})
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
		receiptBlockHash = executorReceipt.blockHash
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
		const hedgedProfitBeforeGas = attoWethValue(refreshedQuote.valuation, hedgedProfitBeforeGasToken1(refreshedQuote.direction, hedgeExecution.hedgeAmountAttoWeth, game.currentAmount1, gameFee(game, game.currentAmount1, game.feePercentage), gameFee(game, game.currentAmount1, game.protocolFee)), 'down')
		confirmedPosition = {
			...stagedPosition,
			actualEntryGasCostEth: decimalWeth(actualGasCost),
			entryReceiptBlockHash: receiptBlockHash,
			entryReceiptBlockNumber: receiptBlockNumber.toString(),
			entryTransactionHash: executionHash,
			entryTransactionHashes: [executionHash],
			gasExpenditures: entryGasExpenditures,
			hedgeAmountToken: formatTokenAmount(hedgeExecution.hedgeAmountToken2, tokenMetadata.decimals),
			hedgeWeth: formatPositionCollateralAmount(collateralPosition, hedgeExecution.hedgeAmountAttoWeth),
			hedgedProfitBeforeGasEth: decimalSignedEth(hedgedProfitBeforeGas),
			status: 'open-pending-finality',
		}
	}
	if (confirmedPosition === undefined) throw new Error('Confirmed position accounting is unavailable')
	// The entry holds its risk slot as `open-pending-finality`; position maintenance releases its history record once the receipt block is final.
	await persistPosition(confirmedPosition)
	console.log(`report=${report.helper.reportId.toString()} dispute=${executionHash}`)
	return confirmedPosition
}

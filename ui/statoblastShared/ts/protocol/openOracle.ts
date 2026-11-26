import { oracleErrors, reportStateMismatch, safeIntegerRangeExceeded } from '../copy/protocolErrors.js'
import { resolveOpenOracleDisputeFlows } from './openOracleDisputeFlows.js'
import { getOpenOracleSettlementGasLimit } from './openOracleSettlementSafety.js'
import { loadOpenOracleTokenMetadata, type OpenOracleTokenMetadata } from './openOracleTokenMetadata.js'
import { wethDepositAbi, wrapWeth } from './wethFunding.js'
import { runFundingTransactions, type FundingTransaction } from './fundingTransactions.js'
import { bigintToSafeNumber, encodeFunctionData, toEventSelector, zeroAddress, type Address, type Hex, type TransactionReceipt } from '@zoltar/core-shared/evm/ethereum'
import { getOpenOracleGameTuple, getOpenOracleHelperTuple, hasOpenOracleFlag, hashOpenOracleStatePreimage, OPEN_ORACLE_FLAG_STORE_ALL, OPEN_ORACLE_FLAG_STORE_PRICE, OPEN_ORACLE_FLAG_TIME_TYPE, OPEN_ORACLE_FLAG_TRACK_DISPUTES, type OpenOracleStatePreimage } from '@zoltar/open-oracle-shared/openOracle/openOracle'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import { getOpenOracleDisputeSwapTokenKey, OPEN_ORACLE_PRICE_UNITS } from './openOracleMath.js'
import { getOpenOracleCreateParameterValidation } from './openOracleValidation.js'
import { getWethAddress } from '@zoltar/ui-zoltar-shared/protocol/uniswapQuoter.js'
import { statoblast_openOracle_OpenOracle_OpenOracle } from '../contractArtifact.js'
import type { ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { OpenOracleActionResult, OpenOracleReportDetails, OpenOracleWithdrawableBalances, OpenOracleReportSummary, OpenOracleReportSummaryPage } from '../types/contracts.js'
import { getProtocolPageOffset, hasTimestampAndNumber } from '@zoltar/ui-zoltar-shared/protocol/helpers.js'
import { type WriteContractClient, writeContractAndWait, writeContractAndWaitForReceipt } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getOpenOracleAddress } from './deploymentHelpers.js'
import { loadOpenOracleStoredState, isOpenOracleStateUnavailable } from './openOracleState.js'
import { getAuthenticatedReportEscrowFeed, getOpenOraclePriceSettlement, isFeedAuthenticatedReportEscrow, loadCoordinatorPriceValidUntilTimestamp } from './openOracleSettlement.js'
import * as openOracleCopy from '../copy/openOracle.js'
import { requireBigintValue } from './decoders.js'
import { requireOpenOracleDisputeSubmissionWindow } from './openOracleDisputeTiming.js'

// Flags mirrored from OpenOracle.sol that the shared package does not export.
const OPEN_ORACLE_FLAG_FEES_ONLY_AT_HALT = 1n << 5n
const OPEN_ORACLE_FLAG_FLEXIBLE_ESCALATION = 1n << 6n
const OPEN_ORACLE_REPORT_MISSING_ERROR_NAME = 'OpenOracleReportMissingError'

function createOpenOracleReportMissingError(reportId: bigint) {
	const error = new Error(openOracleCopy.formatReportMissing(reportId.toString()))
	error.name = OPEN_ORACLE_REPORT_MISSING_ERROR_NAME
	return error
}

export function isOpenOracleReportMissingError(error: unknown) {
	return error instanceof Error && error.name === OPEN_ORACLE_REPORT_MISSING_ERROR_NAME
}

function getOpenOracleDisputeSwapToken(game: Pick<OpenOracleStatePreimage['game'], 'currentAmount1' | 'currentAmount2' | 'token1' | 'token2'>, newAmount1: bigint, newAmount2: bigint) {
	return getOpenOracleDisputeSwapTokenKey({
		currentAmount1: game.currentAmount1,
		currentAmount2: game.currentAmount2,
		newAmount1,
		newAmount2,
	}) === 'token2'
		? game.token2
		: game.token1
}

function requireOpenOracleTokenMetadata(metadata: ReadonlyMap<string, OpenOracleTokenMetadata>, token: Address) {
	const result = metadata.get(token.toLowerCase())
	if (result === undefined) throw new Error(oracleErrors.tokenDetails)
	return result
}

// Quote tokens per base token (token2 per token1), for example REP per WETH for Statoblast price reports.
export function calculateOpenOraclePrice(amount1: bigint, amount2: bigint, decimals1: number, decimals2: number) {
	return amount1 === 0n ? 0n : (amount2 * 10n ** (BigInt(OPEN_ORACLE_PRICE_UNITS) + BigInt(decimals1))) / (amount1 * 10n ** BigInt(decimals2))
}

/**
 * Budgets callback execution and, unless the callback is a feed-authenticated report escrow,
 * caller-side return-data processing. Throws instead of requesting more than one transaction may use.
 */
export function getOpenOracleSettleGasLimit(game: Pick<OpenOracleStatePreimage['game'], 'callbackContract' | 'callbackGasLimit'>, trustedCallback: boolean) {
	const limit = getOpenOracleSettlementGasLimit(game, trustedCallback)
	if (limit.refusal !== undefined) throw new Error(limit.refusal)
	return limit.gas
}

export async function loadOpenOracleReportDetails(client: ReadClient, openOracleAddress: Address, reportId: bigint): Promise<OpenOracleReportDetails> {
	const [storedState, stateHash, block] = await Promise.all([
		loadOpenOracleStoredState(client, openOracleAddress, reportId).catch(error => {
			if (error instanceof Error && error.message === openOracleCopy.formatReportMissing(reportId.toString())) throw createOpenOracleReportMissingError(reportId)
			throw error
		}),
		client.readContract({
			abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'oracleGame',
			address: openOracleAddress,
			args: [reportId],
		}),
		client.getBlock(),
	])
	if (!hasTimestampAndNumber(block)) throw new Error(oracleErrors.blockResponse)
	const { game } = storedState.latest
	const expectedStateHash = hashOpenOracleStatePreimage(storedState.latest)
	if (stateHash.toLowerCase() !== expectedStateHash.toLowerCase()) throw new Error(reportStateMismatch(reportId))
	const [tokenMetadata, trustedSettlementCallback] = await Promise.all([loadOpenOracleTokenMetadata(client, [game.token1, game.token2]), isFeedAuthenticatedReportEscrow(client, openOracleAddress, game.callbackContract, reportId)])
	const token1Metadata = requireOpenOracleTokenMetadata(tokenMetadata, game.token1)
	const token2Metadata = requireOpenOracleTokenMetadata(tokenMetadata, game.token2)
	if (token1Metadata.status === 'failure') throw new Error(token1Metadata.message)
	if (token2Metadata.status === 'failure') throw new Error(token2Metadata.message)
	return {
		reportId,
		openOracleAddress,
		coordinatorPriceValidUntilTimestamp: await loadCoordinatorPriceValidUntilTimestamp(client, openOracleAddress, game, client.chain?.id, reportId),
		currentTime: block.timestamp,
		currentBlockNumber: block.number,
		exactToken1Report: storedState.initialAmount1,
		escalationHalt: game.escalationHalt,
		settlerRewardAttoEth: game.settlerRewardAttoEth,
		token1: game.token1,
		settlementTime: game.settlementTime,
		token2: game.token2,
		timeType: hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_TIME_TYPE),
		feePercentage: game.feePercentage,
		protocolFee: game.protocolFee,
		multiplier: game.multiplier,
		disputeDelay: game.disputeDelay,
		currentAmount1: game.currentAmount1,
		currentAmount2: game.currentAmount2,
		price: calculateOpenOraclePrice(game.currentAmount1, game.currentAmount2, token1Metadata.decimals, token2Metadata.decimals),
		currentReporter: game.currentReporter,
		reportTimestamp: game.reportTimestamp,
		settlementTimestamp: game.settlementTimestamp,
		initialReporter: storedState.initialReporter,
		disputeOccurred: storedState.reportCount > 1n,
		isDistributed: storedState.settled,
		stateHash,
		callbackContract: game.callbackContract,
		trustedSettlementCallback,
		numReports: storedState.reportCount,
		callbackGasLimit: bigintToSafeNumber(game.callbackGasLimit, openOracleCopy.callbackGasLimit),
		protocolFeeRecipient: game.protocolFeeRecipient,
		trackDisputes: hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_TRACK_DISPUTES),
		feesOnlyAtHalt: hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_FEES_ONLY_AT_HALT),
		flexibleEscalation: hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_FLEXIBLE_ESCALATION),
		lastReportOppoTime: game.lastReportOppoTime,
		token1Decimals: token1Metadata.decimals,
		token2Decimals: token2Metadata.decimals,
		token1Symbol: token1Metadata.label,
		token2Symbol: token2Metadata.label,
	}
}
/** A browse summary that also carries the report's lifecycle timing, so browsing can show whether it is ready to settle. */
export type OpenOracleReportTimedSummary = OpenOracleReportSummary & Pick<OpenOracleReportDetails, 'disputeDelay' | 'settlementTime'>

export async function loadOpenOracleReportSummaries(client: ReadClient, pageIndex: number, pageSize: number): Promise<OpenOracleReportSummaryPage & { reports: OpenOracleReportTimedSummary[] }> {
	const pageOffset = getProtocolPageOffset(pageIndex, pageSize)
	const openOracleAddress = getOpenOracleAddress()
	const nextReportId = await client.readContract({
		abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'nextReportId',
		address: openOracleAddress,
		args: [],
	})
	const reportCount = nextReportId > 0n ? nextReportId - 1n : 0n
	if (reportCount === 0n)
		return {
			nextReportId,
			pageIndex,
			pageSize,
			reportCount,
			reports: [],
		}
	const pageSizeBigInt = BigInt(pageSize)
	const pageEndId = reportCount - pageOffset
	if (pageEndId <= 0n)
		return {
			nextReportId,
			pageIndex,
			pageSize,
			reportCount,
			reports: [],
		}
	const pageStartId = pageEndId > pageSizeBigInt ? pageEndId - pageSizeBigInt + 1n : 1n
	const reportIds: bigint[] = []
	for (let reportId = pageEndId; reportId >= pageStartId; reportId--) {
		reportIds.push(reportId)
		if (reportId === pageStartId) break
	}
	const unavailableReports: Array<{ reportId: bigint; message: string }> = []
	const storedStates = new Map<bigint, Awaited<ReturnType<typeof loadOpenOracleStoredState>>>()
	await Promise.all(
		reportIds.map(async reportId => {
			try {
				storedStates.set(reportId, await loadOpenOracleStoredState(client, openOracleAddress, reportId))
			} catch (error) {
				if (!isOpenOracleStateUnavailable(error)) throw error
				unavailableReports.push({ reportId, message: error.message })
			}
		}),
	)
	const storedReportIds = reportIds.filter(reportId => storedStates.has(reportId))
	const tokenAddresses: Address[] = []
	for (const reportId of storedReportIds) {
		const state = storedStates.get(reportId)
		if (state === undefined) throw new Error(openOracleCopy.formatReportMissing(reportId.toString()))
		tokenAddresses.push(state.latest.game.token1, state.latest.game.token2)
	}
	// A token with unusable metadata makes only its own reports unavailable, never the whole page.
	const tokenMetadata = await loadOpenOracleTokenMetadata(client, tokenAddresses)
	const reports: OpenOracleReportTimedSummary[] = []
	for (const reportId of storedReportIds) {
		const state = storedStates.get(reportId)
		if (state === undefined) throw new Error(oracleErrors.reportSummary)
		const game = state.latest.game
		const token1Metadata = requireOpenOracleTokenMetadata(tokenMetadata, game.token1)
		const token2Metadata = requireOpenOracleTokenMetadata(tokenMetadata, game.token2)
		if (token1Metadata.status === 'failure') {
			unavailableReports.push({ reportId, message: openOracleCopy.formatReportTokenMetadataUnavailable(reportId.toString(), token1Metadata.message) })
			continue
		}
		if (token2Metadata.status === 'failure') {
			unavailableReports.push({ reportId, message: openOracleCopy.formatReportTokenMetadataUnavailable(reportId.toString(), token2Metadata.message) })
			continue
		}
		reports.push({
			currentAmount1: game.currentAmount1,
			currentAmount2: game.currentAmount2,
			currentReporter: game.currentReporter,
			disputeDelay: game.disputeDelay,
			disputeOccurred: state.reportCount > 1n,
			exactToken1Report: state.initialAmount1,
			isDistributed: state.settled,
			price: calculateOpenOraclePrice(game.currentAmount1, game.currentAmount2, token1Metadata.decimals, token2Metadata.decimals),
			reportId,
			reportTimestamp: game.reportTimestamp,
			settlementTime: game.settlementTime,
			settlementTimestamp: game.settlementTimestamp,
			timeType: hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_TIME_TYPE),
			token1: game.token1,
			token2: game.token2,
			token1Decimals: token1Metadata.decimals,
			token2Decimals: token2Metadata.decimals,
			token1Symbol: token1Metadata.label,
			token2Symbol: token2Metadata.label,
		})
	}
	unavailableReports.sort((a, b) => (a.reportId > b.reportId ? -1 : 1))
	return {
		nextReportId,
		pageIndex,
		pageSize,
		reportCount,
		reports,
		unavailableReports,
	}
}
export async function createOpenOracleReportInstance(
	client: WriteClient,
	parameters: {
		disputeDelay: number
		escalationHalt: bigint
		exactToken1Report: bigint
		initialToken2Amount: bigint
		ethValueAttoEth: bigint
		feePercentage: number
		multiplier: number
		protocolFee: number
		settlementTime: number
		settlerRewardAttoEth: bigint
		token1Address: Address
		token2Address: Address
	},
) {
	const assertSafeInteger = (value: number, label: string) => {
		if (!Number.isSafeInteger(value)) throw new Error(safeIntegerRangeExceeded(label))
	}
	assertSafeInteger(parameters.disputeDelay, 'Dispute delay')
	assertSafeInteger(parameters.feePercentage, 'Dispute fee')
	assertSafeInteger(parameters.multiplier, 'Multiplier')
	assertSafeInteger(parameters.protocolFee, 'Protocol fee')
	assertSafeInteger(parameters.settlementTime, 'Settlement delay')
	const parameterValidation = getOpenOracleCreateParameterValidation({
		disputeDelay: BigInt(parameters.disputeDelay),
		escalationHalt: parameters.escalationHalt,
		exactToken1Report: parameters.exactToken1Report,
		initialToken2Amount: parameters.initialToken2Amount,
		ethValueAttoEth: parameters.ethValueAttoEth,
		feePercentage: BigInt(parameters.feePercentage),
		multiplier: BigInt(parameters.multiplier),
		protocolFee: BigInt(parameters.protocolFee),
		settlementTime: BigInt(parameters.settlementTime),
		settlerRewardAttoEth: parameters.settlerRewardAttoEth,
		token1Address: parameters.token1Address,
		token2Address: parameters.token2Address,
	})
	if (parameterValidation !== undefined) throw new Error(parameterValidation.message ?? openOracleCopy.invalidReportParameters)
	let wethFundingAmountAttoEth = 0n
	if (sameAddress(parameters.token1Address, getWethAddress())) wethFundingAmountAttoEth = parameters.exactToken1Report
	else if (sameAddress(parameters.token2Address, getWethAddress())) wethFundingAmountAttoEth = parameters.initialToken2Amount
	let wethShortfallAttoEth = 0n
	if (wethFundingAmountAttoEth > 0n) {
		const wethBalanceAttoEth = await client.readContract({
			address: getWethAddress(),
			abi: ABIS.mainnet.erc20,
			functionName: 'balanceOf',
			args: [client.account.address],
		})
		if (wethBalanceAttoEth < wethFundingAmountAttoEth) wethShortfallAttoEth = wethFundingAmountAttoEth - wethBalanceAttoEth
	}
	const [token1Balance, token2Balance, ethBalanceAttoEth] = await Promise.all([
		client.readContract({ address: parameters.token1Address, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [client.account.address] }),
		client.readContract({ address: parameters.token2Address, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [client.account.address] }),
		client.getBalance({ address: client.account.address }),
	])
	if (token1Balance + (sameAddress(parameters.token1Address, getWethAddress()) ? wethShortfallAttoEth : 0n) < parameters.exactToken1Report) throw new Error(oracleErrors.baseBalance)
	if (token2Balance + (sameAddress(parameters.token2Address, getWethAddress()) ? wethShortfallAttoEth : 0n) < parameters.initialToken2Amount) throw new Error(oracleErrors.quoteBalance)
	if (ethBalanceAttoEth < parameters.ethValueAttoEth + wethShortfallAttoEth) throw new Error(oracleErrors.rewardAndFundingBalance)
	const [token1Allowance, token2Allowance] = await Promise.all([
		client.readContract({ address: parameters.token1Address, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [client.account.address, getOpenOracleAddress()] }),
		client.readContract({ address: parameters.token2Address, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [client.account.address, getOpenOracleAddress()] }),
	])
	const needsToken1Approval = token1Allowance < parameters.exactToken1Report
	const needsToken2Approval = token2Allowance < parameters.initialToken2Amount
	const actions: FundingTransaction[] = []
	if (wethShortfallAttoEth > 0n)
		actions.push({
			step: { functionName: 'deposit', contractAddress: getWethAddress(), value: wethShortfallAttoEth, data: encodeFunctionData({ abi: wethDepositAbi, functionName: 'deposit' }) },
			isRequired: async () => (await client.readContract({ address: getWethAddress(), abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [client.account.address] })) < wethFundingAmountAttoEth,
			execute: async () => await wrapWeth(client, wethShortfallAttoEth),
		})
	const token1Funding = { needed: needsToken1Approval, token: parameters.token1Address, required: parameters.exactToken1Report }
	const token2Funding = { needed: needsToken2Approval, token: parameters.token2Address, required: parameters.initialToken2Amount }
	const fundingOrder = sameAddress(parameters.token2Address, getWethAddress()) ? [token2Funding, token1Funding] : [token1Funding, token2Funding]
	for (const funding of fundingOrder) {
		if (!funding.needed) continue
		const call = { address: funding.token, abi: ABIS.mainnet.erc20, functionName: 'approve', args: [getOpenOracleAddress(), funding.required] } as const
		actions.push({
			step: { functionName: call.functionName, contractAddress: call.address, args: call.args, data: encodeFunctionData(call) },
			isRequired: async () => (await client.readContract({ address: funding.token, abi: ABIS.mainnet.erc20, functionName: 'allowance', args: [client.account.address, getOpenOracleAddress()] })) < funding.required,
			execute: async () => await writeContractAndWait(client, () => call),
		})
	}
	await runFundingTransactions(client, actions, {
		functionName: 'report',
		oracleOutcome: { settlerRewardAttoEth: parameters.settlerRewardAttoEth, returnToWallet: false },
		contractAddress: getOpenOracleAddress(),
		value: parameters.ethValueAttoEth,
		tokenFunding: fundingOrder.map(funding => ({ tokenAddress: funding.token, amount: funding.required })),
		validateBeforeSubmit: async () => {
			if ((await client.getBalance({ address: client.account.address })) < parameters.ethValueAttoEth) throw new Error(oracleErrors.rewardBalance)
		},
	})
	const callParams = {
		address: getOpenOracleAddress(),
		abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'report',
		args: [
			[
				parameters.exactToken1Report,
				parameters.initialToken2Amount,
				client.account.address,
				0n,
				0n,
				parameters.token1Address,
				0n,
				BigInt(parameters.settlementTime),
				parameters.escalationHalt,
				client.account.address,
				parameters.settlerRewardAttoEth,
				parameters.token2Address,
				0,
				parameters.disputeDelay,
				parameters.feePercentage,
				parameters.multiplier,
				zeroAddress,
				0,
				parameters.protocolFee,
				bigintToSafeNumber(OPEN_ORACLE_FLAG_TIME_TYPE | OPEN_ORACLE_FLAG_TRACK_DISPUTES | OPEN_ORACLE_FLAG_STORE_ALL | OPEN_ORACLE_FLAG_STORE_PRICE, 'OpenOracle flags'),
			],
			false,
			false,
			[0n, 0n, 0n, 0n],
		],
		value: parameters.ethValueAttoEth,
	}
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => callParams)
	return {
		action: 'createReportInstance',
		hash,
		reportId: getOpenOracleSubmittedReportId(receipt, getOpenOracleAddress()),
	} satisfies OpenOracleActionResult
}

// ReportSubmitted is emitted with a raw log2 whose data is the packed report rather than ABI-encoded bytes, so only its topics are decoded.
function getOpenOracleReportSubmittedTopic() {
	const event = statoblast_openOracle_OpenOracle_OpenOracle.abi.find(item => item.type === 'event' && item.name === 'ReportSubmitted')
	if (event === undefined) throw new Error(oracleErrors.receiptUnverified)
	return toEventSelector(event).toLowerCase()
}

function getOpenOracleSubmittedReportId(receipt: { logs?: readonly Pick<TransactionReceipt['logs'][number], 'address' | 'topics'>[] }, openOracleAddress: Address) {
	const reportSubmittedTopic = getOpenOracleReportSubmittedTopic()
	for (const log of receipt.logs ?? []) {
		if (!sameAddress(log.address, openOracleAddress)) continue
		const [selector, reportIdTopic] = log.topics
		if (selector?.toLowerCase() !== reportSubmittedTopic || reportIdTopic === undefined) continue
		return BigInt(reportIdTopic)
	}
	return undefined
}

/** Reads the report ID of a successful create result; other action results carry none. */
export function getCreatedOpenOracleReportId(result: OpenOracleActionResult | undefined) {
	return result?.action === 'createReportInstance' ? result.reportId : undefined
}
export async function loadOpenOracleWithdrawableBalances(client: Pick<ReadClient, 'readContract'>, openOracleAddress: Address, holder: Address, token1: Address, token2: Address): Promise<OpenOracleWithdrawableBalances> {
	const loadBalance = async (token: Address) =>
		requireBigintValue(
			await client.readContract({
				address: openOracleAddress,
				abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
				functionName: 'tokenHolder',
				args: [holder, token],
			}),
			'OpenOracle token holder balance',
		)
	const [rawAttoEth, rawToken1, rawToken2] = await Promise.all([loadBalance(zeroAddress), loadBalance(token1), loadBalance(token2)])
	const availableBalance = (balance: bigint) => (balance > 1n ? balance - 1n : 0n)
	return {
		ethAttoEth: availableBalance(rawAttoEth),
		token1: availableBalance(rawToken1),
		token2: availableBalance(rawToken2),
	}
}
export async function withdrawOpenOracleBalance<TReceipt extends Pick<TransactionReceipt, 'status'>>(
	client: WriteContractClient<TReceipt> & Partial<Pick<ReadClient, 'readContract'> & Pick<WriteClient, 'account'>>,
	openOracleAddress: Address,
	token: Address,
	amount: bigint,
	recipient: Address,
): Promise<OpenOracleActionResult> {
	const callParams = {
		address: openOracleAddress,
		abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'withdrawTo',
		args: [token, amount, recipient],
	}
	client.onTransactionPlan?.([
		{
			...callParams,
			contractAddress: openOracleAddress,
			validateBeforeSubmit: async () => {
				const { readContract, account } = client
				if (readContract === undefined || account === undefined) throw new Error(oracleErrors.withdrawalWallet)
				const balance = await readContract({ address: openOracleAddress, abi: statoblast_openOracle_OpenOracle_OpenOracle.abi, functionName: 'tokenHolder', args: [account.address, token] })
				if (amount <= 0n || balance <= amount) throw new Error(oracleErrors.withdrawalChanged)
			},
		},
	])
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'withdrawBalance',
		hash,
	}
}
export async function settleOracleReport(client: WriteClient, openOracleAddress: Address, reportId: bigint): Promise<OpenOracleActionResult>
export async function settleOracleReport<TReceipt extends Pick<TransactionReceipt, 'status'> & Partial<Pick<TransactionReceipt, 'logs'>>>(client: WriteContractClient<TReceipt>, openOracleAddress: Address, reportId: bigint, preimage: OpenOracleStatePreimage): Promise<OpenOracleActionResult>
export async function settleOracleReport<TReceipt extends Pick<TransactionReceipt, 'status'> & Partial<Pick<TransactionReceipt, 'logs'>>>(
	client: WriteContractClient<TReceipt> & Partial<Pick<ReadClient, 'readContract' | 'getBlock' | 'multicall'> & Pick<WriteClient, 'account'>>,
	openOracleAddress: Address,
	reportId: bigint,
	preimage?: OpenOracleStatePreimage,
) {
	let resolvedPreimage = preimage
	if (resolvedPreimage === undefined) {
		const { readContract } = client
		if (readContract === undefined) throw new Error(oracleErrors.reportStateUnavailable)
		resolvedPreimage = (await loadOpenOracleStoredState({ readContract }, openOracleAddress, reportId)).latest
	}
	const coordinatorPriceValidUntilTimestamp = client.multicall === undefined ? undefined : await loadCoordinatorPriceValidUntilTimestamp({ multicall: client.multicall }, openOracleAddress, resolvedPreimage.game, client.chain?.id, reportId)
	const reviewedBlock = coordinatorPriceValidUntilTimestamp === undefined ? undefined : await client.getBlock?.()
	const reviewedPriceExpired = coordinatorPriceValidUntilTimestamp !== undefined && reviewedBlock !== undefined && reviewedBlock.timestamp >= coordinatorPriceValidUntilTimestamp
	const reviewedStateHash = hashOpenOracleStatePreimage(resolvedPreimage)
	const priceFeed = client.multicall === undefined ? undefined : await getAuthenticatedReportEscrowFeed({ multicall: client.multicall }, openOracleAddress, resolvedPreimage.game.callbackContract, reportId)
	const callParams = {
		address: openOracleAddress,
		abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'settle',
		...(reviewedPriceExpired ? { reviewDescription: openOracleCopy.staleSettlementWarning } : {}),
		gas: getOpenOracleSettleGasLimit(resolvedPreimage.game, priceFeed !== undefined),
		args: [reportId, getOpenOracleGameTuple(resolvedPreimage.game), getOpenOracleHelperTuple(resolvedPreimage.helper)],
	}
	client.onTransactionPlan?.([
		{
			...callParams,
			contractAddress: openOracleAddress,
			validateBeforeSubmit: async () => {
				const { readContract, getBlock } = client
				if (readContract === undefined || getBlock === undefined) throw new Error(oracleErrors.settlementWallet)
				const current = await loadOpenOracleStoredState({ readContract }, openOracleAddress, reportId)
				if (current.settled) throw new Error(openOracleCopy.reportAlreadySettled)
				if (current.stateHash.toLowerCase() !== reviewedStateHash.toLowerCase()) throw new Error(oracleErrors.settlementChanged)
				const block = await getBlock()
				const clock = hasOpenOracleFlag(current.latest.game, OPEN_ORACLE_FLAG_TIME_TYPE) ? block.timestamp : block.number
				if (clock === undefined || clock < current.latest.game.reportTimestamp + current.latest.game.settlementTime) throw new Error(oracleErrors.settlementNotReady)
				if (!reviewedPriceExpired && coordinatorPriceValidUntilTimestamp !== undefined && block.timestamp >= coordinatorPriceValidUntilTimestamp) throw new Error(openOracleCopy.priceExpiredDuringReview)
			},
		},
	])
	const { hash, receipt } = await writeContractAndWaitForReceipt(client, () => callParams)
	const priceSettlement = priceFeed === undefined ? undefined : (getOpenOraclePriceSettlement(receipt, priceFeed, reportId) ?? { status: 'unconfirmed' as const })
	return {
		action: 'settle',
		hash,
		priceSettlement,
	} satisfies OpenOracleActionResult
}
export async function disputeOracleReport(client: WriteClient, openOracleAddress: Address, reportId: bigint, tokenToSwap: Address, newAmount1: bigint, newAmount2: bigint, _amt2Expected: bigint, stateHash: Hex) {
	const state = await requireOpenOracleDisputeSubmissionWindow(client, openOracleAddress, reportId)
	const currentStateHash = hashOpenOracleStatePreimage(state.latest)
	if (currentStateHash.toLowerCase() !== stateHash.toLowerCase()) throw new Error(oracleErrors.disputeChanged)
	const derivedTokenToSwap = getOpenOracleDisputeSwapToken(state.latest.game, newAmount1, newAmount2)
	if (derivedTokenToSwap.toLowerCase() !== tokenToSwap.toLowerCase()) throw new Error(oracleErrors.swapDirection)
	const game = state.latest.game
	const flows = resolveOpenOracleDisputeFlows({
		chargeFees: !hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_FEES_ONLY_AT_HALT) || game.currentAmount1 >= game.escalationHalt,
		feePercentage: game.feePercentage,
		protocolFee: game.protocolFee,
		isSelfDispute: sameAddress(game.currentReporter, client.account.address),
		oldAmount1: game.currentAmount1,
		oldAmount2: game.currentAmount2,
		newAmount1,
		newAmount2,
		tokenToSwap: sameAddress(derivedTokenToSwap, game.token1) ? 'token1' : 'token2',
	})
	const value = (game.token1 === zeroAddress ? flows.token1Contribution : 0n) + (game.token2 === zeroAddress ? flows.token2Contribution : 0n)
	const callParams = {
		address: openOracleAddress,
		abi: statoblast_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'dispute',
		value,
		args: [reportId, newAmount1, newAmount2, client.account.address, false, false, getOpenOracleGameTuple(state.latest.game), getOpenOracleHelperTuple(state.latest.helper), [0n, 0n, 0n, 0n]],
	}
	client.onTransactionPlan?.([
		{
			...callParams,
			contractAddress: openOracleAddress,
			validateBeforeSubmit: async () => {
				const currentState = await requireOpenOracleDisputeSubmissionWindow(client, openOracleAddress, reportId)
				if (hashOpenOracleStatePreimage(currentState.latest).toLowerCase() !== stateHash.toLowerCase()) throw new Error(oracleErrors.disputeChanged)
			},
		},
	])
	const hash = await writeContractAndWait(client, () => callParams)
	return {
		action: 'dispute',
		hash,
	} satisfies OpenOracleActionResult
}

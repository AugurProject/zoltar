import type { Address, Hex, TransactionLog } from '@zoltar/shared/ethereum'
import {
	decodeOpenOracleStatePreimage,
	getOpenOracleGameTuple,
	getOpenOracleHelperTuple,
	getOpenOracleReportIdFromTopic,
	hasOpenOracleFlag,
	OPEN_ORACLE_FLAG_TIME_TYPE,
	OPEN_ORACLE_FLAG_TRACK_DISPUTES,
	OPEN_ORACLE_REPORT_DISPUTED_TOPIC,
	OPEN_ORACLE_REPORT_SETTLED_TOPIC,
	OPEN_ORACLE_REPORT_SUBMITTED_TOPIC,
	type OpenOracleStatePreimage,
} from '@zoltar/shared/openOracle'
import { ReadClient, WriteClient, writeContractAndWait } from '../clients'
import { WETH_ADDRESS } from '../constants'
import {
	peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	peripherals_openOracle_OpenOracle_OpenOracle,
	peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	peripherals_tokens_ShareToken_ShareToken,
	ZoltarQuestionData_ZoltarQuestionData,
} from '../../../../types/contractArtifact'
import { QuestionOutcome } from '../../types/types'
import { getInfraContractAddresses } from './deployPeripherals'
import { threeShareArrayToCash } from './securityPool'
import { priceToClosestTick, tickToPrice } from '../tickMath'
import { HIGH_GAS_SIMULATOR_WRITE_GAS } from '../constants'
import { requireAddress } from '../utilities'

export enum OperationType {
	Liquidation = 0,
	WithdrawRep = 1,
	SetSecurityBondsAllowance = 2,
}

const DEFAULT_SELF_OPERATION_VALID_FOR_SECONDS = 5n * 60n
const PRICE_PRECISION = 10n ** 18n
const ERC20_APPROVE_ABI = [
	{
		type: 'function',
		name: 'approve',
		stateMutability: 'nonpayable',
		inputs: [
			{ name: 'spender', type: 'address' },
			{ name: 'amount', type: 'uint256' },
		],
		outputs: [{ name: '', type: 'bool' }],
	},
	{
		type: 'function',
		name: 'balanceOf',
		stateMutability: 'view',
		inputs: [{ name: 'account', type: 'address' }],
		outputs: [{ name: '', type: 'uint256' }],
	},
] as const

const getCoordinatorMinimumToken1Report = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'minimumToken1Report',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

const getDefaultInitialReportPrice = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) => {
	const lastPrice = await getLastPrice(client, priceOracleManagerAndOperatorQueuer)
	return lastPrice > 0n ? lastPrice : PRICE_PRECISION
}

const fundCoordinatorInitialReport = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, proposedRepPerEthPrice: bigint, requestedInitialWeth = 0n) => {
	const [minimumToken1Report, rawReputationTokenAddress] = await Promise.all([
		getCoordinatorMinimumToken1Report(client, priceOracleManagerAndOperatorQueuer),
		client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'reputationToken',
			address: priceOracleManagerAndOperatorQueuer,
			args: [],
		}),
	])
	const reputationTokenAddress = requireAddress(rawReputationTokenAddress, 'Oracle coordinator reputation token')
	const bufferedMinimumToken1Report = minimumToken1Report * 2n
	const maximumInitialWeth = requestedInitialWeth > bufferedMinimumToken1Report ? requestedInitialWeth : bufferedMinimumToken1Report
	const maximumAmount2 = (maximumInitialWeth * proposedRepPerEthPrice + PRICE_PRECISION - 1n) / PRICE_PRECISION
	const wethBalance: bigint = await client.readContract({
		abi: ERC20_APPROVE_ABI,
		functionName: 'balanceOf',
		address: WETH_ADDRESS,
		args: [client.account.address],
	})
	if (wethBalance < maximumInitialWeth) {
		await wrapWeth(client, maximumInitialWeth - wethBalance)
	}
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: ERC20_APPROVE_ABI,
			functionName: 'approve',
			address: WETH_ADDRESS,
			args: [priceOracleManagerAndOperatorQueuer, maximumInitialWeth],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: ERC20_APPROVE_ABI,
			functionName: 'approve',
			address: reputationTokenAddress,
			args: [priceOracleManagerAndOperatorQueuer, maximumAmount2],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
	return { maximumAmount2, maximumInitialWeth, minimumToken1Report, proposedRepPerEthPrice, requestedInitialWeth }
}

export const requestPriceIfNeededAndStageOperationWithValue = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, operation: OperationType, targetVault: Address, amount: bigint, validForSeconds: bigint, value: bigint) =>
	await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, priceOracleManagerAndOperatorQueuer, operation, targetVault, amount, validForSeconds, await getDefaultInitialReportPrice(client, priceOracleManagerAndOperatorQueuer), value)

export const requestPriceIfNeededAndStageOperationWithInitialReportPrice = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, operation: OperationType, targetVault: Address, amount: bigint, validForSeconds: bigint, proposedRepPerEthPrice: bigint, value: bigint, requestedInitialWeth = 0n) => {
	const shouldRequestPrice = !(await getIsPriceValid(client, priceOracleManagerAndOperatorQueuer)) && (await getPendingReportId(client, priceOracleManagerAndOperatorQueuer)) === 0n && (await getPendingSettlementOperationCount(client, priceOracleManagerAndOperatorQueuer)) === 0n
	if (shouldRequestPrice) {
		await fundCoordinatorInitialReport(client, priceOracleManagerAndOperatorQueuer, proposedRepPerEthPrice, requestedInitialWeth)
	}
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPriceIfNeededAndStageOperation',
			address: priceOracleManagerAndOperatorQueuer,
			args: [operation, targetVault, amount, validForSeconds, proposedRepPerEthPrice, requestedInitialWeth],
			value,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
}

export const requestPriceIfNeededAndStageOperation = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, operation: OperationType, targetVault: Address, amount: bigint, validForSeconds = DEFAULT_SELF_OPERATION_VALID_FOR_SECONDS) => {
	const ethCost = await getRequestPriceEthCost(client, priceOracleManagerAndOperatorQueuer)
	return await requestPriceIfNeededAndStageOperationWithValue(client, priceOracleManagerAndOperatorQueuer, operation, targetVault, amount, validForSeconds, ethCost)
}

export const queueLiquidationAtForcedPrice = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, targetVault: Address, liquidationAmount: bigint, forcedPrice: bigint, validForSeconds = DEFAULT_SELF_OPERATION_VALID_FOR_SECONDS) => {
	const ethCost = await getRequestPriceEthCost(client, priceOracleManagerAndOperatorQueuer)
	return await requestPriceIfNeededAndStageOperationWithInitialReportPrice(client, priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, targetVault, liquidationAmount, validForSeconds, forcedPrice, ethCost)
}

export const executeStagedOperation = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, operationId: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'executeStagedOperation',
			address: priceOracleManagerAndOperatorQueuer,
			args: [operationId],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const requestPrice = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address) => {
	const ethCost = await getRequestPriceEthCost(client, priceOracleManagerAndOperatorQueuer)
	return await requestPriceWithValue(client, priceOracleManagerAndOperatorQueuer, ethCost, await getDefaultInitialReportPrice(client, priceOracleManagerAndOperatorQueuer))
}

export const requestPriceWithValue = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, value: bigint, proposedRepPerEthPrice?: bigint, requestedInitialWeth = 0n) => {
	const resolvedInitialReportPrice = proposedRepPerEthPrice ?? (await getDefaultInitialReportPrice(client, priceOracleManagerAndOperatorQueuer))
	await fundCoordinatorInitialReport(client, priceOracleManagerAndOperatorQueuer, resolvedInitialReportPrice, requestedInitialWeth)
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracleManagerAndOperatorQueuer,
			args: [resolvedInitialReportPrice, requestedInitialWeth],
			value,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
}

export const recoverSettledPendingReport = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'recoverSettledPendingReport',
			address: priceOracleManagerAndOperatorQueuer,
			args: [],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const getPendingReportId = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'pendingReportId',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getPendingReportMaxSettlementBaseFee = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'pendingReportMaxSettlementBaseFee',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getPendingOperationSlotId = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'pendingOperationSlotId',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getPendingSettlementOperationCount = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'getPendingSettlementOperationCount',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getPendingSettlementOperationIds = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'getPendingSettlementOperationIds',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getIsPriceValid = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'isPriceValid',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getStagedOperation = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address, operationId: bigint) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'stagedOperations',
		address: priceOracleManagerAndOperatorQueuer,
		args: [operationId],
	})

export const getStagedOperationCounter = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'stagedOperationCounter',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getActiveStagedOperationCount = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'getActiveStagedOperationCount',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getActiveStagedOperations = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address, offset: bigint, count: bigint) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'getActiveStagedOperations',
		address: priceOracleManagerAndOperatorQueuer,
		args: [offset, count],
	})

interface ExtraReportData {
	stateHash: Hex
	callbackContract: Address
	numReports: number
	callbackGasLimit: number
	protocolFeeRecipient: Address
	trackDisputes: boolean
}

interface ReportStatus {
	currentAmount1: bigint
	currentAmount2: bigint
	currentReporter: Address
	reportTimestamp: bigint
	settlementTimestamp: bigint
	initialReporter: Address
	lastReportOppoTime: bigint
}

type OpenOracleEventState = {
	initial: OpenOracleStatePreimage
	latest: OpenOracleStatePreimage
	reportCount: number
	settlementBlockNumber: bigint | undefined
}

function compareOpenOracleLogs(left: TransactionLog, right: TransactionLog) {
	const leftBlock = left.blockNumber ?? -1n
	const rightBlock = right.blockNumber ?? -1n
	if (leftBlock !== rightBlock) return leftBlock < rightBlock ? -1 : 1
	const leftIndex = left.logIndex ?? -1n
	const rightIndex = right.logIndex ?? -1n
	if (leftIndex === rightIndex) return 0
	return leftIndex < rightIndex ? -1 : 1
}

export const loadOpenOracleEventState = async (client: ReadClient, reportId: bigint): Promise<OpenOracleEventState> => {
	const address = getInfraContractAddresses().openOracle
	const logs = await client.getLogs({ address, fromBlock: 0n })
	let state: OpenOracleEventState | undefined
	for (const log of [...logs].sort(compareOpenOracleLogs)) {
		const signature = log.topics[0]?.toLowerCase()
		const reportIdTopic = log.topics[1]
		if (reportIdTopic === undefined || getOpenOracleReportIdFromTopic(reportIdTopic) !== reportId) continue
		if (signature === OPEN_ORACLE_REPORT_SUBMITTED_TOPIC.toLowerCase() || signature === OPEN_ORACLE_REPORT_DISPUTED_TOPIC.toLowerCase()) {
			const preimage = decodeOpenOracleStatePreimage(log.data, reportId)
			state = state === undefined ? { initial: preimage, latest: preimage, reportCount: 1, settlementBlockNumber: undefined } : { ...state, latest: preimage, reportCount: state.reportCount + 1 }
		} else if (signature === OPEN_ORACLE_REPORT_SETTLED_TOPIC.toLowerCase() && state !== undefined) {
			state.settlementBlockNumber = log.blockNumber ?? undefined
		}
	}
	if (state === undefined) throw new Error(`OpenOracle report ${reportId.toString()} does not exist`)
	if (state.settlementBlockNumber !== undefined) {
		const block = await client.getBlock({ blockNumber: state.settlementBlockNumber })
		const settlementTimestamp = hasOpenOracleFlag(state.latest.game, OPEN_ORACLE_FLAG_TIME_TYPE) ? block.timestamp : state.settlementBlockNumber
		state.latest = { ...state.latest, game: { ...state.latest.game, settlementTimestamp } }
	}
	return state
}

export const getOpenOracleExtraData = async (client: ReadClient, extraDataId: bigint): Promise<ExtraReportData> => {
	const state = await loadOpenOracleEventState(client, extraDataId)
	const stateHash = await client.readContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'oracleGame',
		address: getInfraContractAddresses().openOracle,
		args: [extraDataId],
	})
	return {
		stateHash,
		callbackContract: state.latest.game.callbackContract,
		numReports: state.reportCount,
		callbackGasLimit: Number(state.latest.game.callbackGasLimit),
		protocolFeeRecipient: state.latest.game.protocolFeeRecipient,
		trackDisputes: hasOpenOracleFlag(state.latest.game, OPEN_ORACLE_FLAG_TRACK_DISPUTES),
	}
}

export const getOpenOracleReportStatus = async (client: ReadClient, reportId: bigint): Promise<ReportStatus> => {
	const state = await loadOpenOracleEventState(client, reportId)
	return {
		currentAmount1: state.latest.game.currentAmount1,
		currentAmount2: state.latest.game.currentAmount2,
		currentReporter: state.latest.game.currentReporter,
		reportTimestamp: state.latest.game.reportTimestamp,
		settlementTimestamp: state.latest.game.settlementTimestamp,
		initialReporter: state.initial.game.currentReporter,
		lastReportOppoTime: state.latest.game.lastReportOppoTime,
	}
}

export const openOracleSettle = async (client: WriteClient, reportId: bigint) => {
	const state = await loadOpenOracleEventState(client, reportId)
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'settle',
			address: getInfraContractAddresses().openOracle,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
			args: [reportId, getOpenOracleGameTuple(state.latest.game), getOpenOracleHelperTuple(state.latest.helper)],
		}),
	)
}

export const openOracleSettleWithGasPrice = async (client: WriteClient, reportId: bigint, gasPrice: bigint) => {
	const state = await loadOpenOracleEventState(client, reportId)
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'settle',
			address: getInfraContractAddresses().openOracle,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
			gasPrice,
			args: [reportId, getOpenOracleGameTuple(state.latest.game), getOpenOracleHelperTuple(state.latest.helper)],
		}),
	)
}

export const getRequestPriceEthCost = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'getRequestPriceEthCost',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getQueuedOperationEthCost = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'getQueuedOperationEthCost',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const wrapWeth = async (client: WriteClient, amount: bigint) => {
	const wethAbi = [
		{
			type: 'function',
			name: 'deposit',
			stateMutability: 'payable',
			inputs: [],
			outputs: [],
		},
	]
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: wethAbi,
			address: WETH_ADDRESS,
			functionName: 'deposit',
			value: amount,
		}),
	)
}

interface ReportMeta {
	exactToken1Report: bigint
	escalationHalt: bigint
	fee: bigint
	settlerReward: bigint
	token1: Address
	settlementTime: bigint
	token2: Address
	timeType: boolean
	feePercentage: bigint
	protocolFee: bigint
	multiplier: bigint
	disputeDelay: bigint
}

export const getOpenOracleReportMeta = async (client: ReadClient, reportId: bigint): Promise<ReportMeta> => {
	const state = await loadOpenOracleEventState(client, reportId)
	const game = state.latest.game
	return {
		exactToken1Report: state.initial.game.currentAmount1,
		escalationHalt: game.escalationHalt,
		fee: 0n,
		settlerReward: game.settlerReward,
		token1: game.token1,
		settlementTime: game.settlementTime,
		token2: game.token2,
		timeType: hasOpenOracleFlag(game, OPEN_ORACLE_FLAG_TIME_TYPE),
		feePercentage: game.feePercentage,
		protocolFee: game.protocolFee,
		multiplier: game.multiplier,
		disputeDelay: game.disputeDelay,
	}
}

export const getLastPrice = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'lastPrice',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const participateAuction = async (client: WriteClient, auctionAddress: Address, repToBuy: bigint, ethToInvest: bigint): Promise<bigint> => {
	if (repToBuy === 0n) throw new Error('repToBuy cannot be zero')
	// Compute price: ethToInvest / repToBuy in PRICE_PRECISION units
	const price = (ethToInvest * 1_000_000_000_000_000_000n) / repToBuy
	const closestTick = priceToClosestTick(price)
	const tick = tickToPrice(closestTick) < price ? closestTick + 1n : closestTick
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			functionName: 'submitBid',
			address: auctionAddress,
			args: [tick],
			value: ethToInvest,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
	return tick
}
export const getEthRaiseCap = async (client: ReadClient, auctionAddress: Address) =>
	await client.readContract({
		abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
		functionName: 'ethRaiseCap',
		address: auctionAddress,
		args: [],
	})

export const balanceOfShares = async (client: ReadClient, shareTokenAddress: Address, universeId: bigint, account: Address) =>
	await client.readContract({
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'balanceOfShares',
		address: shareTokenAddress,
		args: [universeId, account],
	})

export const balanceOfSharesInCash = async (client: ReadClient, securityPoolAddress: Address, shareTokenAddress: Address, universeId: bigint, account: Address): Promise<[bigint, bigint, bigint]> => {
	const array: readonly [bigint, bigint, bigint] = await client.readContract({
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'balanceOfShares',
		address: shareTokenAddress,
		args: [universeId, account],
	})
	return await threeShareArrayToCash(client, securityPoolAddress, array)
}

const getTokenId = (universeId: bigint, outcome: QuestionOutcome) => {
	const universeMask = (1n << 248n) - 1n
	return ((universeId & universeMask) << 8n) | (BigInt(outcome) & 255n)
}

export const migrateShares = async (client: WriteClient, shareTokenAddress: Address, fromUniverseId: bigint, outcome: QuestionOutcome, targetOutcomeIndexes: (number | bigint)[]) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			functionName: 'migrate',
			address: shareTokenAddress,
			args: [getTokenId(fromUniverseId, outcome), targetOutcomeIndexes.map(value => BigInt(value))],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const getQuestionEndDate = async (client: ReadClient, questionId: bigint) =>
	await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'getQuestionEndDate',
		address: getInfraContractAddresses().zoltarQuestionData,
		args: [questionId],
	})

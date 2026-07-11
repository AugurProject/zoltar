import type { Address, Hex } from '@zoltar/shared/ethereum'
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
import { priceToClosestTick } from '../tickMath'
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

const getCoordinatorExactToken1Report = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'exactToken1Report',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

const getDefaultInitialReportAmount2 = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) => {
	const exactToken1Report = await getCoordinatorExactToken1Report(client, priceOracleManagerAndOperatorQueuer)
	const lastPrice = await getLastPrice(client, priceOracleManagerAndOperatorQueuer)
	if (lastPrice === 0n) return exactToken1Report
	const amount2 = (exactToken1Report * PRICE_PRECISION) / lastPrice
	return amount2 > 0n ? amount2 : 1n
}

const fundCoordinatorInitialReport = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, amount2: bigint) => {
	const [exactToken1Report, rawReputationTokenAddress] = await Promise.all([
		getCoordinatorExactToken1Report(client, priceOracleManagerAndOperatorQueuer),
		client.readContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'reputationToken',
			address: priceOracleManagerAndOperatorQueuer,
			args: [],
		}),
	])
	const reputationTokenAddress = requireAddress(rawReputationTokenAddress, 'Oracle coordinator reputation token')
	const wethBalance: bigint = await client.readContract({
		abi: ERC20_APPROVE_ABI,
		functionName: 'balanceOf',
		address: WETH_ADDRESS,
		args: [client.account.address],
	})
	if (wethBalance < amount2) {
		await wrapWeth(client, amount2 - wethBalance)
	}
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: ERC20_APPROVE_ABI,
			functionName: 'approve',
			address: reputationTokenAddress,
			args: [priceOracleManagerAndOperatorQueuer, exactToken1Report],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: ERC20_APPROVE_ABI,
			functionName: 'approve',
			address: WETH_ADDRESS,
			args: [priceOracleManagerAndOperatorQueuer, amount2],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
	return { amount2, exactToken1Report }
}

export const requestPriceIfNeededAndStageOperationWithValue = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, operation: OperationType, targetVault: Address, amount: bigint, validForSeconds: bigint, value: bigint) =>
	await requestPriceIfNeededAndStageOperationWithInitialReportAmount2(client, priceOracleManagerAndOperatorQueuer, operation, targetVault, amount, validForSeconds, await getDefaultInitialReportAmount2(client, priceOracleManagerAndOperatorQueuer), value)

export const requestPriceIfNeededAndStageOperationWithInitialReportAmount2 = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, operation: OperationType, targetVault: Address, amount: bigint, validForSeconds: bigint, initialReportAmount2: bigint, value: bigint) => {
	const shouldRequestPrice = !(await getIsPriceValid(client, priceOracleManagerAndOperatorQueuer)) && (await getPendingReportId(client, priceOracleManagerAndOperatorQueuer)) === 0n && (await getPendingSettlementOperationCount(client, priceOracleManagerAndOperatorQueuer)) === 0n
	if (shouldRequestPrice) {
		await fundCoordinatorInitialReport(client, priceOracleManagerAndOperatorQueuer, initialReportAmount2)
	}
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPriceIfNeededAndStageOperation',
			address: priceOracleManagerAndOperatorQueuer,
			args: [operation, targetVault, amount, validForSeconds, initialReportAmount2],
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
	const exactToken1Report = await getCoordinatorExactToken1Report(client, priceOracleManagerAndOperatorQueuer)
	const initialReportAmount2 = (exactToken1Report * PRICE_PRECISION) / forcedPrice || 1n
	const ethCost = await getRequestPriceEthCost(client, priceOracleManagerAndOperatorQueuer)
	return await requestPriceIfNeededAndStageOperationWithInitialReportAmount2(client, priceOracleManagerAndOperatorQueuer, OperationType.Liquidation, targetVault, liquidationAmount, validForSeconds, initialReportAmount2, ethCost)
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
	return await requestPriceWithValue(client, priceOracleManagerAndOperatorQueuer, ethCost, await getDefaultInitialReportAmount2(client, priceOracleManagerAndOperatorQueuer))
}

export const requestPriceWithValue = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, value: bigint, initialReportAmount2?: bigint) => {
	const resolvedInitialReportAmount2 = initialReportAmount2 ?? (await getDefaultInitialReportAmount2(client, priceOracleManagerAndOperatorQueuer))
	await fundCoordinatorInitialReport(client, priceOracleManagerAndOperatorQueuer, resolvedInitialReportAmount2)
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracleManagerAndOperatorQueuer,
			args: [resolvedInitialReportAmount2],
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

function isOpenOracleExtraData(value: unknown): value is readonly [Hex, Address, bigint, bigint, Address, boolean] {
	return Array.isArray(value) && value.length === 6
}

export const getOpenOracleExtraData = async (client: ReadClient, extraDataId: bigint): Promise<ExtraReportData> => {
	const result: unknown = await client.readContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'extraData',
		address: getInfraContractAddresses().openOracle,
		args: [extraDataId],
	})

	if (!isOpenOracleExtraData(result)) throw new Error('OpenOracle extraData returned an unexpected shape')

	const [stateHash, callbackContract, numReports, callbackGasLimit, protocolFeeRecipient, trackDisputes] = result

	return {
		stateHash,
		callbackContract,
		numReports: Number(numReports),
		callbackGasLimit: Number(callbackGasLimit),
		protocolFeeRecipient,
		trackDisputes,
	}
}

export const getOpenOracleReportStatus = async (client: ReadClient, reportId: bigint): Promise<ReportStatus> => {
	const result = await client.readContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'reportStatus',
		address: getInfraContractAddresses().openOracle,
		args: [reportId],
	})
	if (!Array.isArray(result) || result.length !== 7) throw new Error('OpenOracle reportStatus returned an unexpected shape')
	const [currentAmount1, currentAmount2, currentReporter, reportTimestamp, settlementTimestamp, initialReporter, lastReportOppoTime] = result
	return {
		currentAmount1,
		currentAmount2,
		currentReporter,
		reportTimestamp,
		settlementTimestamp,
		initialReporter,
		lastReportOppoTime,
	}
}

export const openOracleSubmitInitialReport = async (client: WriteClient, reportId: bigint, amount1: bigint, amount2: bigint, stateHash: Hex) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'submitInitialReport',
			address: getInfraContractAddresses().openOracle,
			args: [reportId, amount1, amount2, stateHash],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const openOracleSettle = async (client: WriteClient, reportId: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'settle',
			address: getInfraContractAddresses().openOracle,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
			args: [reportId],
		}),
	)

export const openOracleSettleWithGasPrice = async (client: WriteClient, reportId: bigint, gasPrice: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'settle',
			address: getInfraContractAddresses().openOracle,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
			gasPrice,
			args: [reportId],
		}),
	)

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
	const reportMetaData = await client.readContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'reportMeta',
		address: getInfraContractAddresses().openOracle,
		args: [reportId],
	})

	const [exactToken1Report, escalationHalt, fee, settlerReward, token1, settlementTime, token2, timeType, feePercentage, protocolFee, multiplier, disputeDelay] = reportMetaData

	return {
		exactToken1Report,
		escalationHalt,
		fee,
		settlerReward,
		token1,
		settlementTime,
		token2,
		timeType,
		feePercentage,
		protocolFee,
		multiplier,
		disputeDelay,
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
	const tick = priceToClosestTick(price)
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

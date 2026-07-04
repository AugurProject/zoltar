import type { Address, Hex } from '@zoltar/shared/ethereum'
import { ReadClient, WriteClient, writeContractAndWait } from '../clients'
import { WETH_ADDRESS } from '../constants'
import {
	peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	peripherals_openOracle_OpenOracle_OpenOracle,
	peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator,
	peripherals_tokens_ShareToken_ShareToken,
	ZoltarQuestionData_ZoltarQuestionData,
} from '../../../../types/contractArtifact'
import { QuestionOutcome } from '../../types/types'
import { getInfraContractAddresses } from './deployPeripherals'
import { threeShareArrayToCash } from './securityPool'
import { priceToClosestTick } from '../tickMath'
import { HIGH_GAS_SIMULATOR_WRITE_GAS } from '../constants'

export enum OperationType {
	Liquidation = 0,
	WithdrawRep = 1,
	SetSecurityBondsAllowance = 2,
}

const DEFAULT_SELF_OPERATION_VALID_FOR_SECONDS = 5n * 60n

export const requestPriceIfNeededAndStageOperationWithValue = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, operation: OperationType, targetVault: Address, amount: bigint, validForSeconds: bigint, value: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'requestPriceIfNeededAndStageOperation',
			address: priceOracleManagerAndOperatorQueuer,
			args: [operation, targetVault, amount, validForSeconds],
			value,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const requestPriceIfNeededAndStageOperation = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, operation: OperationType, targetVault: Address, amount: bigint, validForSeconds = DEFAULT_SELF_OPERATION_VALID_FOR_SECONDS) => {
	const ethCost = await getRequestPriceEthCost(client, priceOracleManagerAndOperatorQueuer)
	return await requestPriceIfNeededAndStageOperationWithValue(client, priceOracleManagerAndOperatorQueuer, operation, targetVault, amount, validForSeconds, ethCost)
}

export const executeStagedOperation = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, operationId: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'executeStagedOperation',
			address: priceOracleManagerAndOperatorQueuer,
			args: [operationId],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const requestPrice = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address) => {
	const ethCost = await getRequestPriceEthCost(client, priceOracleManagerAndOperatorQueuer)
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracleManagerAndOperatorQueuer,
			args: [],
			value: ethCost,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)
}

export const requestPriceWithValue = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, value: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'requestPrice',
			address: priceOracleManagerAndOperatorQueuer,
			args: [],
			value,
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const withdrawOracleFeeCredits = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'withdrawOracleFeeCredits',
			address: priceOracleManagerAndOperatorQueuer,
			args: [],
			gas: 2_000_000n,
		}),
	)

export const recoverSettledPendingReport = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
			functionName: 'recoverSettledPendingReport',
			address: priceOracleManagerAndOperatorQueuer,
			args: [],
			gas: HIGH_GAS_SIMULATOR_WRITE_GAS,
		}),
	)

export const getPendingReportId = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'pendingReportId',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getPendingReportMaxSettlementBaseFee = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'pendingReportMaxSettlementBaseFee',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getPendingOperationSlotId = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'pendingOperationSlotId',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getPendingSettlementOperationCount = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'getPendingSettlementOperationCount',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getPendingSettlementOperationIds = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'getPendingSettlementOperationIds',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getIsPriceValid = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'isPriceValid',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getStagedOperation = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address, operationId: bigint) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'stagedOperations',
		address: priceOracleManagerAndOperatorQueuer,
		args: [operationId],
	})

export const getStagedOperationCounter = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'stagedOperationCounter',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getActiveStagedOperationCount = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'getActiveStagedOperationCount',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getActiveStagedOperations = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address, offset: bigint, count: bigint) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'getActiveStagedOperations',
		address: priceOracleManagerAndOperatorQueuer,
		args: [offset, count],
	})

export const getPriceRoundConsumedNotional = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'priceRoundConsumedNotional',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getPriceRoundRemainingNotional = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'getPriceRoundRemainingNotional',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

interface ExtraReportData {
	stateHash: Hex
	callbackContract: Address
	numReports: number
	callbackGasLimit: number
	protocolFeeRecipient: Address
	trackDisputes: boolean
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
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'getRequestPriceEthCost',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getQueuedOperationEthCost = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'getQueuedOperationEthCost',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const getOracleFeeCredit = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address, sponsor: Address) =>
	await client.readContract({
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
		functionName: 'oracleFeeCredits',
		address: priceOracleManagerAndOperatorQueuer,
		args: [sponsor],
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
		abi: peripherals_SecurityPoolOracleCoordinator_SecurityPoolOracleCoordinator.abi,
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

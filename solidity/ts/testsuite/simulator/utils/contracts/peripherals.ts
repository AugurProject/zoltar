import 'viem/window'
import { ReadContractReturnType } from 'viem'
import type { Address, Hex } from 'viem'
import { ReadClient, WriteClient, writeContractAndWait } from '../viem'
import { WETH_ADDRESS } from '../constants'
import {
	peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
	peripherals_openOracle_OpenOracle_OpenOracle,
	peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer,
	peripherals_tokens_ShareToken_ShareToken,
	ZoltarQuestionData_ZoltarQuestionData,
} from '../../../../types/contractArtifact'
import { QuestionOutcome } from '../../types/types'
import { getInfraContractAddresses } from './deployPeripherals'
import { threeShareArrayToCash } from './securityPool'
import { priceToClosestTick } from '../tickMath'

export enum OperationType {
	Liquidation = 0,
	WithdrawRep = 1,
	SetSecurityBondsAllowance = 2,
}

export const requestPriceIfNeededAndQueueOperation = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address, operation: OperationType, targetVault: Address, amount: bigint) => {
	const ethCost = await getRequestPriceEthCost(client, priceOracleManagerAndOperatorQueuer)
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
			functionName: 'requestPriceIfNeededAndQueueOperation',
			address: priceOracleManagerAndOperatorQueuer,
			args: [operation, targetVault, amount],
			value: ethCost,
		}),
	)
}

export const requestPrice = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: Address) => {
	const ethCost = await getRequestPriceEthCost(client, priceOracleManagerAndOperatorQueuer)
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
			functionName: 'requestPrice',
			address: priceOracleManagerAndOperatorQueuer,
			args: [],
			value: ethCost,
		}),
	)
}

export const getPendingReportId = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'pendingReportId',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

interface ExtraReportData {
	stateHash: Hex
	callbackContract: Address
	numReports: number
	callbackGasLimit: number
	callbackSelector: Hex
	protocolFeeRecipient: Address
	trackDisputes: boolean
	keepFee: boolean
	feeToken: boolean
}

function isOpenOracleExtraData(value: ReadContractReturnType): value is readonly [Hex, Address, bigint, bigint, Hex, Address, boolean, boolean, boolean] {
	return Array.isArray(value) && value.length === 9
}

export const getOpenOracleExtraData = async (client: ReadClient, extraDataId: bigint): Promise<ExtraReportData> => {
	const result = await client.readContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'extraData',
		address: getInfraContractAddresses().openOracle,
		args: [extraDataId],
	})

	if (!isOpenOracleExtraData(result)) {
		throw new Error('OpenOracle extraData returned an unexpected shape')
	}

	const [stateHash, callbackContract, numReports, callbackGasLimit, callbackSelector, protocolFeeRecipient, trackDisputes, keepFee, feeToken] = result

	return {
		stateHash,
		callbackContract,
		numReports: Number(numReports),
		callbackGasLimit: Number(callbackGasLimit),
		callbackSelector,
		protocolFeeRecipient,
		trackDisputes,
		keepFee,
		feeToken,
	}
}

export const openOracleSubmitInitialReport = async (client: WriteClient, reportId: bigint, amount1: bigint, amount2: bigint, stateHash: Hex) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'submitInitialReport',
			address: getInfraContractAddresses().openOracle,
			args: [reportId, amount1, amount2, stateHash],
		}),
	)

export const openOracleSettle = async (client: WriteClient, reportId: bigint) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
			functionName: 'settle',
			address: getInfraContractAddresses().openOracle,
			gas: 5_000_000n, //needed because of gas() opcode being used
			args: [reportId],
		}),
	)

export const getRequestPriceEthCost = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: Address) =>
	await client.readContract({
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'getRequestPriceEthCost',
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
	settlementTime: number
	token2: Address
	timeType: boolean
	feePercentage: number
	protocolFee: number
	multiplier: number
	disputeDelay: number
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
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'lastPrice',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
	})

export const participateAuction = async (client: WriteClient, auctionAddress: Address, repToBuy: bigint, ethToInvest: bigint): Promise<bigint> => {
	if (repToBuy === 0n) {
		throw new Error('repToBuy cannot be zero')
	}
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

export const migrateShares = async (client: WriteClient, shareTokenAddress: Address, fromUniverseId: bigint, outcome: QuestionOutcome) =>
	await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			functionName: 'migrate',
			address: shareTokenAddress,
			args: [getTokenId(fromUniverseId, outcome)],
		}),
	)

export const getQuestionEndDate = async (client: ReadClient, questionId: bigint) =>
	await client.readContract({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		functionName: 'getQuestionEndDate',
		address: getInfraContractAddresses().zoltarQuestionData,
		args: [questionId],
	})

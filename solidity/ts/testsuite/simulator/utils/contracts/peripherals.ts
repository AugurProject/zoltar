import 'viem/window'
import { ReadContractReturnType } from 'viem'
import { ReadClient, WriteClient } from '../viem.js'
import { WETH_ADDRESS } from '../constants.js'
import { peripherals_Auction_Auction, peripherals_openOracle_OpenOracle_OpenOracle, peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer, peripherals_tokens_ShareToken_ShareToken, peripherals_YesNoMarkets_YesNoMarkets } from '../../../../types/contractArtifact.js'
import { QuestionOutcome } from '../../types/types.js'
import { getInfraContractAddresses } from './deployPeripherals.js'
import { shareArrayToCash } from './securityPool.js'

export enum OperationType {
	Liquidation = 0,
	WithdrawRep = 1,
	SetSecurityBondsAllowance = 2
}

export const requestPriceIfNeededAndQueueOperation = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: `0x${ string }`, operation: OperationType, targetVault: `0x${ string }`, amount: bigint) => {
	const ethCost = await getRequestPriceEthCost(client, priceOracleManagerAndOperatorQueuer) * 2n;
	return await client.writeContract({
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'requestPriceIfNeededAndQueueOperation',
		address: priceOracleManagerAndOperatorQueuer,
		args: [operation, targetVault, amount],
		value: ethCost,
	})
}

export const requestPrice = async (client: WriteClient, priceOracleManagerAndOperatorQueuer: `0x${ string }`) => {
	const ethCost = await getRequestPriceEthCost(client, priceOracleManagerAndOperatorQueuer) * 2n;
	return await client.writeContract({
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'requestPrice',
		address: priceOracleManagerAndOperatorQueuer,
		args: [],
		value: ethCost,
	})
}

export const getPendingReportId = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'pendingReportId',
		address: priceOracleManagerAndOperatorQueuer,
		args: []
	}) as bigint
}

interface ExtraReportData {
	stateHash: `0x${ string }`
	callbackContract: `0x${ string }`
	numReports: number
	callbackGasLimit: number
	callbackSelector: `0x${ string }`
	protocolFeeRecipient: `0x${ string }`
	trackDisputes: boolean
	keepFee: boolean
	feeToken: boolean
}

export const getOpenOracleExtraData = async (client: ReadClient, extraDataId: bigint): Promise<ExtraReportData> => {
	const result = await client.readContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'extraData',
		address: getInfraContractAddresses().openOracle,
		args: [extraDataId]
	}) as ReadContractReturnType

	const [
		stateHash,
		callbackContract,
		numReports,
		callbackGasLimit,
		callbackSelector,
		protocolFeeRecipient,
		trackDisputes,
		keepFee,
		feeToken
	] = result as [
		`0x${ string }`,
		`0x${ string }`,
		bigint,
		bigint,
		`0x${ string }`,
		`0x${ string }`,
		boolean,
		boolean,
		boolean
	]

	return {
		stateHash,
		callbackContract,
		numReports: Number(numReports),
		callbackGasLimit: Number(callbackGasLimit),
		callbackSelector,
		protocolFeeRecipient,
		trackDisputes,
		keepFee,
		feeToken
	}
}

export const openOracleSubmitInitialReport = async (client: WriteClient, reportId: bigint, amount1: bigint, amount2: bigint, stateHash: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'submitInitialReport',
		address: getInfraContractAddresses().openOracle,
		args: [reportId, amount1, amount2, stateHash]
	})
}

export const openOracleSettle = async (client: WriteClient, reportId: bigint) => {
	return await client.writeContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'settle',
		address: getInfraContractAddresses().openOracle,
		gas: 5_000_000n, //needed because of gas() opcode being used
		args: [reportId]
	})
}

export const getRequestPriceEthCost = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'getRequestPriceEthCost',
		address: priceOracleManagerAndOperatorQueuer,
		args: []
	}) as bigint
}

export const wrapWeth = async (client: WriteClient, amount: bigint) => {
	const wethAbi = [{
		type: 'function',
		name: 'deposit',
		stateMutability: 'payable',
		inputs: [],
		outputs: []
	}]
	return await client.writeContract({
		abi: wethAbi,
		address: WETH_ADDRESS,
		functionName: 'deposit',
		value: amount
	})
}

export interface ReportMeta {
	exactToken1Report: bigint
	escalationHalt: bigint
	fee: bigint
	settlerReward: bigint
	token1: `0x${ string }`
	settlementTime: number
	token2: `0x${ string }`
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
		args: [reportId]
	})

	const [
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
		disputeDelay
	] = reportMetaData

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
		disputeDelay
	}
}

export const getLastPrice = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'lastPrice',
		address: priceOracleManagerAndOperatorQueuer,
		args: []
	}) as bigint
}

export const participateAuction = async (client: WriteClient, auctionAddress: `0x${ string }`, repToBuy: bigint, ethToInvest: bigint) => {
	return await client.writeContract({
		abi: peripherals_Auction_Auction.abi,
		functionName: 'participate',
		address: auctionAddress,
		args: [repToBuy],
		value: ethToInvest
	})
}
export const getEthAmountToBuy = async (client: ReadClient, auctionAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_Auction_Auction.abi,
		functionName: 'ethAmountToBuy',
		address: auctionAddress,
		args: [],
	})
}

export const balanceOfOutcome = async (client: ReadClient, shareTokenAddress: `0x${ string }`, universeId: bigint, outcome: QuestionOutcome, account: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'balanceOfOutcome',
		address: shareTokenAddress,
		args: [universeId, outcome, account],
	})
}

export const balanceOfShares = async (client: ReadClient, shareTokenAddress: `0x${ string }`, universeId: bigint, account: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'balanceOfShares',
		address: shareTokenAddress,
		args: [universeId, account],
	})
}

export const balanceOfSharesInCash = async (client: ReadClient, seucurityPoolAddress: `0x${ string }`, shareTokenAddress: `0x${ string }`, universeId: bigint, account: `0x${ string }`) => {
	const array = await client.readContract({
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'balanceOfShares',
		address: shareTokenAddress,
		args: [universeId, account],
	})
	return await shareArrayToCash(client, seucurityPoolAddress, array)
}

export const getTokenId = (universeId: bigint, outcome: QuestionOutcome) => {
	const universeMask = (1n << 248n) - 1n
	return ((universeId & universeMask) << 8n) | (BigInt(outcome) & 255n)
}
export const unpackTokenId = (tokenId: bigint): { universe: bigint, outcome: QuestionOutcome } => ({ universe: tokenId >> 8n, outcome: Number(tokenId & 0xFFn) })

export const migrateShares = async (client: WriteClient, shareTokenAddress: `0x${ string }`, fromUniverseId: bigint, outcome: QuestionOutcome, outcomes: bigint[]) => {
	return await client.writeContract({
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'migrate',
		address: shareTokenAddress,
		args: [getTokenId(fromUniverseId, outcome), outcomes.map((x) => Number(x))],
	})
}

export const getMarketEndDate = async(client: ReadClient, marketId: bigint) => {
	return await client.readContract({
		abi: peripherals_YesNoMarkets_YesNoMarkets.abi,
		functionName: 'getMarketEndDate',
		address: getInfraContractAddresses().yesNoMarkets,
		args: [marketId],
	})
}

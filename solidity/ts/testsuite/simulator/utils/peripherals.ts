import 'viem/window'
import { ReadContractReturnType } from 'viem'
import { ReadClient, WriteClient } from './viem.js'
import { WETH_ADDRESS } from './constants.js'
import { SystemState } from '../types/peripheralTypes.js'
import { peripherals_Auction_Auction, peripherals_openOracle_OpenOracle_OpenOracle, peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer, peripherals_SecurityPool_SecurityPool, peripherals_tokens_ShareToken_ShareToken } from '../../../types/contractArtifact.js'
import { QuestionOutcome } from '../types/types.js'
import { getInfraContractAddresses } from './deployPeripherals.js'

export const depositRep = async (client: WriteClient, securityPoolAddress: `0x${ string }`, amount: bigint) => {
	return await client.writeContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositRep',
		address: securityPoolAddress,
		args: [amount]
	})
}

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
		gas: 10000000n, //needed because of gas() opcode being used
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

export const createCompleteSet = async (client: WriteClient, securityPoolAddress: `0x${ string }`, completeSetsToCreate: bigint) => {
	return await client.writeContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'createCompleteSet',
		address: securityPoolAddress,
		args: [],
		value: completeSetsToCreate,
	})
}

export const redeemCompleteSet = async (client: WriteClient, securityPoolAddress: `0x${ string }`, completeSetsToRedeem: bigint) => {
	return await client.writeContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'redeemCompleteSet',
		address: securityPoolAddress,
		args: [completeSetsToRedeem],
	})
}

export const getSecurityBondAllowance = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'securityBondAllowance',
		address: securityPoolAddress,
		args: []
	}) as bigint
}

export const getCompleteSetCollateralAmount = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'completeSetCollateralAmount',
		address: securityPoolAddress,
		args: []
	}) as bigint
}

export const getLastPrice = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		functionName: 'lastPrice',
		address: priceOracleManagerAndOperatorQueuer,
		args: []
	}) as bigint
}

export const forkSecurityPool = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'forkSecurityPool',
		address: securityPoolAddress,
		args: [],
	})
}

export const migrateVault = async (client: WriteClient, securityPoolAddress: `0x${ string }`, outcome: QuestionOutcome) => {
	return await client.writeContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'migrateVault',
		address: securityPoolAddress,
		args: [Number(outcome)],
	})
}

export const startTruthAuction = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'startTruthAuction',
		address: securityPoolAddress,
		args: [],
	})
}

export const finalizeTruthAuction = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'finalizeTruthAuction',
		address: securityPoolAddress,
		args: [],
	})
}

export const claimAuctionProceeds = async (client: WriteClient, securityPoolAddress: `0x${ string }`, vault: `0x${ string }`) => {
	return await client.writeContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'claimAuctionProceeds',
		address: securityPoolAddress,
		args: [vault],
	})
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

export const getMigratedRep = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'migratedRep',
		address: securityPoolAddress,
		args: [],
	})
}

export const getSystemState = async (client: ReadClient, securityPoolAddress: `0x${ string }`): Promise<SystemState> => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'systemState',
		address: securityPoolAddress,
		args: [],
	})
}

export const getCurrentRetentionRate = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'currentRetentionRate',
		address: securityPoolAddress,
		args: [],
	})
}

export const getSecurityVault = async (client: ReadClient, securityPoolAddress: `0x${ string }`, securityVault: `0x${ string }`) => {
	const vault = await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'securityVaults',
		address: securityPoolAddress,
		args: [securityVault],
	})
	const [
		repDepositShare,
		securityBondAllowance,
		unpaidEthFees,
		feeAccumulator,
	] = vault

	return {
		repDepositShare,
		securityBondAllowance,
		unpaidEthFees,
		feeAccumulator,
	}
}

export const getPoolOwnershipDenominator = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'poolOwnershipDenominator',
		address: securityPoolAddress,
		args: [],
	})
}

export const poolOwnershipToRep = async (client: ReadClient, securityPoolAddress: `0x${ string }`, poolOwnership: bigint) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'poolOwnershipToRep',
		address: securityPoolAddress,
		args: [poolOwnership],
	})
}

export const repToPoolOwnership = async (client: ReadClient, securityPoolAddress: `0x${ string }`, repAmount: bigint) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'repToPoolOwnership',
		address: securityPoolAddress,
		args: [repAmount],
	})
}

export const totalSupplyForUniverse = async (client: ReadClient, shareTokenAddress: `0x${ string }`, universeId: bigint) => {
	return await client.readContract({
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'totalSupplyForUniverse',
		address: shareTokenAddress,
		args: [universeId],
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

export const balanceOfShares = async (client: ReadClient, shareTokenAddress: `0x${ string }`,  universeId: bigint, account: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_tokens_ShareToken_ShareToken.abi,
		functionName: 'balanceOfShares',
		address: shareTokenAddress,
		args: [universeId, account],
	})
}

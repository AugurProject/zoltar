import 'viem/window'
import { encodeDeployData, getContractAddress, getCreate2Address, keccak256, numberToBytes, ReadContractReturnType, toHex } from 'viem'
import { ReadClient, WriteClient } from './viem.js'
import { PROXY_DEPLOYER_ADDRESS, WETH_ADDRESS } from './constants.js'
import { addressString, bytes32String } from './bigint.js'
import { getZoltarAddress } from './utilities.js'
import { mainnet } from 'viem/chains'
import { SystemState } from '../types/peripheralTypes.js'
import { peripherals_Auction_Auction, peripherals_CompleteSet_CompleteSet, peripherals_openOracle_OpenOracle_OpenOracle, peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer, peripherals_SecurityPool_SecurityPool, peripherals_SecurityPoolFactory_SecurityPoolFactory, peripherals_SecurityPoolUtils_SecurityPoolUtils } from '../../../types/contractArtifact.js'
import { QuestionOutcome } from '../types/types.js'

export async function ensureProxyDeployerDeployed(client: WriteClient): Promise<void> {
	const deployerBytecode = await client.getCode({ address: addressString(PROXY_DEPLOYER_ADDRESS)})
	if (deployerBytecode === '0x60003681823780368234f58015156014578182fd5b80825250506014600cf3') return
	const ethSendHash = await client.sendTransaction({ to: '0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1', amount: 10000000000000000n })
	await client.waitForTransactionReceipt({ hash: ethSendHash })
	const deployHash = await client.sendRawTransaction({ serializedTransaction: '0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' })
	await client.waitForTransactionReceipt({ hash: deployHash })
}

export function getOpenOracleAddress() {
	const bytecode: `0x${ string }` = `0x${ peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object }`
	return getContractAddress({ bytecode, from: addressString(PROXY_DEPLOYER_ADDRESS), opcode: 'CREATE2', salt: numberToBytes(0) })
}

export const isOpenOracleDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: `0x${ string }` = `0x${ peripherals_openOracle_OpenOracle_OpenOracle.evm.deployedBytecode.object }`
	const address = getOpenOracleAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode === expectedDeployedBytecode
}

export function getSecurityPoolUtilsAddress() {
	const bytecode: `0x${ string }` = `0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }`
	return getContractAddress({ bytecode, from: addressString(PROXY_DEPLOYER_ADDRESS), opcode: 'CREATE2', salt: numberToBytes(0) })
}

export const isSecurityPoolUtilsDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: `0x${ string }` = `0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.deployedBytecode.object }`
	const address = getOpenOracleAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode === expectedDeployedBytecode
}

export const ensureOpenOracleDeployed = async (client: WriteClient) => {
	await ensureProxyDeployerDeployed(client)
	if (await isOpenOracleDeployed(client)) return
	const bytecode: `0x${ string }` = `0x${ peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object }`
	const hash = await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: bytecode } as const)
	await client.waitForTransactionReceipt({ hash })
}

export const ensureSecurityPoolUtilsDeployed = async (client: WriteClient) => {
	await ensureProxyDeployerDeployed(client)
	if (await isSecurityPoolUtilsDeployed(client)) return
	const bytecode: `0x${ string }` = `0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }`
	const hash = await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: bytecode } as const)
	await client.waitForTransactionReceipt({ hash })
}

export const applyLibraries = (bytecode: string): `0x${ string }` => {
	const securityPoolUtils = keccak256(toHex('contracts/peripherals/SecurityPoolUtils.sol:SecurityPoolUtils')).slice(2, 36)
	return `0x${ bytecode.replaceAll(`__$${ securityPoolUtils }$__`, getSecurityPoolUtilsAddress().slice(2).toLocaleLowerCase()) }`
}

export const isSecurityPoolFactoryDeployed = async (client: ReadClient) => {
	const address = getSecurityPoolFactoryAddress()
	return await client.getCode({ address }) === applyLibraries(peripherals_SecurityPoolFactory_SecurityPoolFactory.evm.deployedBytecode.object)
}

export function getSecurityPoolFactoryAddress() {
	return getContractAddress({ bytecode: applyLibraries(peripherals_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object), from: addressString(PROXY_DEPLOYER_ADDRESS), opcode: 'CREATE2', salt: numberToBytes(0) })
}

export const ensureSecurityPoolFactoryDeployed = async (client: WriteClient) => {
	await ensureProxyDeployerDeployed(client)
	await ensureSecurityPoolUtilsDeployed(client)
	if (await isSecurityPoolFactoryDeployed(client)) return
	const hash = await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: applyLibraries(peripherals_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object) } as const)
	await client.waitForTransactionReceipt({ hash })
}

export const deploySecurityPool = async (client: WriteClient, openOracle: `0x${ string }`, universeId: bigint, questionId: bigint, securityMultiplier: bigint, startingRetentionRate: bigint, startingRepEthPrice: bigint, completeSetCollateralAmount: bigint) => {
	return await client.writeContract({
		chain: mainnet,
		abi: peripherals_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'deploySecurityPool',
		address: getSecurityPoolFactoryAddress(),
		args: [openOracle, addressString(0x0n), getZoltarAddress(), universeId, questionId, securityMultiplier, startingRetentionRate, startingRepEthPrice, completeSetCollateralAmount]
	})
}

export const depositRep = async (client: WriteClient, securityPoolAddress: `0x${ string }`, amount: bigint) => {
	return await client.writeContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'depositRep',
		address: securityPoolAddress,
		args: [amount]
	})
}

export const getPriceOracleManagerAndOperatorQueuer = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'priceOracleManagerAndOperatorQueuer',
		address: securityPoolAddress,
		args: []
	}) as `0x${ string }`
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
		address: getOpenOracleAddress(),
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
		`0x${string}`,
		`0x${string}`,
		bigint,
		bigint,
		`0x${string}`,
		`0x${string}`,
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
		address: getOpenOracleAddress(),
		args: [reportId, amount1, amount2, stateHash]
	})
}

export const openOracleSettle = async (client: WriteClient, reportId: bigint) => {
	return await client.writeContract({
		abi: peripherals_openOracle_OpenOracle_OpenOracle.abi,
		functionName: 'settle',
		address: getOpenOracleAddress(),
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
		address: getOpenOracleAddress(),
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

export function getSecurityPoolAddress(
	parent: `0x${ string }`,
	universeId: bigint,
	questionId: bigint,
	securityMultiplier: bigint,
) : `0x${ string }` {
	const initCode = encodeDeployData({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		bytecode: applyLibraries(peripherals_SecurityPool_SecurityPool.evm.bytecode.object),
		args: [getSecurityPoolFactoryAddress(), getOpenOracleAddress(), parent, getZoltarAddress(), universeId, questionId, securityMultiplier]
	})
	return getCreate2Address({ from: getSecurityPoolFactoryAddress(), salt: bytes32String(1n), bytecodeHash: keccak256(initCode) })
}

export function getPriceOracleManagerAndOperatorQueuerAddress(securityPool: `0x${ string }`, repToken: `0x${ string }`): `0x${ string }` {
	const initCode = encodeDeployData({
		abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
		bytecode: `0x${ peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.evm.bytecode.object }`,
		args: [getOpenOracleAddress(), securityPool, repToken]
	})
	return getCreate2Address({ from: securityPool, salt: bytes32String(1n), bytecodeHash: keccak256(initCode) })
}

export function getCompleteSetAddress(securityPool: `0x${ string }`): `0x${ string }` {
	const initCode = encodeDeployData({
		abi: peripherals_CompleteSet_CompleteSet.abi,
		bytecode: `0x${ peripherals_CompleteSet_CompleteSet.evm.bytecode.object }`,
		args: [securityPool]
	})
	return getCreate2Address({ from: securityPool, salt: bytes32String(1n), bytecodeHash: keccak256(initCode) })
}

export function getTruthAuction(securityPool: `0x${ string }`): `0x${ string }` {
	const initCode = encodeDeployData({
		abi: peripherals_Auction_Auction.abi,
		bytecode: `0x${ peripherals_Auction_Auction.evm.bytecode.object }`,
		args: [securityPool]
	})
	return getCreate2Address({ from: securityPool, salt: bytes32String(1n), bytecodeHash: keccak256(initCode) })
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
export const getEthAmountToBuy = async (client: WriteClient, auctionAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_Auction_Auction.abi,
		functionName: 'ethAmountToBuy',
		address: auctionAddress,
		args: [],
	})
}

export const getMigratedRep = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'migratedRep',
		address: securityPoolAddress,
		args: [],
	})
}

export const getSystemState = async (client: WriteClient, securityPoolAddress: `0x${ string }`): Promise<SystemState> => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'systemState',
		address: securityPoolAddress,
		args: [],
	})
}

export const getCurrentRetentionRate = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'currentRetentionRate',
		address: securityPoolAddress,
		args: [],
	})
}

export const getSecurityVault = async (client: WriteClient, securityPoolAddress: `0x${ string }`, securityVault: `0x${ string }`) => {
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

export const getRepDenominator = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'repDenominator',
		address: securityPoolAddress,
		args: [],
	})
}

export const repSharesToRep = async (client: WriteClient, securityPoolAddress: `0x${ string }`, repShares: bigint) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'repSharesToRep',
		address: securityPoolAddress,
		args: [repShares],
	})
}

export const repShares = async (client: WriteClient, securityPoolAddress: `0x${ string }`, repAmount: bigint) => {
	return await client.readContract({
		abi: peripherals_SecurityPool_SecurityPool.abi,
		functionName: 'repToRepShares',
		address: securityPoolAddress,
		args: [repAmount],
	})
}

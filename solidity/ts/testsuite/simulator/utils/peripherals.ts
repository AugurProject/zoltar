import 'viem/window'
import { Abi, getContractAddress, numberToBytes, ReadContractReturnType } from 'viem'
import { ReadClient, WriteClient } from './viem.js'
import { PROXY_DEPLOYER_ADDRESS, WETH_ADDRESS } from './constants.js'
import { addressString } from './bigint.js'
import { getZoltarAddress } from './utilities.js'
import { mainnet } from 'viem/chains'
import { contractsArtifact } from '../types/peripheralTypes.js'

export async function ensureProxyDeployerDeployed(client: WriteClient): Promise<void> {
	const deployerBytecode = await client.getCode({ address: addressString(PROXY_DEPLOYER_ADDRESS)})
	if (deployerBytecode === '0x60003681823780368234f58015156014578182fd5b80825250506014600cf3') return
	const ethSendHash = await client.sendTransaction({ to: '0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1', amount: 10000000000000000n })
	await client.waitForTransactionReceipt({ hash: ethSendHash })
	const deployHash = await client.sendRawTransaction({ serializedTransaction: '0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' })
	await client.waitForTransactionReceipt({ hash: deployHash })
}

export function getOpenOracleAddress() {
	const bytecode: `0x${ string }` = `0x${ contractsArtifact.contracts['contracts/peripherals/openOracle/OpenOracle.sol'].OpenOracle.evm.bytecode.object }`
	return getContractAddress({ bytecode, from: addressString(PROXY_DEPLOYER_ADDRESS), opcode: 'CREATE2', salt: numberToBytes(0) })
}

export const isOpenOracleDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: `0x${ string }` = `0x${ contractsArtifact.contracts['contracts/peripherals/openOracle/OpenOracle.sol'].OpenOracle.evm.deployedBytecode.object }`
	const address = getOpenOracleAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode === expectedDeployedBytecode
}

export const deployOpenOracleTransaction = () => {
	const bytecode: `0x${ string }` = `0x${ contractsArtifact.contracts['contracts/peripherals/openOracle/OpenOracle.sol'].OpenOracle.evm.bytecode.object }`
	return { to: addressString(PROXY_DEPLOYER_ADDRESS), data: bytecode } as const
}

export const ensureOpenOracleDeployed = async (client: WriteClient) => {
	await ensureProxyDeployerDeployed(client)
	const hash = await client.sendTransaction(deployOpenOracleTransaction())
	await client.waitForTransactionReceipt({ hash })
}

export const isSecurityPoolFactoryDeployed = async (client: ReadClient) => {
	const expectedDeployedBytecode: `0x${ string }` = `0x${ contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPoolFactory.evm.deployedBytecode.object }`
	const address = getSecurityPoolFactoryAddress()
	const deployedBytecode = await client.getCode({ address })
	return deployedBytecode === expectedDeployedBytecode
}

export const deploySecurityPoolFactoryTransaction = () => {
	const bytecode: `0x${ string }` = `0x${ contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPoolFactory.evm.bytecode.object }`
	return { to: addressString(PROXY_DEPLOYER_ADDRESS), data: bytecode } as const
}

export function getSecurityPoolFactoryAddress() {
	const bytecode: `0x${ string }` = `0x${ contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPoolFactory.evm.bytecode.object }`
	return getContractAddress({ bytecode, from: addressString(PROXY_DEPLOYER_ADDRESS), opcode: 'CREATE2', salt: numberToBytes(0) })
}

export const ensureSecurityPoolFactoryDeployed = async (client: WriteClient) => {
	await ensureProxyDeployerDeployed(client)
	const hash = await client.sendTransaction(deploySecurityPoolFactoryTransaction())
	await client.waitForTransactionReceipt({ hash })
}

export const deploySecurityPool = async (client: WriteClient, openOracle: `0x${ string }`, universeId: bigint, questionId: bigint, securityMultiplier: bigint, startingPerSecondFee: bigint, startingRepEthPrice: bigint, completeSetCollateralAmount: bigint) => {
	const zoltarAddress = getZoltarAddress()
	return await client.writeContract({
		chain: mainnet,
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPoolFactory.abi as Abi,
		functionName: 'deploySecurityPool',
		address: getSecurityPoolFactoryAddress(),
		args: [openOracle, addressString(0x0n), zoltarAddress, universeId, questionId, securityMultiplier, startingPerSecondFee, startingRepEthPrice, completeSetCollateralAmount]
	})
}

export const getDeployedSecurityPool = async (client: ReadClient, securityPoolId: bigint) => {
	return await client.readContract({
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPoolFactory.abi as Abi,
		functionName: 'securityPools',
		address: getSecurityPoolFactoryAddress(),
		args: [securityPoolId]
	}) as `0x${ string }`
}

export const depositRep = async (client: WriteClient, securityPoolAddress: `0x${ string }`, amount: bigint) => {
	return await client.writeContract({
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPool.abi as Abi,
		functionName: 'depositRep',
		address: securityPoolAddress,
		args: [amount]
	})
}

export const getPriceOracleManagerAndOperatorQueuer = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPool.abi as Abi,
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
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].PriceOracleManagerAndOperatorQueuer.abi as Abi,
		functionName: 'requestPriceIfNeededAndQueueOperation',
		address: priceOracleManagerAndOperatorQueuer,
		args: [operation, targetVault, amount],
		value: ethCost,
	})
}

export const getPendingReportId = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: `0x${ string }`) => {
	return await client.readContract({
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].PriceOracleManagerAndOperatorQueuer.abi as Abi,
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
		abi: contractsArtifact.contracts['contracts/peripherals/openOracle/OpenOracle.sol'].OpenOracle.abi as Abi,
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
		abi: contractsArtifact.contracts['contracts/peripherals/openOracle/OpenOracle.sol'].OpenOracle.abi as Abi,
		functionName: 'submitInitialReport',
		address: getOpenOracleAddress(),
		args: [reportId, amount1, amount2, stateHash]
	})
}

export const openOracleSettle = async (client: WriteClient, reportId: bigint) => {
	return await client.writeContract({
		abi: contractsArtifact.contracts['contracts/peripherals/openOracle/OpenOracle.sol'].OpenOracle.abi as Abi,
		functionName: 'settle',
		address: getOpenOracleAddress(),
		gas: 10000000n, //needed because of gas() opcode being used
		args: [reportId]
	})
}

export const getRequestPriceEthCost = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: `0x${ string }`) => {
	return await client.readContract({
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].PriceOracleManagerAndOperatorQueuer.abi as Abi,
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
	settlementTime: bigint
	token2: `0x${ string }`
	timeType: boolean
	feePercentage: number
	protocolFee: number
	multiplier: number
	disputeDelay: number
}

export const getOpenOracleReportMeta = async (client: ReadClient, reportId: bigint): Promise<ReportMeta> => {
	const reportMetaData = await client.readContract({
		abi: contractsArtifact.contracts['contracts/peripherals/openOracle/OpenOracle.sol'].OpenOracle.abi as Abi,
		functionName: 'reportMeta',
		address: getOpenOracleAddress(),
		args: [reportId]
	}) as [
		bigint, bigint, bigint, bigint,
		`0x${ string }`, bigint, `0x${ string }`, boolean,
		number, number, number, number
	]

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
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPool.abi as Abi,
		functionName: 'createCompleteSet',
		address: securityPoolAddress,
		args: [],
		value: completeSetsToCreate,
	})
}

export const getCompleteSetAddress = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPool.abi as Abi,
		functionName: 'completeSet',
		address: securityPoolAddress,
		args: []
	}) as `0x${ string }`
}

export const redeemCompleteSet = async (client: WriteClient, securityPoolAddress: `0x${ string }`, completeSetsToRedeem: bigint) => {
	return await client.writeContract({
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPool.abi as Abi,
		functionName: 'redeemCompleteSet',
		address: securityPoolAddress,
		args: [completeSetsToRedeem],
	})
}

export const getSecurityBondAllowance = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPool.abi as Abi,
		functionName: 'securityBondAllowance',
		address: securityPoolAddress,
		args: []
	}) as bigint
}

export const getCompleteSetCollateralAmount = async (client: ReadClient, securityPoolAddress: `0x${ string }`) => {
	return await client.readContract({
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPool.abi as Abi,
		functionName: 'completeSetCollateralAmount',
		address: securityPoolAddress,
		args: []
	}) as bigint
}

export const getLastPrice = async (client: ReadClient, priceOracleManagerAndOperatorQueuer: `0x${ string }`) => {
	return await client.readContract({
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].PriceOracleManagerAndOperatorQueuer.abi as Abi,
		functionName: 'lastPrice',
		address: priceOracleManagerAndOperatorQueuer,
		args: []
	}) as bigint
}

export const forkSecurityPool = async (client: WriteClient, securityPoolAddress: `0x${ string }`) => {
	return await client.writeContract({
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPool.abi as Abi,
		functionName: 'forkSecurityPool',
		address: securityPoolAddress,
		args: [],
	})
}

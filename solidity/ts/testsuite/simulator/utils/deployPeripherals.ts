import 'viem/window'
import { encodeDeployData, getCreate2Address, keccak256, numberToBytes, toHex, zeroAddress, encodeAbiParameters } from 'viem'
import { WriteClient } from './viem.js'
import { PROXY_DEPLOYER_ADDRESS } from './constants.js'
import { addressString } from './bigint.js'
import { contractExists, getRepTokenAddress, getZoltarAddress } from './utilities.js'
import { mainnet } from 'viem/chains'
import { peripherals_Auction_Auction, peripherals_factories_AuctionFactory_AuctionFactory, peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_factories_ShareTokenFactory_ShareTokenFactory, peripherals_openOracle_OpenOracle_OpenOracle, peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer, peripherals_SecurityPool_SecurityPool, peripherals_SecurityPoolUtils_SecurityPoolUtils, peripherals_tokens_ShareToken_ShareToken, Zoltar_Zoltar } from '../../../types/contractArtifact.js'

export function getSecurityPoolUtilsAddress() {
	return getCreate2Address({ bytecode: `0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }`, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0) })
}

export const applyLibraries = (bytecode: string): `0x${ string }` => {
	const securityPoolUtils = keccak256(toHex('contracts/peripherals/SecurityPoolUtils.sol:SecurityPoolUtils')).slice(2, 36)
	return `0x${ bytecode.replaceAll(`__$${ securityPoolUtils }$__`, getSecurityPoolUtilsAddress().slice(2).toLocaleLowerCase()) }`
}

export const getSecurityPoolFactoryByteCode = (openOracle: `0x${ string }`, zoltar: `0x${ string }`, shareTokenFactory: `0x${ string }`, auctionFactory: `0x${ string }`, priceOracleManagerAndOperatorQueuerFactory: `0x${ string }`) => {
	return encodeDeployData({
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		bytecode: applyLibraries(peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
		args: [ openOracle, zoltar, shareTokenFactory, auctionFactory, priceOracleManagerAndOperatorQueuerFactory ]
	})
}

export const getSecurityPoolFactoryAddress = (openOracle: `0x${ string }`, zoltar: `0x${ string }`, shareTokenFactory: `0x${ string }`, auctionFactory: `0x${ string }`, priceOracleManagerAndOperatorQueuerFactory: `0x${ string }`) => {
	return getCreate2Address({
		from: addressString(PROXY_DEPLOYER_ADDRESS),
		salt: numberToBytes(0),
		bytecode: getSecurityPoolFactoryByteCode(openOracle, zoltar, shareTokenFactory, auctionFactory, priceOracleManagerAndOperatorQueuerFactory)
	})
}

export const getShareTokenFactoryByteCode = (zoltar: `0x${ string }`) => {
	return encodeDeployData({
		abi: peripherals_factories_ShareTokenFactory_ShareTokenFactory.abi,
		bytecode: `0x${ peripherals_factories_ShareTokenFactory_ShareTokenFactory.evm.bytecode.object }`,
		args: [ zoltar ]
	})
}

export function getInfraContractAddresses() {
	const contracts = {
		securityPoolUtils: getCreate2Address({ bytecode: `0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }`, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0) }),
		openOracle: getCreate2Address({ bytecode: `0x${ peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object }`, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0) }),
		zoltar: getZoltarAddress(),
		shareTokenFactory: getCreate2Address({ bytecode: getShareTokenFactoryByteCode(getZoltarAddress()), from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0) }),
		auctionFactory: getCreate2Address({ bytecode: `0x${ peripherals_factories_AuctionFactory_AuctionFactory.evm.bytecode.object }`, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0) }),
		priceOracleManagerAndOperatorQueuerFactory: getCreate2Address({ bytecode: `0x${ peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object }`, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0) }),
	}
	const securityPoolFactory = getSecurityPoolFactoryAddress(contracts.openOracle, contracts.zoltar, contracts.shareTokenFactory, contracts.auctionFactory, contracts.priceOracleManagerAndOperatorQueuerFactory)
	return { ...contracts, securityPoolFactory }
}

export async function getInfraDeployedInformation(client: WriteClient): Promise<{ [key in keyof ReturnType<typeof getInfraContractAddresses>]: boolean }> {
	const contractAddresses = getInfraContractAddresses()
	type ContractKeys = keyof typeof contractAddresses

	const contractKeys = Object.keys(contractAddresses) as ContractKeys[]

	const contractExistencePairs = await Promise.all(
		contractKeys.map(async key => {
			const doesExist = await contractExists(client, contractAddresses[key])
			return [key, doesExist] as const
		})
	)

	const contractExistenceObject: { [key in ContractKeys]: boolean } = {} as { [key in ContractKeys]: boolean }
	contractExistencePairs.forEach(([key, doesExist]) => {
		contractExistenceObject[key] = doesExist
	})

	return contractExistenceObject
}
export async function ensureInfraDeployed(client: WriteClient): Promise<void> {
	const contractAddresses = getInfraContractAddresses()
	const existence = await getInfraDeployedInformation(client)
	if (!existence.securityPoolUtils) {
		await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: `0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }` } as const)
		if (!(await contractExists(client, contractAddresses.securityPoolUtils))) throw new Error('Security Pool Utils does not exist eventhought we deployed it')
	}
	if (!existence.openOracle) {
		await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: `0x${ peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object }` } as const)
		if (!(await contractExists(client, contractAddresses.openOracle))) throw new Error('Open Oracle does not exist eventhought we deployed it')
	}
	if (!existence.zoltar) {
		await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: `0x${ Zoltar_Zoltar.evm.bytecode.object }` } as const)
		if (!(await contractExists(client, contractAddresses.zoltar))) throw new Error('Zoltar does not exist eventhought we deployed it')
	}
	if (!existence.shareTokenFactory) {
		await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: getShareTokenFactoryByteCode(getZoltarAddress()) } as const)
		if (!(await contractExists(client, contractAddresses.shareTokenFactory))) throw new Error('Share Token Factory does not exist eventhought we deployed it')
	}
	if (!existence.auctionFactory) {
		await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: `0x${ peripherals_factories_AuctionFactory_AuctionFactory.evm.bytecode.object }` } as const)
		if (!(await contractExists(client, contractAddresses.auctionFactory))) throw new Error('auctionFactory does not exist eventhought we deployed it')
	}
	if (!existence.priceOracleManagerAndOperatorQueuerFactory) {
		await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: `0x${ peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object }` } as const)
		if (!(await contractExists(client, contractAddresses.priceOracleManagerAndOperatorQueuerFactory))) throw new Error('priceOracleManagerAndOperatorQueuerFactory does not exist eventhought we deployed it')
	}
	if (!existence.securityPoolFactory) {
		await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: getSecurityPoolFactoryByteCode(contractAddresses.openOracle, contractAddresses.zoltar, contractAddresses.shareTokenFactory, contractAddresses.auctionFactory, contractAddresses.priceOracleManagerAndOperatorQueuerFactory) } as const)
		if (!(await contractExists(client, contractAddresses.securityPoolFactory))) throw new Error('priceOracleManagerAndOperatorQueuerFactory does not exist eventhought we deployed it')
	}
}

const computeSecurityPoolSalt = (parent: `0x${ string }`, universeId: bigint, questionId: bigint, securityMultiplier: bigint) => {
	const values = [parent, universeId, questionId, securityMultiplier] as const
	return keccak256(encodeAbiParameters([
		{ name: 'parent', type: 'address' },
		{ name: 'universeId', type: 'uint192' },
		{ name: 'questionId', type: 'uint56' },
		{ name: 'securityMultiplier', type: 'uint256' },
	], values))
}

const computeShareTokenSalt = (securityMultiplier: bigint) => {
	return keccak256(encodeAbiParameters([{ name: 'securityMultiplier', type: 'uint256' }], [securityMultiplier]))
}

export const getSecurityPoolAddresses = (parent: `0x${ string }`, universeId: bigint, questionId: bigint, securityMultiplier: bigint) => {
	const securityPoolSalt = computeSecurityPoolSalt(parent, universeId, questionId, securityMultiplier)
	const infraContracts = getInfraContractAddresses()
	const securityPoolSaltWithMsgSender = keccak256(encodeAbiParameters([{ name: 'securityPoolFactory', type:'address' }, { name: 'securityPoolSalt', type: 'bytes32' }] as const, [infraContracts.securityPoolFactory, securityPoolSalt]))

	const contracts = {
		priceOracleManagerAndOperatorQueuer: getCreate2Address({
			bytecode: encodeDeployData({
				abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
				bytecode: `0x${ peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.evm.bytecode.object }`,
				args: [ infraContracts.openOracle, getRepTokenAddress(universeId) ]
			}),
			from: infraContracts.priceOracleManagerAndOperatorQueuerFactory,
			salt: securityPoolSaltWithMsgSender
		}),
		shareToken: getCreate2Address({
			bytecode: encodeDeployData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				bytecode: `0x${ peripherals_tokens_ShareToken_ShareToken.evm.bytecode.object }`,
				args: [ infraContracts.securityPoolFactory, infraContracts.zoltar, questionId ]
			}),
			from: infraContracts.shareTokenFactory,
			salt: computeShareTokenSalt(securityMultiplier)
		}),
		truthAuction: BigInt(parent) == 0n ? zeroAddress : getCreate2Address({
			bytecode: `0x${ peripherals_Auction_Auction.evm.bytecode.object }`,
			from: infraContracts.auctionFactory,
			salt: securityPoolSaltWithMsgSender
		}),
	}
	const securityPool = getCreate2Address({
		bytecode: encodeDeployData({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			bytecode: applyLibraries(peripherals_SecurityPool_SecurityPool.evm.bytecode.object),
			args: [ infraContracts.securityPoolFactory, contracts.truthAuction, contracts.priceOracleManagerAndOperatorQueuer, contracts.shareToken, infraContracts.openOracle, parent, infraContracts.zoltar, universeId, questionId, securityMultiplier] as const
		}),
		from: infraContracts.securityPoolFactory,
		salt: numberToBytes(0)
	})
	return { ...contracts, securityPool }
}

export const deployOriginSecurityPool = async (client: WriteClient, universeId: bigint, questionId: bigint, securityMultiplier: bigint, startingRetentionRate: bigint, startingRepEthPrice: bigint, completeSetCollateralAmount: bigint) => {
	const infraAddresses = getInfraContractAddresses()
	return await client.writeContract({
		chain: mainnet,
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'deployOriginSecurityPool',
		address: infraAddresses.securityPoolFactory,
		args: [universeId, questionId, securityMultiplier, startingRetentionRate, startingRepEthPrice, completeSetCollateralAmount]
	})
}

import 'viem/window'
import { Abi, getContractAddress, numberToBytes } from 'viem'
import { promises as fs } from 'fs'
import { ReadClient, WriteClient } from './viem.js'
import { PROXY_DEPLOYER_ADDRESS } from './constants.js'
import { addressString } from './bigint.js'
import * as funtypes from 'funtypes'
import { getZoltarAddress } from './utilities.js'
import { mainnet } from 'viem/chains'

const ContractDefinition = funtypes.ReadonlyObject({
	abi: funtypes.Unknown,
	evm: funtypes.ReadonlyObject({
		bytecode: funtypes.ReadonlyObject({
			object: funtypes.String
		}),
		deployedBytecode: funtypes.ReadonlyObject({
			object: funtypes.String
		})
	})
})

type ContractArtifact = funtypes.Static<typeof ContractArtifact>
const ContractArtifact = funtypes.ReadonlyObject({
	contracts: funtypes.ReadonlyObject({
		'contracts/peripherals/openOracle/OpenOracle.sol': funtypes.ReadonlyObject({
			OpenOracle: ContractDefinition
		}),
		'contracts/peripherals/SecurityPool.sol': funtypes.ReadonlyObject({
			SecurityPoolFactory: ContractDefinition
		})
	}),
})

const contractLocation = './artifacts/Contracts.json'
export const contractsArtifact = ContractArtifact.parse(JSON.parse(await fs.readFile(contractLocation, 'utf8')))

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

export const deploySecurityPool = async (client: WriteClient, openOracle: `0x${ string }`, universeId: bigint, questionId: bigint, securityMultiplier: bigint, startingPerSecondFee: bigint, startingRepEthPrice: bigint, ethAmountForCompleteSets: bigint) => {
	const zoltarAddress = getZoltarAddress()
	return await client.writeContract({
		chain: mainnet,
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPoolFactory.abi as Abi,
		functionName: 'deploySecurityPool',
		address: getSecurityPoolFactoryAddress(),
		args: [addressString(0x0n), openOracle, zoltarAddress, universeId, questionId, securityMultiplier, startingPerSecondFee, startingRepEthPrice, ethAmountForCompleteSets]
	})
}

export const getDeployedSecurityPool = async (client: ReadClient, securityPoolId: bigint) => {
	return await client.readContract({
		abi: contractsArtifact.contracts['contracts/peripherals/SecurityPool.sol'].SecurityPoolFactory.abi as Abi,
		functionName: 'securityPools',
		address: getSecurityPoolFactoryAddress(),
		args: [securityPoolId]
	}) as bigint
}

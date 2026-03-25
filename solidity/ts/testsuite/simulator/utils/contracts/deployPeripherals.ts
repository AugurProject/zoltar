import 'viem/window'
import { encodeDeployData, getCreate2Address, keccak256, numberToBytes, toHex, zeroAddress, encodeAbiParameters } from 'viem'
import { WriteClient, writeContractAndWait } from '../viem'
import { PROXY_DEPLOYER_ADDRESS } from '../constants'
import { addressString } from '../bigint'
import { contractExists } from '../utilities'
import { peripherals_EscalationGame_EscalationGame, peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory, peripherals_factories_EscalationGameFactory_EscalationGameFactory, peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_factories_ShareTokenFactory_ShareTokenFactory, peripherals_openOracle_OpenOracle_OpenOracle, peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer, peripherals_SecurityPool_SecurityPool, peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_SecurityPoolUtils_SecurityPoolUtils, peripherals_tokens_ShareToken_ShareToken, ScalarOutcomes_ScalarOutcomes, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData, peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction } from '../../../../types/contractArtifact'
import { objectEntries } from '../typescript'
import { getRepTokenAddress, getZoltarAddress } from './zoltar'

const getSecurityPoolUtilsAddress = () => getCreate2Address({ bytecode: `0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }`, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0, { size: 32 }) })

const getScalarOutcomesAddress = () => getCreate2Address({ bytecode: `0x${ ScalarOutcomes_ScalarOutcomes.evm.bytecode.object }`, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0, { size: 32 }) })

export const applyLibraries = (bytecode: string): `0x${ string }` => {
	type LibraryReplacement = { hash: string; address: `0x${ string }` }
	const librariesToReplace: LibraryReplacement[] = [
		{ hash: keccak256(toHex('contracts/ScalarOutcomes.sol:ScalarOutcomes')).slice(2, 36), address: getScalarOutcomesAddress() },
		{ hash: keccak256(toHex('contracts/peripherals/SecurityPoolUtils.sol:SecurityPoolUtils')).slice(2, 36), address: getSecurityPoolUtilsAddress() },
	]
	let updatedBytecode = bytecode
	for (const { hash, address } of librariesToReplace) {
		updatedBytecode = updatedBytecode.replaceAll(`__$${ hash }$__`, address.slice(2).toLowerCase())
	}
	return `0x${ updatedBytecode }`
}

const getSecurityPoolForkerByteCode = (zoltar: `0x${ string }`) =>
	encodeDeployData({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		bytecode: applyLibraries(peripherals_SecurityPoolForker_SecurityPoolForker.evm.bytecode.object),
		args: [zoltar],
	})

const getSecurityPoolFactoryByteCode = (securityPoolForker: `0x${ string }`, questionData: `0x${ string }`, escalationGameFactory: `0x${ string }`, openOracle: `0x${ string }`, zoltar: `0x${ string }`, shareTokenFactory: `0x${ string }`, uniformPriceDualCapBatchAuctionFactory: `0x${ string }`, priceOracleManagerAndOperatorQueuerFactory: `0x${ string }`) =>
	encodeDeployData({
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		bytecode: applyLibraries(peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
		args: [securityPoolForker, questionData, escalationGameFactory, openOracle, zoltar, shareTokenFactory, uniformPriceDualCapBatchAuctionFactory, priceOracleManagerAndOperatorQueuerFactory],
	})

const getSecurityPoolFactoryAddress = (securityPoolForker: `0x${ string }`, questionData: `0x${ string }`, escalationGameFactory: `0x${ string }`, openOracle: `0x${ string }`, zoltar: `0x${ string }`, shareTokenFactory: `0x${ string }`, uniformPriceDualCapBatchAuctionFactory: `0x${ string }`, priceOracleManagerAndOperatorQueuerFactory: `0x${ string }`) =>
	getCreate2Address({
		from: addressString(PROXY_DEPLOYER_ADDRESS),
		salt: numberToBytes(0, { size: 32 }),
		bytecode: getSecurityPoolFactoryByteCode(securityPoolForker, questionData, escalationGameFactory, openOracle, zoltar, shareTokenFactory, uniformPriceDualCapBatchAuctionFactory, priceOracleManagerAndOperatorQueuerFactory),
	})

const getShareTokenFactoryByteCode = (zoltar: `0x${ string }`) =>
	encodeDeployData({
		abi: peripherals_factories_ShareTokenFactory_ShareTokenFactory.abi,
		bytecode: `0x${ peripherals_factories_ShareTokenFactory_ShareTokenFactory.evm.bytecode.object }`,
		args: [zoltar],
	})

const getEscalationGameFactoryByteCode = () =>
	encodeDeployData({
		abi: peripherals_factories_EscalationGameFactory_EscalationGameFactory.abi,
		bytecode: `0x${ peripherals_factories_EscalationGameFactory_EscalationGameFactory.evm.bytecode.object }`,
	})

const getZoltarQuestionDataByteCode = () =>
	encodeDeployData({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		bytecode: applyLibraries(ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object),
	})

export function getInfraContractAddresses() {
	const getAddress = (bytecode: `0x${ string }`) => getCreate2Address({ bytecode, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0, { size: 32 }) })

	const contracts = {
		securityPoolUtils: getSecurityPoolUtilsAddress(),
		openOracle: getAddress(`0x${ peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object }`),
		zoltar: getZoltarAddress(),
		shareTokenFactory: getAddress(getShareTokenFactoryByteCode(getZoltarAddress())),
		priceOracleManagerAndOperatorQueuerFactory: getAddress(`0x${ peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object }`),
		securityPoolForker: getAddress(getSecurityPoolForkerByteCode(getZoltarAddress())),
		escalationGameFactory: getAddress(getEscalationGameFactoryByteCode()),
		zoltarQuestionData: getAddress(getZoltarQuestionDataByteCode()),
		scalarOutcomes: getScalarOutcomesAddress(),
		uniformPriceDualCapBatchAuctionFactory: getAddress(`0x${ peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object }`),
	}
	const securityPoolFactory = getSecurityPoolFactoryAddress(contracts.securityPoolForker, contracts.zoltarQuestionData, contracts.escalationGameFactory, contracts.openOracle, contracts.zoltar, contracts.shareTokenFactory, contracts.uniformPriceDualCapBatchAuctionFactory, contracts.priceOracleManagerAndOperatorQueuerFactory)
	return { ...contracts, securityPoolFactory }
}

async function getInfraDeployedInformation(client: WriteClient): Promise<{ [key in keyof ReturnType<typeof getInfraContractAddresses>]: boolean }> {
	const contractAddresses = getInfraContractAddresses()
	type ContractKeys = keyof typeof contractAddresses

	const contractKeys = Object.keys(contractAddresses) as ContractKeys[]

	const contractExistencePairs = await Promise.all(
		contractKeys.map(async key => {
			const doesExist = await contractExists(client, contractAddresses[key])
			return [key, doesExist] as const
		}),
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

	const deployBytecode = async (bytecode: `0x${ string }`) => {
		const hash = await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: bytecode })
		await client.waitForTransactionReceipt({ hash })
	}

	if (!existence.uniformPriceDualCapBatchAuctionFactory) await deployBytecode(`0x${ peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object }`)
	if (!existence.scalarOutcomes) await deployBytecode(`0x${ ScalarOutcomes_ScalarOutcomes.evm.bytecode.object }`)
	if (!existence.securityPoolUtils) await deployBytecode(`0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }`)
	if (!existence.openOracle) await deployBytecode(`0x${ peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object }`)
	if (!existence.zoltarQuestionData) await deployBytecode(getZoltarQuestionDataByteCode())
	if (!existence.zoltar) {
		const initCode = encodeDeployData({
			abi: Zoltar_Zoltar.abi,
			bytecode: `0x${ Zoltar_Zoltar.evm.bytecode.object }`,
			args: [contractAddresses.zoltarQuestionData],
		})
		await deployBytecode(initCode)
	}
	if (!existence.shareTokenFactory) await deployBytecode(getShareTokenFactoryByteCode(getZoltarAddress()))
	if (!existence.priceOracleManagerAndOperatorQueuerFactory) await deployBytecode(`0x${ peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object }`)
	if (!existence.securityPoolForker) await deployBytecode(getSecurityPoolForkerByteCode(contractAddresses.zoltar))
	if (!existence.escalationGameFactory) await deployBytecode(getEscalationGameFactoryByteCode())
	if (!existence.securityPoolFactory) await deployBytecode(getSecurityPoolFactoryByteCode(contractAddresses.securityPoolForker, contractAddresses.zoltarQuestionData, contractAddresses.escalationGameFactory, contractAddresses.openOracle, contractAddresses.zoltar, contractAddresses.shareTokenFactory, contractAddresses.uniformPriceDualCapBatchAuctionFactory, contractAddresses.priceOracleManagerAndOperatorQueuerFactory))

	for (const [name, contractAddress] of objectEntries(contractAddresses)) {
		if (!(await contractExists(client, contractAddress))) throw new Error(`${ name } does not exist even though we deployed it`)
	}
}

const computeSecurityPoolSalt = (parent: `0x${ string }`, universeId: bigint, questionId: bigint, securityMultiplier: bigint) => {
	const values = [parent, universeId, questionId, securityMultiplier] as const
	return keccak256(
		encodeAbiParameters(
			[
				{ name: 'parent', type: 'address' },
				{ name: 'universeId', type: 'uint248' },
				{ name: 'questionId', type: 'uint256' },
				{ name: 'securityMultiplier', type: 'uint256' },
			],
			values,
		),
	)
}

const computeShareTokenSalt = (securityMultiplier: bigint, questionId: bigint) => {
	const values = [securityMultiplier, questionId] as const
	return keccak256(
		encodeAbiParameters(
			[
				{ name: 'securityMultiplier', type: 'uint256' },
				{ name: 'questionId', type: 'uint256' },
			],
			values,
		),
	)
}

export const getSecurityPoolAddresses = (parent: `0x${ string }`, universeId: bigint, questionId: bigint, securityMultiplier: bigint) => {
	const securityPoolSalt = computeSecurityPoolSalt(parent, universeId, questionId, securityMultiplier)
	const infraContracts = getInfraContractAddresses()
	const securityPoolTypes = [
		{ name: 'securityPoolFactory', type: 'address' },
		{ name: 'securityPoolSalt', type: 'bytes32' },
	]
	const securityPoolSaltWithMsgSender = keccak256(encodeAbiParameters(securityPoolTypes, [infraContracts.securityPoolFactory, securityPoolSalt]))

	const contracts = {
		priceOracleManagerAndOperatorQueuer: getCreate2Address({
			bytecode: encodeDeployData({
				abi: peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.abi,
				bytecode: `0x${ peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer.evm.bytecode.object }`,
				args: [infraContracts.openOracle, getRepTokenAddress(universeId)],
			}),
			from: infraContracts.priceOracleManagerAndOperatorQueuerFactory,
			salt: securityPoolSaltWithMsgSender,
		}),
		shareToken: getCreate2Address({
			bytecode: encodeDeployData({
				abi: peripherals_tokens_ShareToken_ShareToken.abi,
				bytecode: `0x${ peripherals_tokens_ShareToken_ShareToken.evm.bytecode.object }`,
				args: [infraContracts.securityPoolFactory, infraContracts.zoltar, questionId],
			}),
			from: infraContracts.shareTokenFactory,
			salt: computeShareTokenSalt(securityMultiplier, questionId),
		}),
		truthAuction:
			BigInt(parent) === 0n
				? zeroAddress
				: getCreate2Address({
						bytecode: encodeDeployData({
							abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
							bytecode: `0x${ peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.evm.bytecode.object }`,
							args: [infraContracts.securityPoolForker],
						}),
						from: infraContracts.uniformPriceDualCapBatchAuctionFactory,
						salt: securityPoolSalt,
					}),
	}
	const securityPool = getCreate2Address({
		bytecode: encodeDeployData({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			bytecode: applyLibraries(peripherals_SecurityPool_SecurityPool.evm.bytecode.object),
			args: [infraContracts.securityPoolForker, infraContracts.securityPoolFactory, infraContracts.zoltarQuestionData, infraContracts.escalationGameFactory, contracts.priceOracleManagerAndOperatorQueuer, contracts.shareToken, infraContracts.openOracle, parent, infraContracts.zoltar, universeId, questionId, securityMultiplier, contracts.truthAuction] as const,
		}),
		from: infraContracts.securityPoolFactory,
		salt: numberToBytes(0, { size: 32 }),
	})
	const escalationGame = getCreate2Address({
		bytecode: encodeDeployData({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			bytecode: `0x${ peripherals_EscalationGame_EscalationGame.evm.bytecode.object }`,
			args: [securityPool],
		}),
		from: infraContracts.escalationGameFactory,
		salt: numberToBytes(0, { size: 32 }),
	})
	return { ...contracts, securityPool, escalationGame }
}

export const deployOriginSecurityPool = async (client: WriteClient, universeId: bigint, questionId: bigint, securityMultiplier: bigint, startingRetentionRate: bigint, startingRepEthPrice: bigint) => {
	const infraAddresses = getInfraContractAddresses()
	return await writeContractAndWait(client, () => client.writeContract({
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'deployOriginSecurityPool',
		address: infraAddresses.securityPoolFactory,
		args: [universeId, questionId, securityMultiplier, startingRetentionRate, startingRepEthPrice],
	}))
}

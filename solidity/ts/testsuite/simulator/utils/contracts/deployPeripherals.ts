import 'viem/window'
import { encodeDeployData, getCreate2Address, keccak256, numberToBytes, toHex, zeroAddress, encodeAbiParameters } from 'viem'
import { WriteClient } from '../viem'
import { PROXY_DEPLOYER_ADDRESS } from '../constants'
import { addressString } from '../bigint'
import { contractExists } from '../utilities'
import { peripherals_EscalationGame_EscalationGame, peripherals_factories_DualCapBatchAuctionFactory_DualCapBatchAuctionFactory, peripherals_factories_EscalationGameFactory_EscalationGameFactory, peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_factories_ShareTokenFactory_ShareTokenFactory, peripherals_openOracle_OpenOracle_OpenOracle, peripherals_PriceOracleManagerAndOperatorQueuer_PriceOracleManagerAndOperatorQueuer, peripherals_SecurityPool_SecurityPool, peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_SecurityPoolUtils_SecurityPoolUtils, peripherals_tokens_ShareToken_ShareToken, ScalarOutcomes_ScalarOutcomes, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData, peripherals_DualCapBatchAuction_DualCapBatchAuction } from '../../../../types/contractArtifact'
import { objectEntries } from '../typescript'
import { getRepTokenAddress, getZoltarAddress } from './zoltar'

const getSecurityPoolUtilsAddress = () => getCreate2Address({ bytecode: `0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }`, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0) })

const getScalarOutcomesAddress = () => getCreate2Address({ bytecode: `0x${ ScalarOutcomes_ScalarOutcomes.evm.bytecode.object }`, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0) })

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

const getSecurityPoolFactoryByteCode = (securityPoolForker: `0x${ string }`, questionData: `0x${ string }`, escalationGameFactory: `0x${ string }`, openOracle: `0x${ string }`, zoltar: `0x${ string }`, shareTokenFactory: `0x${ string }`, dualCapBatchAuctionFactory: `0x${ string }`, priceOracleManagerAndOperatorQueuerFactory: `0x${ string }`) =>
	encodeDeployData({
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		bytecode: applyLibraries(peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
		args: [securityPoolForker, questionData, escalationGameFactory, openOracle, zoltar, shareTokenFactory, dualCapBatchAuctionFactory, priceOracleManagerAndOperatorQueuerFactory],
	})

const getSecurityPoolFactoryAddress = (securityPoolForker: `0x${ string }`, questionData: `0x${ string }`, escalationGameFactory: `0x${ string }`, openOracle: `0x${ string }`, zoltar: `0x${ string }`, shareTokenFactory: `0x${ string }`, dualCapBatchAuctionFactory: `0x${ string }`, priceOracleManagerAndOperatorQueuerFactory: `0x${ string }`) =>
	getCreate2Address({
		from: addressString(PROXY_DEPLOYER_ADDRESS),
		salt: numberToBytes(0),
		bytecode: getSecurityPoolFactoryByteCode(securityPoolForker, questionData, escalationGameFactory, openOracle, zoltar, shareTokenFactory, dualCapBatchAuctionFactory, priceOracleManagerAndOperatorQueuerFactory),
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
	const getAddress = (bytecode: `0x${ string }`) => getCreate2Address({ bytecode, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: numberToBytes(0) })

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
		dualCapBatchAuctionFactory: getAddress(`0x${ peripherals_factories_DualCapBatchAuctionFactory_DualCapBatchAuctionFactory.evm.bytecode.object }`),
	}
	const securityPoolFactory = getSecurityPoolFactoryAddress(contracts.securityPoolForker, contracts.zoltarQuestionData, contracts.escalationGameFactory, contracts.openOracle, contracts.zoltar, contracts.shareTokenFactory, contracts.dualCapBatchAuctionFactory, contracts.priceOracleManagerAndOperatorQueuerFactory)
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

	if (!existence.dualCapBatchAuctionFactory) await deployBytecode(`0x${ peripherals_factories_DualCapBatchAuctionFactory_DualCapBatchAuctionFactory.evm.bytecode.object }`)
	if (!existence.scalarOutcomes) await deployBytecode(`0x${ ScalarOutcomes_ScalarOutcomes.evm.bytecode.object }`)
	if (!existence.securityPoolUtils) await deployBytecode(`0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }`)
	if (!existence.openOracle) await deployBytecode(`0x${ peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object }`)
	if (!existence.zoltarQuestionData) await deployBytecode(getZoltarQuestionDataByteCode())
	if (!existence.zoltar) await deployBytecode(`0x${ Zoltar_Zoltar.evm.bytecode.object }`)
	if (!existence.shareTokenFactory) await deployBytecode(getShareTokenFactoryByteCode(getZoltarAddress()))
	if (!existence.priceOracleManagerAndOperatorQueuerFactory) await deployBytecode(`0x${ peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object }`)
	if (!existence.securityPoolForker) await deployBytecode(getSecurityPoolForkerByteCode(contractAddresses.zoltar))
	if (!existence.escalationGameFactory) await deployBytecode(getEscalationGameFactoryByteCode())
	if (!existence.securityPoolFactory) await deployBytecode(getSecurityPoolFactoryByteCode(contractAddresses.securityPoolForker, contractAddresses.zoltarQuestionData, contractAddresses.escalationGameFactory, contractAddresses.openOracle, contractAddresses.zoltar, contractAddresses.shareTokenFactory, contractAddresses.dualCapBatchAuctionFactory, contractAddresses.priceOracleManagerAndOperatorQueuerFactory))

	// Set ZoltarQuestionData on Zoltar (must be done after both are deployed)
	// Check if not already set, to handle cases where Zoltar was deployed earlier
	if (await contractExists(client, contractAddresses.zoltar)) {
		const isSet = await client.readContract({
			abi: Zoltar_Zoltar.abi,
			functionName: 'zoltarQuestionDataSet',
			address: contractAddresses.zoltar,
			args: [],
		})
		if (!isSet) {
			const setZoltarQuestionDataHash = await client.writeContract({
				abi: Zoltar_Zoltar.abi,
				functionName: 'setZoltarQuestionData',
				address: contractAddresses.zoltar,
				args: [contractAddresses.zoltarQuestionData],
			})
			await client.waitForTransactionReceipt({ hash: setZoltarQuestionDataHash })
		}
	}

	for (const [name, contractAddress] of objectEntries(contractAddresses)) {
		if (!(await contractExists(client, contractAddress))) throw new Error(`${ name } does not exist even though we deployed it`)
	}
}

const computeSecurityPoolSalt = (parent: `0x${ string }`, universeId: bigint, marketId: bigint, securityMultiplier: bigint) => {
	const values = [parent, universeId, marketId, securityMultiplier] as const
	return keccak256(
		encodeAbiParameters(
			[
				{ name: 'parent', type: 'address' },
				{ name: 'universeId', type: 'uint248' },
				{ name: 'marketId', type: 'uint256' },
				{ name: 'securityMultiplier', type: 'uint256' },
			],
			values,
		),
	)
}

const computeShareTokenSalt = (securityMultiplier: bigint, marketId: bigint) => {
	const values = [securityMultiplier, marketId] as const
	return keccak256(
		encodeAbiParameters(
			[
				{ name: 'securityMultiplier', type: 'uint256' },
				{ name: 'marketId', type: 'uint256' },
			],
			values,
		),
	)
}

export const getMarketId = (universeId: bigint, securityMultiplier: bigint, extraInfo: string, marketEndDate: bigint) => {
	// Parameters kept for compatibility but not used in computation
	void universeId;
	void securityMultiplier;
	// Compute questionId as keccak256(abi.encode(QuestionData, outcomeOptions))
	// QuestionData struct: (string title, string description, uint256 startTime, uint256 endTime, uint256 numTicks, int256 displayValueMin, int256 displayValueMax, string answerUnit)
	// outcomeOptions: string[]
	const questionDataTuple = {
		title: extraInfo,
		description: '',
		startTime: 0n,
		endTime: marketEndDate,
		numTicks: 0n,
		displayValueMin: 0n,
		displayValueMax: 0n,
		answerUnit: ''
	};
	const outcomeOptions = ['Yes', 'No'];
	const encoded = encodeAbiParameters(
		[
			{
				name: 'questionData',
				type: 'tuple',
				components: [
					{ name: 'title', type: 'string' },
					{ name: 'description', type: 'string' },
					{ name: 'startTime', type: 'uint256' },
					{ name: 'endTime', type: 'uint256' },
					{ name: 'numTicks', type: 'uint256' },
					{ name: 'displayValueMin', type: 'int256' },
					{ name: 'displayValueMax', type: 'int256' },
					{ name: 'answerUnit', type: 'string' }
				]
			},
			{ name: 'outcomeOptions', type: 'string[]' }
		],
		[questionDataTuple, outcomeOptions]
	);
	return BigInt(keccak256(encoded));
}

export const getSecurityPoolAddresses = (parent: `0x${ string }`, universeId: bigint, marketId: bigint, securityMultiplier: bigint) => {
	const securityPoolSalt = computeSecurityPoolSalt(parent, universeId, marketId, securityMultiplier)
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
				args: [infraContracts.securityPoolFactory, infraContracts.zoltar],
			}),
			from: infraContracts.shareTokenFactory,
			salt: computeShareTokenSalt(securityMultiplier, marketId),
		}),
		truthAuction:
			BigInt(parent) === 0n
				? zeroAddress
				: getCreate2Address({
						bytecode: encodeDeployData({
							abi: peripherals_DualCapBatchAuction_DualCapBatchAuction.abi,
							bytecode: `0x${ peripherals_DualCapBatchAuction_DualCapBatchAuction.evm.bytecode.object }`,
							args: [infraContracts.securityPoolForker],
						}),
						from: infraContracts.dualCapBatchAuctionFactory,
						salt: securityPoolSalt,
					}),
	}
	const securityPool = getCreate2Address({
		bytecode: encodeDeployData({
			abi: peripherals_SecurityPool_SecurityPool.abi,
			bytecode: applyLibraries(peripherals_SecurityPool_SecurityPool.evm.bytecode.object),
			args: [infraContracts.securityPoolForker, infraContracts.securityPoolFactory, infraContracts.zoltarQuestionData, infraContracts.escalationGameFactory, contracts.priceOracleManagerAndOperatorQueuer, contracts.shareToken, infraContracts.openOracle, parent, infraContracts.zoltar, universeId, marketId, securityMultiplier] as const,
		}),
		from: infraContracts.securityPoolFactory,
		salt: numberToBytes(0),
	})
	const escalationGame = getCreate2Address({
		bytecode: encodeDeployData({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			bytecode: `0x${ peripherals_EscalationGame_EscalationGame.evm.bytecode.object }`,
			args: [securityPool],
		}),
		from: infraContracts.escalationGameFactory,
		salt: numberToBytes(0),
	})
	return { ...contracts, securityPool, escalationGame }
}

export const deployOriginSecurityPool = async (client: WriteClient, universeId: bigint, extraInfo: string, marketEndDate: bigint, securityMultiplier: bigint, startingRetentionRate: bigint, startingRepEthPrice: bigint) => {
	const infraAddresses = getInfraContractAddresses()
	return await client.writeContract({
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		functionName: 'deployOriginSecurityPool',
		address: infraAddresses.securityPoolFactory,
		args: [universeId, extraInfo, marketEndDate, securityMultiplier, startingRetentionRate, startingRepEthPrice],
	})
}

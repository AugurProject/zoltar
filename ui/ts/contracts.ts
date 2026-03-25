import { encodeDeployData, getAddress, getContractAddress, getCreate2Address, keccak256, numberToBytes, toHex, type Address, type Hash, type Hex } from 'viem'
import { ScalarOutcomes_ScalarOutcomes, Zoltar_Zoltar, ZoltarQuestionData_ZoltarQuestionData, peripherals_SecurityPoolForker_SecurityPoolForker, peripherals_SecurityPoolUtils_SecurityPoolUtils, peripherals_factories_EscalationGameFactory_EscalationGameFactory, peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory, peripherals_factories_SecurityPoolFactory_SecurityPoolFactory, peripherals_factories_ShareTokenFactory_ShareTokenFactory, peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory, peripherals_openOracle_OpenOracle_OpenOracle } from './contractArtifact.js'

export const GENESIS_REPUTATION_TOKEN = bigintToAddress(0x221657776846890989a759ba2973e427dff5c9bbn)
const PROXY_DEPLOYER_ADDRESS = bigintToAddress(0x7a0d94f55792c434d74a40883c6ed8545e406d12n)
const PROXY_DEPLOYER_SIGNER = getAddress('0x4c8d290a1b368ac4728d83a9e8321fc3af2b39b1')
const PROXY_DEPLOYER_RAW_TRANSACTION = '0xf87e8085174876e800830186a08080ad601f80600e600039806000f350fe60003681823780368234f58015156014578182fd5b80825250506014600cf31ba02222222222222222222222222222222222222222222222222222222222222222a02222222222222222222222222222222222222222222222222222222222222222' satisfies Hex
const ZERO_SALT = numberToBytes(0, { size: 32 })
const FUND_PROXY_DEPLOYER_SIGNER_AMOUNT = 10000000000000000n

type DeploymentStep = {
	id: string
	label: string
	address: Address
	dependencies: string[]
	deploy: (client: DeploymentClient) => Promise<Hash>
}

export type DeploymentStatus = DeploymentStep & {
	deployed: boolean
}

type DeploymentClient = {
	getCode: (parameters: { address: Address }) => Promise<Hex | undefined>
	sendTransaction: (parameters: { to?: Address; data?: Hex; value?: bigint }) => Promise<Hash>
	sendRawTransaction: (parameters: { serializedTransaction: Hex }) => Promise<Hash>
	waitForTransactionReceipt: (parameters: { hash: Hash }) => Promise<unknown>
}

type DeploymentReadClient = {
	getCode: (parameters: { address: Address }) => Promise<Hex | undefined>
}

function bigintToAddress(value: bigint): Address {
	return getAddress(`0x${ value.toString(16).padStart(40, '0') }`)
}

const getSecurityPoolUtilsAddress = () =>
	getCreate2Address({
		bytecode: `0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }`,
		from: PROXY_DEPLOYER_ADDRESS,
		salt: ZERO_SALT,
	})

const getScalarOutcomesAddress = () =>
	getCreate2Address({
		bytecode: `0x${ ScalarOutcomes_ScalarOutcomes.evm.bytecode.object }`,
		from: PROXY_DEPLOYER_ADDRESS,
		salt: ZERO_SALT,
	})

const getShareTokenFactoryByteCode = (zoltarAddress: Address) =>
	encodeDeployData({
		abi: peripherals_factories_ShareTokenFactory_ShareTokenFactory.abi,
		bytecode: `0x${ peripherals_factories_ShareTokenFactory_ShareTokenFactory.evm.bytecode.object }`,
		args: [zoltarAddress],
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

const getSecurityPoolForkerByteCode = (zoltarAddress: Address) =>
	encodeDeployData({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		bytecode: applyLibraries(peripherals_SecurityPoolForker_SecurityPoolForker.evm.bytecode.object),
		args: [zoltarAddress],
	})

const getZoltarQuestionDataAddress = () =>
	getContractAddress({
		bytecode: `0x${ ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object }`,
		from: PROXY_DEPLOYER_ADDRESS,
		opcode: 'CREATE2',
		salt: ZERO_SALT,
	})

const getZoltarInitCode = (zoltarQuestionDataAddress: Address) =>
	encodeDeployData({
		abi: Zoltar_Zoltar.abi,
		bytecode: `0x${ Zoltar_Zoltar.evm.bytecode.object }`,
		args: [zoltarQuestionDataAddress],
	})

const getZoltarAddress = () => {
	const zoltarQuestionDataAddress = getZoltarQuestionDataAddress()
	return getCreate2Address({
		from: PROXY_DEPLOYER_ADDRESS,
		salt: ZERO_SALT,
		bytecode: getZoltarInitCode(zoltarQuestionDataAddress),
	})
}

const getSecurityPoolFactoryByteCode = (securityPoolForker: Address, questionData: Address, escalationGameFactory: Address, openOracle: Address, zoltar: Address, shareTokenFactory: Address, uniformPriceDualCapBatchAuctionFactory: Address, priceOracleManagerAndOperatorQueuerFactory: Address) =>
	encodeDeployData({
		abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
		bytecode: applyLibraries(peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
		args: [securityPoolForker, questionData, escalationGameFactory, openOracle, zoltar, shareTokenFactory, uniformPriceDualCapBatchAuctionFactory, priceOracleManagerAndOperatorQueuerFactory],
	})

function applyLibraries(bytecode: string): Hex {
	const librariesToReplace = [
		{
			hash: keccak256(toHex('contracts/ScalarOutcomes.sol:ScalarOutcomes')).slice(2, 36),
			address: getScalarOutcomesAddress(),
		},
		{
			hash: keccak256(toHex('contracts/peripherals/SecurityPoolUtils.sol:SecurityPoolUtils')).slice(2, 36),
			address: getSecurityPoolUtilsAddress(),
		},
	] as const

	let updatedBytecode = bytecode
	for (const { hash, address } of librariesToReplace) {
		updatedBytecode = updatedBytecode.replaceAll(`__$${ hash }$__`, address.slice(2).toLowerCase())
	}

	return `0x${ updatedBytecode }`
}

function getInfraContractAddresses() {
	const getAddressForBytecode = (bytecode: Hex) =>
		getCreate2Address({
			bytecode,
			from: PROXY_DEPLOYER_ADDRESS,
			salt: ZERO_SALT,
		})

	const contracts = {
		securityPoolUtils: getSecurityPoolUtilsAddress(),
		openOracle: getAddressForBytecode(`0x${ peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object }`),
		zoltarQuestionData: getAddressForBytecode(getZoltarQuestionDataByteCode()),
		zoltar: getZoltarAddress(),
		shareTokenFactory: getAddressForBytecode(getShareTokenFactoryByteCode(getZoltarAddress())),
		priceOracleManagerAndOperatorQueuerFactory: getAddressForBytecode(`0x${ peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object }`),
		securityPoolForker: getAddressForBytecode(getSecurityPoolForkerByteCode(getZoltarAddress())),
		escalationGameFactory: getAddressForBytecode(getEscalationGameFactoryByteCode()),
		scalarOutcomes: getScalarOutcomesAddress(),
		uniformPriceDualCapBatchAuctionFactory: getAddressForBytecode(`0x${ peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object }`),
	}

	return {
		...contracts,
		securityPoolFactory: getCreate2Address({
			from: PROXY_DEPLOYER_ADDRESS,
			salt: ZERO_SALT,
			bytecode: getSecurityPoolFactoryByteCode(contracts.securityPoolForker, contracts.zoltarQuestionData, contracts.escalationGameFactory, contracts.openOracle, contracts.zoltar, contracts.shareTokenFactory, contracts.uniformPriceDualCapBatchAuctionFactory, contracts.priceOracleManagerAndOperatorQueuerFactory),
		}),
	}
}

async function deployViaProxy(client: DeploymentClient, bytecode: Hex) {
	const hash = await client.sendTransaction({
		to: PROXY_DEPLOYER_ADDRESS,
		data: bytecode,
	})
	await client.waitForTransactionReceipt({ hash })
	return hash
}

async function ensureProxyDeployerDeployed(client: DeploymentClient) {
	const code = await client.getCode({ address: PROXY_DEPLOYER_ADDRESS })
	if (code !== undefined && code !== '0x') return null

	const fundHash = await client.sendTransaction({
		to: PROXY_DEPLOYER_SIGNER,
		value: FUND_PROXY_DEPLOYER_SIGNER_AMOUNT,
	})
	await client.waitForTransactionReceipt({ hash: fundHash })

	const deployHash = await client.sendRawTransaction({
		serializedTransaction: PROXY_DEPLOYER_RAW_TRANSACTION,
	})
	await client.waitForTransactionReceipt({ hash: deployHash })
	return deployHash
}

export function getDeploymentSteps(): DeploymentStep[] {
	const addresses = getInfraContractAddresses()

	return [
		{
			id: 'proxyDeployer',
			label: 'Proxy Deployer',
			address: PROXY_DEPLOYER_ADDRESS,
			dependencies: [],
			deploy: async client => {
				const hash = await ensureProxyDeployerDeployed(client)
				return hash ?? ('0x0000000000000000000000000000000000000000000000000000000000000000' as Hash)
			},
		},
		{
			id: 'uniformPriceDualCapBatchAuctionFactory',
			label: 'UniformPriceDualCapBatchAuctionFactory',
			address: addresses.uniformPriceDualCapBatchAuctionFactory,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${ peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object }`),
		},
		{
			id: 'scalarOutcomes',
			label: 'ScalarOutcomes',
			address: addresses.scalarOutcomes,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${ ScalarOutcomes_ScalarOutcomes.evm.bytecode.object }`),
		},
		{
			id: 'securityPoolUtils',
			label: 'SecurityPoolUtils',
			address: addresses.securityPoolUtils,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${ peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object }`),
		},
		{
			id: 'openOracle',
			label: 'OpenOracle',
			address: addresses.openOracle,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${ peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object }`),
		},
		{
			id: 'zoltarQuestionData',
			label: 'ZoltarQuestionData',
			address: addresses.zoltarQuestionData,
			dependencies: ['proxyDeployer', 'scalarOutcomes'],
			deploy: async client => await deployViaProxy(client, getZoltarQuestionDataByteCode()),
		},
		{
			id: 'zoltar',
			label: 'Zoltar',
			address: addresses.zoltar,
			dependencies: ['proxyDeployer', 'zoltarQuestionData'],
			deploy: async client => await deployViaProxy(client, getZoltarInitCode(addresses.zoltarQuestionData)),
		},
		{
			id: 'shareTokenFactory',
			label: 'ShareTokenFactory',
			address: addresses.shareTokenFactory,
			dependencies: ['proxyDeployer', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getShareTokenFactoryByteCode(addresses.zoltar)),
		},
		{
			id: 'priceOracleManagerAndOperatorQueuerFactory',
			label: 'PriceOracleManagerAndOperatorQueuerFactory',
			address: addresses.priceOracleManagerAndOperatorQueuerFactory,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, `0x${ peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object }`),
		},
		{
			id: 'securityPoolForker',
			label: 'SecurityPoolForker',
			address: addresses.securityPoolForker,
			dependencies: ['proxyDeployer', 'scalarOutcomes', 'securityPoolUtils', 'zoltar'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolForkerByteCode(addresses.zoltar)),
		},
		{
			id: 'escalationGameFactory',
			label: 'EscalationGameFactory',
			address: addresses.escalationGameFactory,
			dependencies: ['proxyDeployer'],
			deploy: async client => await deployViaProxy(client, getEscalationGameFactoryByteCode()),
		},
		{
			id: 'securityPoolFactory',
			label: 'SecurityPoolFactory',
			address: addresses.securityPoolFactory,
			dependencies: ['proxyDeployer', 'securityPoolForker', 'zoltarQuestionData', 'escalationGameFactory', 'openOracle', 'zoltar', 'shareTokenFactory', 'uniformPriceDualCapBatchAuctionFactory', 'priceOracleManagerAndOperatorQueuerFactory', 'securityPoolUtils'],
			deploy: async client => await deployViaProxy(client, getSecurityPoolFactoryByteCode(addresses.securityPoolForker, addresses.zoltarQuestionData, addresses.escalationGameFactory, addresses.openOracle, addresses.zoltar, addresses.shareTokenFactory, addresses.uniformPriceDualCapBatchAuctionFactory, addresses.priceOracleManagerAndOperatorQueuerFactory)),
		},
	]
}

export async function loadDeploymentStatuses(client: DeploymentReadClient): Promise<DeploymentStatus[]> {
	const steps = getDeploymentSteps()
	const deployed = await Promise.all(
		steps.map(async step => {
			const code = await client.getCode({ address: step.address })
			return code !== undefined && code !== '0x'
		}),
	)

	return steps.map((step, index) => ({
		...step,
		deployed: deployed[index] ?? false,
	}))
}

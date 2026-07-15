import { concatHex, encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256, type Address, type Hex, toHex } from '@zoltar/shared/ethereum'
import { createSecurityPoolAddressHelper } from '@zoltar/shared/addressDerivation'
import { createApplyLinkedLibrariesHelper, createDeploymentStatusOracleAddressHelper, createInfraContractAddressHelper, createZoltarAddressHelpers } from '@zoltar/shared/deploymentAddresses'
import { ORACLE_EXACT_TOKEN1_REPORT, ORACLE_FEE_PERCENTAGE, ORACLE_MULTIPLIER, ORACLE_PROTOCOL_FEE } from '@zoltar/shared/oracleInitialReport'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/shared/protocolConfig'
import { WriteClient, writeContractAndWait } from '../clients'
import { PROXY_DEPLOYER_ADDRESS } from '../constants'
import { addressString } from '../bigint'
import { contractExists } from '../utilities'
import {
	DeploymentStatusOracle_DeploymentStatusOracle,
	peripherals_EscalationGame_EscalationGame,
	peripherals_Multicall3_Multicall3,
	peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	peripherals_factories_EscalationGameFactory_EscalationGameFactory,
	peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory,
	peripherals_factories_SecurityPoolFactory_SecurityPoolFactory,
	peripherals_factories_ShareTokenFactory_ShareTokenFactory,
	peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	peripherals_openOracle_OpenOracle_OpenOracle,
	peripherals_SecurityPool_SecurityPool,
	peripherals_SecurityPoolForker_SecurityPoolForker,
	peripherals_SecurityPoolUtils_SecurityPoolUtils,
	peripherals_tokens_ShareToken_ShareToken,
	ScalarOutcomes_ScalarOutcomes,
	Zoltar_Zoltar,
	ZoltarQuestionData_ZoltarQuestionData,
	peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
} from '../../../../types/contractArtifact'
import { objectEntries } from '../typescript'
import { getRepTokenAddress } from './zoltar'

export { ORACLE_EXACT_TOKEN1_REPORT } from '@zoltar/shared/oracleInitialReport'

const ZERO_SALT: Hex = toHex(0, { size: 32 })
const MULTICALL3_BYTECODE = `0x${peripherals_Multicall3_Multicall3.evm.bytecode.object}` satisfies Hex
const MAINNET_WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' satisfies Address
const ORACLE_FEE_SINK_ADDRESS = '0x000000000000000000000000000000000000dEaD' satisfies Address
const ORACLE_REPORT_GAS = 100000n
const ORACLE_SETTLEMENT_GAS = 1000000
const ORACLE_SETTLEMENT_TIME = 40 * 12
const ORACLE_DISPUTE_DELAY = 0
const ORACLE_TIME_TYPE = true
const ORACLE_TRACK_DISPUTES = true
const ORACLE_PROTOCOL_FEE_RECIPIENT = ORACLE_FEE_SINK_ADDRESS
const ORACLE_ESCALATION_HALT_MULTIPLIER_BPS = 100000n
const ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS = 30000n
const ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS = 1000n

const getSecurityPoolUtilsAddress = () => getCreate2Address({ bytecode: `0x${peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: ZERO_SALT })

const getScalarOutcomesAddress = () => getCreate2Address({ bytecode: `0x${ScalarOutcomes_ScalarOutcomes.evm.bytecode.object}`, from: addressString(PROXY_DEPLOYER_ADDRESS), salt: ZERO_SALT })

export function getDeploymentStepAddresses() {
	return getDeploymentStatusOracleSteps().map(step => step.address)
}

function getDeploymentStatusOracleByteCode() {
	return encodeDeployData({
		abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
		bytecode: `0x${DeploymentStatusOracle_DeploymentStatusOracle.evm.bytecode.object}`,
		args: [getDeploymentStepAddresses()],
	})
}

function getPriceOracleManagerAndOperatorQueuerFactoryByteCode(): Hex {
	return concatHex([
		`0x${peripherals_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object}`,
		encodeAbiParameters(
			[{ type: 'address' }, { type: 'uint256' }, { type: 'uint32' }, { type: 'uint256' }, { type: 'uint48' }, { type: 'uint24' }, { type: 'uint24' }, { type: 'uint24' }, { type: 'uint16' }, { type: 'bool' }, { type: 'bool' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
			[
				MAINNET_WETH_ADDRESS,
				ORACLE_REPORT_GAS,
				ORACLE_SETTLEMENT_GAS,
				ORACLE_EXACT_TOKEN1_REPORT,
				ORACLE_SETTLEMENT_TIME,
				ORACLE_DISPUTE_DELAY,
				ORACLE_PROTOCOL_FEE,
				ORACLE_FEE_PERCENTAGE,
				ORACLE_MULTIPLIER,
				ORACLE_TIME_TYPE,
				ORACLE_TRACK_DISPUTES,
				ORACLE_PROTOCOL_FEE_RECIPIENT,
				ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
				ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
				ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
			],
		),
	])
}

const getSecurityPoolForkerByteCode = (zoltar: Address): Hex =>
	encodeDeployData({
		abi: peripherals_SecurityPoolForker_SecurityPoolForker.abi,
		bytecode: applyLibraries(peripherals_SecurityPoolForker_SecurityPoolForker.evm.bytecode.object),
		args: [zoltar],
	})

const getSecurityPoolFactoryByteCode = ({
	escalationGameFactory,
	openOracle,
	priceOracleManagerAndOperatorQueuerFactory,
	securityPoolForker,
	shareTokenFactory,
	uniformPriceDualCapBatchAuctionFactory,
	zoltar,
	zoltarQuestionData,
}: {
	escalationGameFactory: Address
	openOracle: Address
	priceOracleManagerAndOperatorQueuerFactory: Address
	securityPoolForker: Address
	shareTokenFactory: Address
	uniformPriceDualCapBatchAuctionFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}): Hex =>
	(() => {
		return encodeDeployData({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			bytecode: applyLibraries(peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
			args: [securityPoolForker, zoltarQuestionData, escalationGameFactory, openOracle, zoltar, shareTokenFactory, uniformPriceDualCapBatchAuctionFactory, priceOracleManagerAndOperatorQueuerFactory, DEFAULT_PROTOCOL_CONFIG.initialEscalationGameDeposit],
		})
	})()

const getShareTokenFactoryByteCode = (zoltar: Address): Hex =>
	encodeDeployData({
		abi: peripherals_factories_ShareTokenFactory_ShareTokenFactory.abi,
		bytecode: `0x${peripherals_factories_ShareTokenFactory_ShareTokenFactory.evm.bytecode.object}`,
		args: [zoltar],
	})

const getEscalationGameFactoryByteCode = (): Hex =>
	encodeDeployData({
		abi: peripherals_factories_EscalationGameFactory_EscalationGameFactory.abi,
		bytecode: `0x${peripherals_factories_EscalationGameFactory_EscalationGameFactory.evm.bytecode.object}`,
	})

const getZoltarInitCode = (zoltarQuestionDataAddress: Address): Hex =>
	(() => {
		return encodeDeployData({
			abi: Zoltar_Zoltar.abi,
			bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
			args: [zoltarQuestionDataAddress, DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor, DEFAULT_PROTOCOL_CONFIG.forkBurnDivisor],
		})
	})()

const getZoltarQuestionDataByteCode = (): Hex =>
	encodeDeployData({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		bytecode: applyLibraries(ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object),
	})

export const { applyLibraries } = createApplyLinkedLibrariesHelper(() => [
	{ hash: keccak256(toHex('contracts/ScalarOutcomes.sol:ScalarOutcomes')).slice(2, 36), address: getScalarOutcomesAddress() },
	{ hash: keccak256(toHex('contracts/peripherals/SecurityPoolUtils.sol:SecurityPoolUtils')).slice(2, 36), address: getSecurityPoolUtilsAddress() },
])

const { getZoltarAddress, getZoltarQuestionDataAddress } = createZoltarAddressHelpers({
	getZoltarInitCode,
	proxyDeployerAddress: addressString(PROXY_DEPLOYER_ADDRESS),
	zeroSalt: ZERO_SALT,
	zoltarQuestionDataBytecode: getZoltarQuestionDataByteCode,
})

export const { getInfraContractAddresses } = createInfraContractAddressHelper({
	getEscalationGameFactoryByteCode,
	getSecurityPoolFactoryByteCode,
	getSecurityPoolForkerByteCode,
	getShareTokenFactoryByteCode,
	getZoltarAddress,
	getZoltarQuestionDataAddress,
	multicall3Bytecode: MULTICALL3_BYTECODE,
	openOracleBytecode: `0x${peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object}`,
	priceOracleManagerAndOperatorQueuerFactoryBytecode: getPriceOracleManagerAndOperatorQueuerFactoryByteCode(),
	proxyDeployerAddress: addressString(PROXY_DEPLOYER_ADDRESS),
	scalarOutcomesBytecode: `0x${ScalarOutcomes_ScalarOutcomes.evm.bytecode.object}`,
	securityPoolUtilsBytecode: `0x${peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`,
	uniformPriceDualCapBatchAuctionFactoryBytecode: `0x${peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object}`,
	zeroSalt: ZERO_SALT,
})

export const { getDeploymentStatusOracleAddress } = createDeploymentStatusOracleAddressHelper({
	deploymentStatusOracleBytecode: getDeploymentStatusOracleByteCode,
	proxyDeployerAddress: addressString(PROXY_DEPLOYER_ADDRESS),
	zeroSalt: ZERO_SALT,
})

export const { getSecurityPoolAddresses } = createSecurityPoolAddressHelper({
	getEscalationGameInitCode: (securityPool, repToken, proofVerifier) =>
		encodeDeployData({
			abi: peripherals_EscalationGame_EscalationGame.abi,
			bytecode: `0x${peripherals_EscalationGame_EscalationGame.evm.bytecode.object}`,
			args: [securityPool, repToken, proofVerifier],
		}),
	getInfraContracts: () => getInfraContractAddresses(),
	getPriceOracleManagerAndOperatorQueuerInitCode: (openOracle, repToken) =>
		concatHex([
			`0x${peripherals_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.evm.bytecode.object}`,
			encodeAbiParameters(
				[
					{ type: 'address' },
					{ type: 'address' },
					{ type: 'address' },
					{ type: 'uint256' },
					{ type: 'uint32' },
					{ type: 'uint256' },
					{ type: 'uint48' },
					{ type: 'uint24' },
					{ type: 'uint24' },
					{ type: 'uint24' },
					{ type: 'uint16' },
					{ type: 'bool' },
					{ type: 'bool' },
					{ type: 'address' },
					{ type: 'uint256' },
					{ type: 'uint256' },
					{ type: 'uint256' },
				],
				[
					openOracle,
					repToken,
					MAINNET_WETH_ADDRESS,
					ORACLE_REPORT_GAS,
					ORACLE_SETTLEMENT_GAS,
					ORACLE_EXACT_TOKEN1_REPORT,
					ORACLE_SETTLEMENT_TIME,
					ORACLE_DISPUTE_DELAY,
					ORACLE_PROTOCOL_FEE,
					ORACLE_FEE_PERCENTAGE,
					ORACLE_MULTIPLIER,
					ORACLE_TIME_TYPE,
					ORACLE_TRACK_DISPUTES,
					ORACLE_PROTOCOL_FEE_RECIPIENT,
					ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
					ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
					ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
				],
			),
		]),
	getRepTokenAddress,
	getSecurityPoolInitCode: ({ escalationGameFactory, openOracle, parent, priceOracleManagerAndOperatorQueuer, questionId, securityMultiplier, securityPoolFactory, securityPoolForker, shareToken, truthAuction, universeId, zoltar, zoltarQuestionData }) =>
		(() => {
			return encodeDeployData({
				abi: peripherals_SecurityPool_SecurityPool.abi,
				bytecode: applyLibraries(peripherals_SecurityPool_SecurityPool.evm.bytecode.object),
				args: [securityPoolForker, securityPoolFactory, zoltarQuestionData, escalationGameFactory, priceOracleManagerAndOperatorQueuer, shareToken, openOracle, parent, zoltar, universeId, questionId, securityMultiplier, DEFAULT_PROTOCOL_CONFIG.initialEscalationGameDeposit, truthAuction],
			})
		})(),
	getShareTokenInitCode: (securityPoolFactory, zoltarAddress, questionId) =>
		encodeDeployData({
			abi: peripherals_tokens_ShareToken_ShareToken.abi,
			bytecode: `0x${peripherals_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
			args: [securityPoolFactory, zoltarAddress, questionId],
		}),
	getTruthAuctionInitCode: securityPoolForker =>
		encodeDeployData({
			abi: peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			bytecode: `0x${peripherals_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.evm.bytecode.object}`,
			args: [securityPoolForker],
		}),
})

export async function loadDeploymentStatusOracleMask(client: Pick<WriteClient, 'readContract'>): Promise<bigint> {
	return BigInt(
		await client.readContract({
			abi: DeploymentStatusOracle_DeploymentStatusOracle.abi,
			functionName: 'getDeploymentMask',
			address: getDeploymentStatusOracleAddress(),
			args: [],
		}),
	)
}

export async function ensureDeploymentStatusOracleDeployed(client: WriteClient): Promise<void> {
	const deploymentStatusOracleAddress = getDeploymentStatusOracleAddress()
	if (await contractExists(client, deploymentStatusOracleAddress)) return
	const hash = await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: getDeploymentStatusOracleByteCode() })
	await client.waitForTransactionReceipt({ hash })
}

function getDeploymentStatusOracleSteps() {
	const infraContracts = getInfraContractAddresses()
	return [
		{ id: 'proxyDeployer', address: addressString(PROXY_DEPLOYER_ADDRESS) },
		{ id: 'multicall3', address: infraContracts.multicall3 },
		{ id: 'uniformPriceDualCapBatchAuctionFactory', address: infraContracts.uniformPriceDualCapBatchAuctionFactory },
		{ id: 'scalarOutcomes', address: infraContracts.scalarOutcomes },
		{ id: 'securityPoolUtils', address: infraContracts.securityPoolUtils },
		{ id: 'openOracle', address: infraContracts.openOracle },
		{ id: 'zoltarQuestionData', address: infraContracts.zoltarQuestionData },
		{ id: 'zoltar', address: infraContracts.zoltar },
		{ id: 'shareTokenFactory', address: infraContracts.shareTokenFactory },
		{ id: 'priceOracleManagerAndOperatorQueuerFactory', address: infraContracts.priceOracleManagerAndOperatorQueuerFactory },
		{ id: 'securityPoolForker', address: infraContracts.securityPoolForker },
		{ id: 'escalationGameFactory', address: infraContracts.escalationGameFactory },
		{ id: 'securityPoolFactory', address: infraContracts.securityPoolFactory },
	] as const
}

type DeploymentStatusOracleStepId = ReturnType<typeof getDeploymentStatusOracleSteps>[number]['id']

function isDeploymentStatusOracleStepDeployed(deploymentMask: bigint, stepId: DeploymentStatusOracleStepId) {
	const bitIndex = getDeploymentStatusOracleSteps().findIndex(step => step.id === stepId)
	if (bitIndex === -1) throw new Error(`Unknown deployment status oracle step: ${stepId}`)
	return (deploymentMask & (1n << BigInt(bitIndex))) !== 0n
}

async function getInfraDeployedInformation(client: WriteClient): Promise<{ [key in keyof ReturnType<typeof getInfraContractAddresses>]: boolean }> {
	const deploymentMask = await loadDeploymentStatusOracleMask(client)
	return {
		multicall3: isDeploymentStatusOracleStepDeployed(deploymentMask, 'multicall3'),
		securityPoolUtils: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolUtils'),
		openOracle: isDeploymentStatusOracleStepDeployed(deploymentMask, 'openOracle'),
		zoltar: isDeploymentStatusOracleStepDeployed(deploymentMask, 'zoltar'),
		shareTokenFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'shareTokenFactory'),
		priceOracleManagerAndOperatorQueuerFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'priceOracleManagerAndOperatorQueuerFactory'),
		securityPoolForker: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolForker'),
		escalationGameFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'escalationGameFactory'),
		escalationGameProofVerifier: isDeploymentStatusOracleStepDeployed(deploymentMask, 'escalationGameFactory'),
		zoltarQuestionData: isDeploymentStatusOracleStepDeployed(deploymentMask, 'zoltarQuestionData'),
		scalarOutcomes: isDeploymentStatusOracleStepDeployed(deploymentMask, 'scalarOutcomes'),
		uniformPriceDualCapBatchAuctionFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'uniformPriceDualCapBatchAuctionFactory'),
		securityPoolFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolFactory'),
	}
}
export async function ensureInfraDeployed(client: WriteClient): Promise<void> {
	const contractAddresses = getInfraContractAddresses()

	const deployBytecode = async (label: string, bytecode: Hex) => {
		const hash = await client.sendTransaction({ to: addressString(PROXY_DEPLOYER_ADDRESS), data: bytecode })
		const receipt = await client.waitForTransactionReceipt({ hash })
		if (receipt.status === 'reverted') throw new Error(`infra deploy reverted while creating ${label}: ${hash}`)
	}

	await ensureDeploymentStatusOracleDeployed(client)
	const existence = await getInfraDeployedInformation(client)

	if (!existence['multicall3']) await deployBytecode('multicall3', MULTICALL3_BYTECODE)
	if (!existence['uniformPriceDualCapBatchAuctionFactory']) await deployBytecode('uniformPriceDualCapBatchAuctionFactory', `0x${peripherals_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object}`)
	if (!existence['scalarOutcomes']) await deployBytecode('scalarOutcomes', `0x${ScalarOutcomes_ScalarOutcomes.evm.bytecode.object}`)
	if (!existence['securityPoolUtils']) await deployBytecode('securityPoolUtils', `0x${peripherals_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`)
	if (!existence['openOracle']) await deployBytecode('openOracle', `0x${peripherals_openOracle_OpenOracle_OpenOracle.evm.bytecode.object}`)
	if (!existence['zoltarQuestionData']) await deployBytecode('zoltarQuestionData', getZoltarQuestionDataByteCode())
	if (!existence['zoltar']) {
		const initCode = encodeDeployData({
			abi: Zoltar_Zoltar.abi,
			bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
			args: [contractAddresses.zoltarQuestionData, DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor, DEFAULT_PROTOCOL_CONFIG.forkBurnDivisor],
		})
		await deployBytecode('zoltar', initCode)
	}
	if (!existence['shareTokenFactory']) await deployBytecode('shareTokenFactory', getShareTokenFactoryByteCode(getZoltarAddress()))
	if (!existence['priceOracleManagerAndOperatorQueuerFactory']) await deployBytecode('priceOracleManagerAndOperatorQueuerFactory', getPriceOracleManagerAndOperatorQueuerFactoryByteCode())
	if (!existence['securityPoolForker']) await deployBytecode('securityPoolForker', getSecurityPoolForkerByteCode(contractAddresses.zoltar))
	if (!existence['escalationGameFactory']) await deployBytecode('escalationGameFactory', getEscalationGameFactoryByteCode())
	if (!existence['securityPoolFactory'])
		await deployBytecode(
			'securityPoolFactory',
			getSecurityPoolFactoryByteCode({
				escalationGameFactory: contractAddresses.escalationGameFactory,
				openOracle: contractAddresses.openOracle,
				priceOracleManagerAndOperatorQueuerFactory: contractAddresses.priceOracleManagerAndOperatorQueuerFactory,
				securityPoolForker: contractAddresses.securityPoolForker,
				shareTokenFactory: contractAddresses.shareTokenFactory,
				uniformPriceDualCapBatchAuctionFactory: contractAddresses.uniformPriceDualCapBatchAuctionFactory,
				zoltar: contractAddresses.zoltar,
				zoltarQuestionData: contractAddresses.zoltarQuestionData,
			}),
		)

	for (const [name, contractAddress] of objectEntries(contractAddresses)) {
		if (!(await contractExists(client, contractAddress))) throw new Error(`${name} does not exist even though we deployed it`)
	}
	if (!(await contractExists(client, getDeploymentStatusOracleAddress()))) throw new Error('deploymentStatusOracle does not exist even though we deployed it')
}

export const deployOriginSecurityPool = async (client: WriteClient, universeId: bigint, questionId: bigint, securityMultiplier: bigint) => {
	const infraAddresses = getInfraContractAddresses()
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: peripherals_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'deployOriginSecurityPool',
			address: infraAddresses.securityPoolFactory,
			args: [universeId, questionId, securityMultiplier],
		}),
	)
}

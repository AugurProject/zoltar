import { concatHex, encodeDeployData, type Address, type Hex, toHex } from '@zoltar/core-shared/evm/ethereum'
import { createSecurityPoolAddressHelper } from '../../../evm/securityPoolAddressDerivation'
import { createDeploymentStatusOracleAddressHelper } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { createStatoblastInitCodes, encodeOpenOraclePriceCoordinatorArguments } from '@zoltar/statoblast-shared/deployment/initCodes'
import { createZoltarAddressHelpers } from '@zoltar/zoltar-shared/deployment/deploymentAddresses'
import { DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS } from '@zoltar/statoblast-shared/initialReport/oracleInitialReport'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/core-shared/deployment/protocolConfig'
import { WriteClient, writeContractAndWait } from '../clients'
import { GENESIS_REPUTATION_TOKEN, PROXY_DEPLOYER_ADDRESS } from '../constants'
import { addressString } from '../bigint'
import { contractExists } from '../utilities'
import {
	DeploymentStatusOracle_DeploymentStatusOracle,
	statoblast_EscalationGame_EscalationGame,
	statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate,
	statoblast_Multicall3_Multicall3,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	statoblast_factories_EscalationGameFactory_EscalationGameFactory,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_OpenOraclePriceCoordinatorFactory,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_factories_ShareTokenFactory_ShareTokenFactory,
	statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	statoblast_openOracle_OpenOracle_OpenOracle,
	statoblast_SecurityPool_SecurityPool,
	statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate,
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_SecurityPoolUtils_SecurityPoolUtils,
	statoblast_tokens_ShareToken_ShareToken,
	Zoltar_Zoltar,
	ZoltarQuestionData_ZoltarQuestionData,
	statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction,
} from '../../../../types/contractArtifact'
import { objectEntries } from '../typescript'
import { getRepTokenAddress } from './zoltar'

const ZERO_SALT: Hex = toHex(0, { size: 32 })
const MULTICALL3_BYTECODE = `0x${statoblast_Multicall3_Multicall3.evm.bytecode.object}` satisfies Hex
const MAINNET_WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' satisfies Address

const statoblastInitCodes = createStatoblastInitCodes(
	{
		escalationGameClaimDelegate: statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate,
		escalationGameFactory: statoblast_factories_EscalationGameFactory_EscalationGameFactory,
		multicall3: statoblast_Multicall3_Multicall3,
		openOracle: statoblast_openOracle_OpenOracle_OpenOracle,
		openOraclePriceCoordinatorFactory: statoblast_factories_OpenOraclePriceCoordinatorFactory_OpenOraclePriceCoordinatorFactory,
		securityPoolFactory: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
		securityPoolForker: statoblast_SecurityPoolForker_SecurityPoolForker,
		securityPoolOperationsDelegate: statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate,
		securityPoolUtils: statoblast_SecurityPoolUtils_SecurityPoolUtils,
		shareTokenFactory: statoblast_factories_ShareTokenFactory_ShareTokenFactory,
		uniformPriceDualCapBatchAuctionFactory: statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	},
	{ proxyDeployerAddress: addressString(PROXY_DEPLOYER_ADDRESS), zeroSalt: ZERO_SALT },
)

export const { applyLibraries } = statoblastInitCodes
const { getEscalationGameFactoryByteCode, getOpenOraclePriceCoordinatorFactoryByteCode, getSecurityPoolFactoryByteCode, getSecurityPoolForkerByteCode, getSecurityPoolOperationsDelegateByteCode, getShareTokenFactoryByteCode } = statoblastInitCodes

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

const getZoltarInitCode = (zoltarQuestionDataAddress: Address): Hex =>
	(() => {
		return encodeDeployData({
			abi: Zoltar_Zoltar.abi,
			bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
			args: [zoltarQuestionDataAddress, addressString(GENESIS_REPUTATION_TOKEN), DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor, DEFAULT_PROTOCOL_CONFIG.forkBurnDivisor],
		})
	})()

const getZoltarQuestionDataByteCode = (): Hex =>
	encodeDeployData({
		abi: ZoltarQuestionData_ZoltarQuestionData.abi,
		bytecode: `0x${ZoltarQuestionData_ZoltarQuestionData.evm.bytecode.object}`,
	})

const { getZoltarAddress, getZoltarQuestionDataAddress } = createZoltarAddressHelpers({
	getZoltarInitCode,
	proxyDeployerAddress: addressString(PROXY_DEPLOYER_ADDRESS),
	zeroSalt: ZERO_SALT,
	zoltarQuestionDataBytecode: getZoltarQuestionDataByteCode,
})

export const getInfraContractAddresses = statoblastInitCodes.createInfraContractAddresses(MAINNET_WETH_ADDRESS, { getZoltarAddress, getZoltarQuestionDataAddress })

export const { getDeploymentStatusOracleAddress } = createDeploymentStatusOracleAddressHelper({
	deploymentStatusOracleBytecode: getDeploymentStatusOracleByteCode,
	proxyDeployerAddress: addressString(PROXY_DEPLOYER_ADDRESS),
	zeroSalt: ZERO_SALT,
})

export const { getSecurityPoolAddresses } = createSecurityPoolAddressHelper({
	getEscalationGameInitCode: (securityPool, repToken, proofVerifier) =>
		encodeDeployData({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			bytecode: `0x${statoblast_EscalationGame_EscalationGame.evm.bytecode.object}`,
			args: [securityPool, repToken, proofVerifier, getInfraContractAddresses().escalationGameClaimDelegate],
		}),
	getInfraContracts: () => getInfraContractAddresses(),
	getOpenOraclePriceCoordinatorInitCode: (openOracle, repToken, initialReportPriorityFeeAttoEthPerGas) =>
		concatHex([applyLibraries(statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.evm.bytecode.object), encodeOpenOraclePriceCoordinatorArguments({ initialReportPriorityFeeAttoEthPerGas, openOracle, repToken, weth: MAINNET_WETH_ADDRESS })]),
	getRepTokenAddress,
	getSecurityPoolInitCode: ({ escalationGameFactory, openOracle, parent, openOraclePriceCoordinator, questionId, statoblastSecurityMultiplierBps, securityPoolForker, shareToken, truthAuction, universeId, zoltar, zoltarQuestionData }) =>
		(() => {
			return encodeDeployData({
				abi: statoblast_SecurityPool_SecurityPool.abi,
				bytecode: applyLibraries(statoblast_SecurityPool_SecurityPool.evm.bytecode.object),
				args: [securityPoolForker, zoltarQuestionData, escalationGameFactory, openOraclePriceCoordinator, shareToken, openOracle, parent, zoltar, universeId, questionId, statoblastSecurityMultiplierBps, truthAuction],
			})
		})(),
	getShareTokenInitCode: (securityPoolFactory, zoltarAddress, questionId) =>
		encodeDeployData({
			abi: statoblast_tokens_ShareToken_ShareToken.abi,
			bytecode: `0x${statoblast_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
			args: [securityPoolFactory, zoltarAddress, questionId],
		}),
	getTruthAuctionInitCode: securityPoolForker =>
		encodeDeployData({
			abi: statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.abi,
			bytecode: `0x${statoblast_UniformPriceDualCapBatchAuction_UniformPriceDualCapBatchAuction.evm.bytecode.object}`,
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
		{ id: 'securityPoolUtils', address: infraContracts.securityPoolUtils },
		{ id: 'securityPoolOperationsDelegate', address: infraContracts.securityPoolOperationsDelegate },
		{ id: 'openOracle', address: infraContracts.openOracle },
		{ id: 'zoltarQuestionData', address: infraContracts.zoltarQuestionData },
		{ id: 'zoltar', address: infraContracts.zoltar },
		{ id: 'shareTokenFactory', address: infraContracts.shareTokenFactory },
		{ id: 'openOraclePriceCoordinatorFactory', address: infraContracts.openOraclePriceCoordinatorFactory },
		{ id: 'securityPoolForker', address: infraContracts.securityPoolForker },
		{ id: 'escalationGameClaimDelegate', address: infraContracts.escalationGameClaimDelegate },
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
		securityPoolOperationsDelegate: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolOperationsDelegate'),
		openOracle: isDeploymentStatusOracleStepDeployed(deploymentMask, 'openOracle'),
		zoltar: isDeploymentStatusOracleStepDeployed(deploymentMask, 'zoltar'),
		shareTokenFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'shareTokenFactory'),
		openOraclePriceCoordinatorFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'openOraclePriceCoordinatorFactory'),
		securityPoolForker: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolForker'),
		escalationGameClaimDelegate: isDeploymentStatusOracleStepDeployed(deploymentMask, 'escalationGameClaimDelegate'),
		escalationGameFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'escalationGameFactory'),
		escalationGameProofVerifier: isDeploymentStatusOracleStepDeployed(deploymentMask, 'escalationGameFactory'),
		zoltarQuestionData: isDeploymentStatusOracleStepDeployed(deploymentMask, 'zoltarQuestionData'),
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
	if (!existence['uniformPriceDualCapBatchAuctionFactory']) await deployBytecode('uniformPriceDualCapBatchAuctionFactory', `0x${statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object}`)
	if (!existence['securityPoolUtils']) await deployBytecode('securityPoolUtils', `0x${statoblast_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`)
	if (!existence['securityPoolOperationsDelegate']) await deployBytecode('securityPoolOperationsDelegate', getSecurityPoolOperationsDelegateByteCode())
	if (!existence['openOracle']) await deployBytecode('openOracle', `0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.bytecode.object}`)
	if (!existence['zoltarQuestionData']) await deployBytecode('zoltarQuestionData', getZoltarQuestionDataByteCode())
	if (!existence['zoltar']) {
		const initCode = encodeDeployData({
			abi: Zoltar_Zoltar.abi,
			bytecode: `0x${Zoltar_Zoltar.evm.bytecode.object}`,
			args: [contractAddresses.zoltarQuestionData, addressString(GENESIS_REPUTATION_TOKEN), DEFAULT_PROTOCOL_CONFIG.forkThresholdDivisor, DEFAULT_PROTOCOL_CONFIG.forkBurnDivisor],
		})
		await deployBytecode('zoltar', initCode)
	}
	if (!existence['shareTokenFactory']) await deployBytecode('shareTokenFactory', getShareTokenFactoryByteCode(getZoltarAddress()))
	if (!existence['openOraclePriceCoordinatorFactory']) await deployBytecode('openOraclePriceCoordinatorFactory', getOpenOraclePriceCoordinatorFactoryByteCode(MAINNET_WETH_ADDRESS))
	if (!existence['securityPoolForker']) await deployBytecode('securityPoolForker', getSecurityPoolForkerByteCode(contractAddresses.zoltar))
	if (!existence['escalationGameClaimDelegate']) await deployBytecode('escalationGameClaimDelegate', `0x${statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.evm.bytecode.object}`)
	if (!existence['escalationGameFactory']) await deployBytecode('escalationGameFactory', getEscalationGameFactoryByteCode(contractAddresses.escalationGameClaimDelegate))
	if (!existence['securityPoolFactory']) await deployBytecode('securityPoolFactory', getSecurityPoolFactoryByteCode(contractAddresses))

	for (const [name, contractAddress] of objectEntries(contractAddresses)) {
		if (!(await contractExists(client, contractAddress))) throw new Error(`${name} does not exist even though we deployed it`)
	}
	if (!(await contractExists(client, getDeploymentStatusOracleAddress()))) throw new Error('deploymentStatusOracle does not exist even though we deployed it')
}

export const deployOriginSecurityPool = async (client: WriteClient, universeId: bigint, questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas = DEFAULT_ORACLE_INITIAL_REPORT_PRIORITY_FEE_ATTO_ETH_PER_GAS) => {
	const infraAddresses = getInfraContractAddresses()
	return await writeContractAndWait(client, () =>
		client.writeContract({
			abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'deployOriginSecurityPool',
			address: infraAddresses.securityPoolFactory,
			args: [universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas],
		}),
	)
}

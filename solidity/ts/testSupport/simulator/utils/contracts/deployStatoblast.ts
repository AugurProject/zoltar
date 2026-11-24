import { concatHex, encodeDeployData, getCreateAddress, type Address, type Hex, toHex } from '@zoltar/core-shared/evm/ethereum'
import { createQuestionLedgerAddressHelper } from '../../../evm/questionLedgerAddressDerivation'
import { createDeploymentStatusOracleAddressHelper } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { createStatoblastInitCodes, encodeOpenOraclePriceCoordinatorArguments } from '@zoltar/statoblast-shared/deployment/initCodes'
import { createZoltarAddressHelpers } from '@zoltar/zoltar-shared/deployment/deploymentAddresses'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/core-shared/deployment/protocolConfig'
import type { WriteClient } from '../clients'
import { GENESIS_REPUTATION_TOKEN, PROXY_DEPLOYER_ADDRESS } from '../constants'
import { addressString } from '../bigint'
import { contractExists } from '../utilities'
import {
	DeploymentStatusOracle_DeploymentStatusOracle,
	statoblast_EscalationGame_EscalationGame,
	statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate,
	statoblast_Multicall3_Multicall3,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	statoblast_factories_EscalationGameFactory_EscalationGameFactory,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_OpenOraclePriceCoordinatorFactory,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_PriceCoordinatorDeploymentWorker,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_SharedPoolPriceFeedDeploymentWorker,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_factories_ShareTokenFactory_ShareTokenFactory,
	statoblast_openOracle_OpenOracle_OpenOracle,
	statoblast_QuestionLedger_QuestionLedger,
	statoblast_QuestionLedgerOperationsDelegate_QuestionLedgerOperationsDelegate,
	statoblast_QuestionLedgerEventEmitter_QuestionLedgerEventEmitter,
	statoblast_SecurityPool_SecurityPool,
	statoblast_QuestionForker_QuestionForker,
	statoblast_QuestionForkerDelegate_QuestionForkerDelegate,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalLedgerDeployer,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolCommitmentIndexDeployer,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementBookDeployer,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementDeployer,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolServicesDeployer,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolReporterLedgerDeployer,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinatorDeployer,
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuctionDeployer,
	statoblast_tokens_ShareToken_ShareToken,
	Zoltar_Zoltar,
	ZoltarQuestionData_ZoltarQuestionData,
} from '../../../../types/contractArtifact'
import { objectEntries } from '../typescript'
import { getRepTokenAddress } from './zoltar'

const ZERO_SALT: Hex = toHex(0, { size: 32 })
const MULTICALL3_BYTECODE = `0x${statoblast_Multicall3_Multicall3.evm.bytecode.object}` satisfies Hex
const MAINNET_WETH_ADDRESS = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' satisfies Address

const statoblastInitCodes = createStatoblastInitCodes(
	{
		escalationGameDepositDelegate: statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate,
		escalationGameFactory: statoblast_factories_EscalationGameFactory_EscalationGameFactory,
		multicall3: statoblast_Multicall3_Multicall3,
		openOracle: statoblast_openOracle_OpenOracle_OpenOracle,
		openOraclePriceCoordinatorFactory: statoblast_factories_OpenOraclePriceCoordinatorFactory_OpenOraclePriceCoordinatorFactory,
		priceCoordinatorDeploymentWorker: statoblast_factories_OpenOraclePriceCoordinatorFactory_PriceCoordinatorDeploymentWorker,
		sharedPoolPriceFeedDeploymentWorker: statoblast_factories_OpenOraclePriceCoordinatorFactory_SharedPoolPriceFeedDeploymentWorker,
		securityPoolFactory: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
		securityPool: statoblast_SecurityPool_SecurityPool,
		questionForker: statoblast_QuestionForker_QuestionForker,
		questionForkerDelegate: statoblast_QuestionForkerDelegate_QuestionForkerDelegate,
		questionLedgerOperationsDelegate: statoblast_QuestionLedgerOperationsDelegate_QuestionLedgerOperationsDelegate,
		questionLedgerEventEmitter: statoblast_QuestionLedgerEventEmitter_QuestionLedgerEventEmitter,
		securityPoolCapitalLedgerDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalLedgerDeployer,
		securityPoolCommitmentIndexDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolCommitmentIndexDeployer,
		securityPoolCapitalFeeStreamsDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer,
		securityPoolSettlementBookDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementBookDeployer,
		securityPoolSettlementDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementDeployer,
		securityPoolServicesDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolServicesDeployer,
		securityPoolReporterLedgerDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolReporterLedgerDeployer,
		securityPoolForkCoordinatorDeployer: statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinatorDeployer,
		securityPoolRepairAuctionDeployer: statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuctionDeployer,
		shareTokenFactory: statoblast_factories_ShareTokenFactory_ShareTokenFactory,
	},
	{ proxyDeployerAddress: addressString(PROXY_DEPLOYER_ADDRESS), zeroSalt: ZERO_SALT },
)

const {
	getEscalationGameFactoryByteCode,
	getOpenOraclePriceCoordinatorFactoryByteCode,
	getPriceCoordinatorDeploymentWorkerByteCode,
	getSharedPoolPriceFeedDeploymentWorkerByteCode,
	getSecurityPoolFactoryByteCode,
	getQuestionForkerByteCode,
	getQuestionForkerDelegateByteCode,
	getQuestionLedgerOperationsDelegateByteCode,
	getQuestionLedgerEventEmitterByteCode,
	getSecurityPoolCapitalLedgerDeployerByteCode,
	getSecurityPoolCommitmentIndexDeployerByteCode,
	getSecurityPoolCapitalFeeStreamsDeployerByteCode,
	getSecurityPoolSettlementBookDeployerByteCode,
	getSecurityPoolSettlementDeployerByteCode,
	getSecurityPoolServicesDeployerByteCode,
	getSecurityPoolReporterLedgerDeployerByteCode,
	getSecurityPoolForkCoordinatorDeployerByteCode,
	getSecurityPoolRepairAuctionDeployerByteCode,
	getShareTokenFactoryByteCode,
} = statoblastInitCodes

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

const { getDeploymentStatusOracleAddress } = createDeploymentStatusOracleAddressHelper({
	deploymentStatusOracleBytecode: getDeploymentStatusOracleByteCode,
	proxyDeployerAddress: addressString(PROXY_DEPLOYER_ADDRESS),
	zeroSalt: ZERO_SALT,
})

export const { getQuestionLedgerAddresses } = createQuestionLedgerAddressHelper({
	getEscalationGameInitCode: (questionLedger, repToken, proofVerifier) =>
		encodeDeployData({
			abi: statoblast_EscalationGame_EscalationGame.abi,
			bytecode: `0x${statoblast_EscalationGame_EscalationGame.evm.bytecode.object}`,
			args: [questionLedger, repToken, proofVerifier, getInfraContractAddresses().escalationGameDepositDelegate],
		}),
	getInfraContracts: () => getInfraContractAddresses(),
	getOpenOraclePriceCoordinatorInitCode: (openOracle, repToken, initialReportPriorityFeeAttoEthPerGas) =>
		concatHex([
			`0x${statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.evm.bytecode.object}`,
			encodeOpenOraclePriceCoordinatorArguments({ initialReportPriorityFeeAttoEthPerGas, openOracle, repToken, weth: MAINNET_WETH_ADDRESS, reportDelegate: getCreateAddress({ from: getInfraContractAddresses().priceCoordinatorDeploymentWorker, nonce: 3n }) }),
		]),
	getRepTokenAddress,
	getQuestionLedgerInitCode: ({ escalationGameFactory, openOracle, parent, openOraclePriceCoordinator, questionId, statoblastSecurityMultiplierBps, questionForker, shareToken, universeId, zoltar, zoltarQuestionData }) =>
		(() => {
			return encodeDeployData({
				abi: statoblast_QuestionLedger_QuestionLedger.abi,
				bytecode: `0x${statoblast_QuestionLedger_QuestionLedger.evm.bytecode.object}`,
				args: [questionForker, zoltarQuestionData, escalationGameFactory, openOraclePriceCoordinator, shareToken, openOracle, parent, zoltar, universeId, questionId, statoblastSecurityMultiplierBps],
			})
		})(),
	getShareTokenInitCode: (securityPoolFactory, zoltarAddress, questionId) =>
		encodeDeployData({
			abi: statoblast_tokens_ShareToken_ShareToken.abi,
			bytecode: `0x${statoblast_tokens_ShareToken_ShareToken.evm.bytecode.object}`,
			args: [securityPoolFactory, zoltarAddress, questionId],
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
		{ id: 'zoltarQuestionData', address: infraContracts.zoltarQuestionData },
		{ id: 'zoltar', address: infraContracts.zoltar },
		{ id: 'questionLedgerOperationsDelegate', address: infraContracts.questionLedgerOperationsDelegate },
		{ id: 'questionLedgerEventEmitter', address: infraContracts.questionLedgerEventEmitter },
		{ id: 'openOracle', address: infraContracts.openOracle },
		{ id: 'shareTokenFactory', address: infraContracts.shareTokenFactory },
		{ id: 'priceCoordinatorDeploymentWorker', address: infraContracts.priceCoordinatorDeploymentWorker },
		{ id: 'sharedPoolPriceFeedDeploymentWorker', address: infraContracts.sharedPoolPriceFeedDeploymentWorker },
		{ id: 'openOraclePriceCoordinatorFactory', address: infraContracts.openOraclePriceCoordinatorFactory },
		{ id: 'questionForkerDelegate', address: infraContracts.questionForkerDelegate },
		{ id: 'questionForker', address: infraContracts.questionForker },
		{ id: 'escalationGameDepositDelegate', address: infraContracts.escalationGameDepositDelegate },
		{ id: 'escalationGameFactory', address: infraContracts.escalationGameFactory },
		{ id: 'securityPoolFactory', address: infraContracts.securityPoolFactory },
		{ id: 'securityPoolCapitalLedgerDeployer', address: infraContracts.securityPoolCapitalLedgerDeployer },
		{ id: 'securityPoolCommitmentIndexDeployer', address: infraContracts.securityPoolCommitmentIndexDeployer },
		{ id: 'securityPoolCapitalFeeStreamsDeployer', address: infraContracts.securityPoolCapitalFeeStreamsDeployer },
		{ id: 'securityPoolSettlementBookDeployer', address: infraContracts.securityPoolSettlementBookDeployer },
		{ id: 'securityPoolSettlementDeployer', address: infraContracts.securityPoolSettlementDeployer },
		{ id: 'securityPoolServicesDeployer', address: infraContracts.securityPoolServicesDeployer },
		{ id: 'securityPoolReporterLedgerDeployer', address: infraContracts.securityPoolReporterLedgerDeployer },
		{ id: 'securityPoolForkCoordinatorDeployer', address: infraContracts.securityPoolForkCoordinatorDeployer },
		{ id: 'securityPoolRepairAuctionDeployer', address: infraContracts.securityPoolRepairAuctionDeployer },
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
		questionLedgerOperationsDelegate: isDeploymentStatusOracleStepDeployed(deploymentMask, 'questionLedgerOperationsDelegate'),
		questionLedgerEventEmitter: isDeploymentStatusOracleStepDeployed(deploymentMask, 'questionLedgerEventEmitter'),
		openOracle: isDeploymentStatusOracleStepDeployed(deploymentMask, 'openOracle'),
		zoltar: isDeploymentStatusOracleStepDeployed(deploymentMask, 'zoltar'),
		shareTokenFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'shareTokenFactory'),
		priceCoordinatorDeploymentWorker: isDeploymentStatusOracleStepDeployed(deploymentMask, 'priceCoordinatorDeploymentWorker'),
		sharedPoolPriceFeedDeploymentWorker: isDeploymentStatusOracleStepDeployed(deploymentMask, 'sharedPoolPriceFeedDeploymentWorker'),
		openOraclePriceCoordinatorFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'openOraclePriceCoordinatorFactory'),
		questionForkerDelegate: isDeploymentStatusOracleStepDeployed(deploymentMask, 'questionForkerDelegate'),
		questionForker: isDeploymentStatusOracleStepDeployed(deploymentMask, 'questionForker'),
		escalationGameFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'escalationGameFactory'),
		escalationGameProofVerifier: isDeploymentStatusOracleStepDeployed(deploymentMask, 'escalationGameFactory'),
		escalationGameDepositDelegate: isDeploymentStatusOracleStepDeployed(deploymentMask, 'escalationGameDepositDelegate'),
		zoltarQuestionData: isDeploymentStatusOracleStepDeployed(deploymentMask, 'zoltarQuestionData'),
		securityPoolFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolFactory'),
		securityPoolCapitalLedgerDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolCapitalLedgerDeployer'),
		securityPoolCommitmentIndexDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolCommitmentIndexDeployer'),
		securityPoolCapitalFeeStreamsDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolCapitalFeeStreamsDeployer'),
		securityPoolSettlementBookDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolSettlementBookDeployer'),
		securityPoolSettlementDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolSettlementDeployer'),
		securityPoolServicesDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolServicesDeployer'),
		securityPoolReporterLedgerDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolReporterLedgerDeployer'),
		securityPoolForkCoordinatorDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolForkCoordinatorDeployer'),
		securityPoolRepairAuctionDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolRepairAuctionDeployer'),
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
	if (!existence['questionLedgerOperationsDelegate']) await deployBytecode('questionLedgerOperationsDelegate', getQuestionLedgerOperationsDelegateByteCode())
	if (!existence['questionLedgerEventEmitter']) await deployBytecode('questionLedgerEventEmitter', getQuestionLedgerEventEmitterByteCode())
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
	if (!existence['priceCoordinatorDeploymentWorker']) await deployBytecode('priceCoordinatorDeploymentWorker', getPriceCoordinatorDeploymentWorkerByteCode())
	if (!existence['sharedPoolPriceFeedDeploymentWorker']) await deployBytecode('sharedPoolPriceFeedDeploymentWorker', getSharedPoolPriceFeedDeploymentWorkerByteCode())
	if (!existence['openOraclePriceCoordinatorFactory']) await deployBytecode('openOraclePriceCoordinatorFactory', getOpenOraclePriceCoordinatorFactoryByteCode(MAINNET_WETH_ADDRESS))
	if (!existence['questionForkerDelegate']) await deployBytecode('questionForkerDelegate', getQuestionForkerDelegateByteCode(contractAddresses.zoltar))
	if (!existence['questionForker']) await deployBytecode('questionForker', getQuestionForkerByteCode(contractAddresses.zoltar))
	if (!existence['escalationGameDepositDelegate']) await deployBytecode('escalationGameDepositDelegate', `0x${statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.evm.bytecode.object}`)
	if (!existence['escalationGameFactory']) await deployBytecode('escalationGameFactory', getEscalationGameFactoryByteCode(contractAddresses.escalationGameDepositDelegate))
	if (!existence['securityPoolFactory']) await deployBytecode('securityPoolFactory', getSecurityPoolFactoryByteCode(contractAddresses))
	if (!existence['securityPoolCapitalLedgerDeployer']) await deployBytecode('securityPoolCapitalLedgerDeployer', getSecurityPoolCapitalLedgerDeployerByteCode())
	if (!existence['securityPoolCommitmentIndexDeployer']) await deployBytecode('securityPoolCommitmentIndexDeployer', getSecurityPoolCommitmentIndexDeployerByteCode())
	if (!existence['securityPoolCapitalFeeStreamsDeployer']) await deployBytecode('securityPoolCapitalFeeStreamsDeployer', getSecurityPoolCapitalFeeStreamsDeployerByteCode())
	if (!existence['securityPoolSettlementBookDeployer']) await deployBytecode('securityPoolSettlementBookDeployer', getSecurityPoolSettlementBookDeployerByteCode())
	if (!existence['securityPoolSettlementDeployer']) await deployBytecode('securityPoolSettlementDeployer', getSecurityPoolSettlementDeployerByteCode())
	if (!existence['securityPoolServicesDeployer']) await deployBytecode('securityPoolServicesDeployer', getSecurityPoolServicesDeployerByteCode())
	if (!existence['securityPoolReporterLedgerDeployer']) await deployBytecode('securityPoolReporterLedgerDeployer', getSecurityPoolReporterLedgerDeployerByteCode())
	if (!existence['securityPoolForkCoordinatorDeployer']) await deployBytecode('securityPoolForkCoordinatorDeployer', getSecurityPoolForkCoordinatorDeployerByteCode())
	if (!existence['securityPoolRepairAuctionDeployer']) await deployBytecode('securityPoolRepairAuctionDeployer', getSecurityPoolRepairAuctionDeployerByteCode())

	for (const [name, contractAddress] of objectEntries(contractAddresses)) {
		if (!(await contractExists(client, contractAddress))) throw new Error(`${name} does not exist even though we deployed it`)
	}
	if (!(await contractExists(client, getDeploymentStatusOracleAddress()))) throw new Error('deploymentStatusOracle does not exist even though we deployed it')
}

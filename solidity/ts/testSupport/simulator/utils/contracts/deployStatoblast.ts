import { concatHex, encodeDeployData, getCreateAddress, type Address, type Hex, toHex } from '@zoltar/core-shared/evm/ethereum'
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
	statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate,
	statoblast_Multicall3_Multicall3,
	statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator,
	statoblast_factories_EscalationGameFactory_EscalationGameFactory,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_OpenOraclePriceCoordinatorFactory,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_PriceCoordinatorDeploymentWorker,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_SharedPoolPriceFeedDeploymentWorker,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_factories_ShareTokenFactory_ShareTokenFactory,
	statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	statoblast_openOracle_OpenOracle_OpenOracle,
	statoblast_SecurityPool_SecurityPool,
	statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate,
	statoblast_SecurityPoolEventEmitter_SecurityPoolEventEmitter,
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_SecurityPoolForkerPortfolioDelegate_SecurityPoolForkerPortfolioDelegate,
	statoblast_SecurityPoolUtils_SecurityPoolUtils,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCommitmentIndexDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolSettlementBookDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioSettlementDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioServicesDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolReporterLedgerDeployer,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinatorDeployer,
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuctionDeployer,
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
		escalationGameDepositDelegate: statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate,
		escalationGameFactory: statoblast_factories_EscalationGameFactory_EscalationGameFactory,
		multicall3: statoblast_Multicall3_Multicall3,
		openOracle: statoblast_openOracle_OpenOracle_OpenOracle,
		openOraclePriceCoordinatorFactory: statoblast_factories_OpenOraclePriceCoordinatorFactory_OpenOraclePriceCoordinatorFactory,
		priceCoordinatorDeploymentWorker: statoblast_factories_OpenOraclePriceCoordinatorFactory_PriceCoordinatorDeploymentWorker,
		sharedPoolPriceFeedDeploymentWorker: statoblast_factories_OpenOraclePriceCoordinatorFactory_SharedPoolPriceFeedDeploymentWorker,
		securityPoolFactory: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
		securityPoolForker: statoblast_SecurityPoolForker_SecurityPoolForker,
		securityPoolForkerPortfolioDelegate: statoblast_SecurityPoolForkerPortfolioDelegate_SecurityPoolForkerPortfolioDelegate,
		securityPoolOperationsDelegate: statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate,
		securityPoolEventEmitter: statoblast_SecurityPoolEventEmitter_SecurityPoolEventEmitter,
		securityPoolCapitalLedgerDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer,
		securityPoolCommitmentIndexDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCommitmentIndexDeployer,
		securityPoolCapitalFeeStreamsDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer,
		securityPoolSettlementBookDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolSettlementBookDeployer,
		securityPoolPortfolioSettlementDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioSettlementDeployer,
		securityPoolPortfolioServicesDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioServicesDeployer,
		securityPoolReporterLedgerDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolReporterLedgerDeployer,
		securityPoolPortfolioForkCoordinatorDeployer: statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinatorDeployer,
		securityPoolPortfolioAuctionDeployer: statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuctionDeployer,
		securityPoolUtils: statoblast_SecurityPoolUtils_SecurityPoolUtils,
		shareTokenFactory: statoblast_factories_ShareTokenFactory_ShareTokenFactory,
		uniformPriceDualCapBatchAuctionFactory: statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	},
	{ proxyDeployerAddress: addressString(PROXY_DEPLOYER_ADDRESS), zeroSalt: ZERO_SALT },
)

export const { applyLibraries } = statoblastInitCodes
const {
	getEscalationGameFactoryByteCode,
	getOpenOraclePriceCoordinatorFactoryByteCode,
	getPriceCoordinatorDeploymentWorkerByteCode,
	getSharedPoolPriceFeedDeploymentWorkerByteCode,
	getSecurityPoolFactoryByteCode,
	getSecurityPoolForkerByteCode,
	getSecurityPoolForkerPortfolioDelegateByteCode,
	getSecurityPoolOperationsDelegateByteCode,
	getSecurityPoolEventEmitterByteCode,
	getSecurityPoolCapitalLedgerDeployerByteCode,
	getSecurityPoolCommitmentIndexDeployerByteCode,
	getSecurityPoolCapitalFeeStreamsDeployerByteCode,
	getSecurityPoolSettlementBookDeployerByteCode,
	getSecurityPoolPortfolioSettlementDeployerByteCode,
	getSecurityPoolPortfolioServicesDeployerByteCode,
	getSecurityPoolReporterLedgerDeployerByteCode,
	getSecurityPoolPortfolioForkCoordinatorDeployerByteCode,
	getSecurityPoolPortfolioAuctionDeployerByteCode,
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
			args: [securityPool, repToken, proofVerifier, getInfraContractAddresses().escalationGameClaimDelegate, getInfraContractAddresses().escalationGameDepositDelegate],
		}),
	getInfraContracts: () => getInfraContractAddresses(),
	getOpenOraclePriceCoordinatorInitCode: (openOracle, repToken, initialReportPriorityFeeAttoEthPerGas) =>
		concatHex([
			applyLibraries(statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.evm.bytecode.object),
			encodeOpenOraclePriceCoordinatorArguments({ initialReportPriorityFeeAttoEthPerGas, openOracle, repToken, weth: MAINNET_WETH_ADDRESS, reportDelegate: getCreateAddress({ from: getInfraContractAddresses().priceCoordinatorDeploymentWorker, nonce: 3n }) }),
		]),
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
		{ id: 'securityPoolEventEmitter', address: infraContracts.securityPoolEventEmitter },
		{ id: 'openOracle', address: infraContracts.openOracle },
		{ id: 'zoltarQuestionData', address: infraContracts.zoltarQuestionData },
		{ id: 'zoltar', address: infraContracts.zoltar },
		{ id: 'shareTokenFactory', address: infraContracts.shareTokenFactory },
		{ id: 'priceCoordinatorDeploymentWorker', address: infraContracts.priceCoordinatorDeploymentWorker },
		{ id: 'sharedPoolPriceFeedDeploymentWorker', address: infraContracts.sharedPoolPriceFeedDeploymentWorker },
		{ id: 'openOraclePriceCoordinatorFactory', address: infraContracts.openOraclePriceCoordinatorFactory },
		{ id: 'securityPoolForkerPortfolioDelegate', address: infraContracts.securityPoolForkerPortfolioDelegate },
		{ id: 'securityPoolForker', address: infraContracts.securityPoolForker },
		{ id: 'escalationGameClaimDelegate', address: infraContracts.escalationGameClaimDelegate },
		{ id: 'escalationGameDepositDelegate', address: infraContracts.escalationGameDepositDelegate },
		{ id: 'escalationGameFactory', address: infraContracts.escalationGameFactory },
		{ id: 'securityPoolFactory', address: infraContracts.securityPoolFactory },
		{ id: 'securityPoolCapitalLedgerDeployer', address: infraContracts.securityPoolCapitalLedgerDeployer },
		{ id: 'securityPoolCommitmentIndexDeployer', address: infraContracts.securityPoolCommitmentIndexDeployer },
		{ id: 'securityPoolCapitalFeeStreamsDeployer', address: infraContracts.securityPoolCapitalFeeStreamsDeployer },
		{ id: 'securityPoolSettlementBookDeployer', address: infraContracts.securityPoolSettlementBookDeployer },
		{ id: 'securityPoolPortfolioSettlementDeployer', address: infraContracts.securityPoolPortfolioSettlementDeployer },
		{ id: 'securityPoolPortfolioServicesDeployer', address: infraContracts.securityPoolPortfolioServicesDeployer },
		{ id: 'securityPoolReporterLedgerDeployer', address: infraContracts.securityPoolReporterLedgerDeployer },
		{ id: 'securityPoolPortfolioForkCoordinatorDeployer', address: infraContracts.securityPoolPortfolioForkCoordinatorDeployer },
		{ id: 'securityPoolPortfolioAuctionDeployer', address: infraContracts.securityPoolPortfolioAuctionDeployer },
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
		securityPoolEventEmitter: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolEventEmitter'),
		openOracle: isDeploymentStatusOracleStepDeployed(deploymentMask, 'openOracle'),
		zoltar: isDeploymentStatusOracleStepDeployed(deploymentMask, 'zoltar'),
		shareTokenFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'shareTokenFactory'),
		priceCoordinatorDeploymentWorker: isDeploymentStatusOracleStepDeployed(deploymentMask, 'priceCoordinatorDeploymentWorker'),
		sharedPoolPriceFeedDeploymentWorker: isDeploymentStatusOracleStepDeployed(deploymentMask, 'sharedPoolPriceFeedDeploymentWorker'),
		openOraclePriceCoordinatorFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'openOraclePriceCoordinatorFactory'),
		securityPoolForkerPortfolioDelegate: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolForkerPortfolioDelegate'),
		securityPoolForker: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolForker'),
		escalationGameClaimDelegate: isDeploymentStatusOracleStepDeployed(deploymentMask, 'escalationGameClaimDelegate'),
		escalationGameFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'escalationGameFactory'),
		escalationGameProofVerifier: isDeploymentStatusOracleStepDeployed(deploymentMask, 'escalationGameFactory'),
		escalationGameDepositDelegate: isDeploymentStatusOracleStepDeployed(deploymentMask, 'escalationGameDepositDelegate'),
		zoltarQuestionData: isDeploymentStatusOracleStepDeployed(deploymentMask, 'zoltarQuestionData'),
		uniformPriceDualCapBatchAuctionFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'uniformPriceDualCapBatchAuctionFactory'),
		securityPoolFactory: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolFactory'),
		securityPoolCapitalLedgerDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolCapitalLedgerDeployer'),
		securityPoolCommitmentIndexDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolCommitmentIndexDeployer'),
		securityPoolCapitalFeeStreamsDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolCapitalFeeStreamsDeployer'),
		securityPoolSettlementBookDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolSettlementBookDeployer'),
		securityPoolPortfolioSettlementDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolPortfolioSettlementDeployer'),
		securityPoolPortfolioServicesDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolPortfolioServicesDeployer'),
		securityPoolReporterLedgerDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolReporterLedgerDeployer'),
		securityPoolPortfolioForkCoordinatorDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolPortfolioForkCoordinatorDeployer'),
		securityPoolPortfolioAuctionDeployer: isDeploymentStatusOracleStepDeployed(deploymentMask, 'securityPoolPortfolioAuctionDeployer'),
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
	if (!existence['securityPoolEventEmitter']) await deployBytecode('securityPoolEventEmitter', getSecurityPoolEventEmitterByteCode())
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
	if (!existence['securityPoolForkerPortfolioDelegate']) await deployBytecode('securityPoolForkerPortfolioDelegate', getSecurityPoolForkerPortfolioDelegateByteCode(contractAddresses.zoltar))
	if (!existence['securityPoolForker']) await deployBytecode('securityPoolForker', getSecurityPoolForkerByteCode(contractAddresses.zoltar))
	if (!existence['escalationGameClaimDelegate']) await deployBytecode('escalationGameClaimDelegate', `0x${statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.evm.bytecode.object}`)
	if (!existence['escalationGameDepositDelegate']) await deployBytecode('escalationGameDepositDelegate', `0x${statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate.evm.bytecode.object}`)
	if (!existence['escalationGameFactory']) await deployBytecode('escalationGameFactory', getEscalationGameFactoryByteCode(contractAddresses.escalationGameClaimDelegate, contractAddresses.escalationGameDepositDelegate))
	if (!existence['securityPoolFactory']) await deployBytecode('securityPoolFactory', getSecurityPoolFactoryByteCode(contractAddresses))
	if (!existence['securityPoolCapitalLedgerDeployer']) await deployBytecode('securityPoolCapitalLedgerDeployer', getSecurityPoolCapitalLedgerDeployerByteCode())
	if (!existence['securityPoolCommitmentIndexDeployer']) await deployBytecode('securityPoolCommitmentIndexDeployer', getSecurityPoolCommitmentIndexDeployerByteCode())
	if (!existence['securityPoolCapitalFeeStreamsDeployer']) await deployBytecode('securityPoolCapitalFeeStreamsDeployer', getSecurityPoolCapitalFeeStreamsDeployerByteCode())
	if (!existence['securityPoolSettlementBookDeployer']) await deployBytecode('securityPoolSettlementBookDeployer', getSecurityPoolSettlementBookDeployerByteCode())
	if (!existence['securityPoolPortfolioSettlementDeployer']) await deployBytecode('securityPoolPortfolioSettlementDeployer', getSecurityPoolPortfolioSettlementDeployerByteCode())
	if (!existence['securityPoolPortfolioServicesDeployer']) await deployBytecode('securityPoolPortfolioServicesDeployer', getSecurityPoolPortfolioServicesDeployerByteCode())
	if (!existence['securityPoolReporterLedgerDeployer']) await deployBytecode('securityPoolReporterLedgerDeployer', getSecurityPoolReporterLedgerDeployerByteCode())
	if (!existence['securityPoolPortfolioForkCoordinatorDeployer']) await deployBytecode('securityPoolPortfolioForkCoordinatorDeployer', getSecurityPoolPortfolioForkCoordinatorDeployerByteCode())
	if (!existence['securityPoolPortfolioAuctionDeployer']) await deployBytecode('securityPoolPortfolioAuctionDeployer', getSecurityPoolPortfolioAuctionDeployerByteCode())

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

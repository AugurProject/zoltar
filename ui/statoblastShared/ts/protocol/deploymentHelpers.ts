import { getCreateAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { constructorArgumentsFromInitCode } from '@zoltar/core-shared/deployment/deploymentAddresses'
import type { DeploymentStepId } from '@zoltar/ui-core-shared/types/contracts.js'
import { createStatoblastInitCodes } from '@zoltar/statoblast-shared/deployment/initCodes'
import { statoblast_Multicall3_Multicall3 } from '@zoltar/ui-core-shared/contractArtifact.js'
import {
	statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate,
	statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate,
	statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate,
	statoblast_SecurityPoolEventEmitter_SecurityPoolEventEmitter,
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_SecurityPoolUtils_SecurityPoolUtils,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio,
	statoblast_SecurityPoolForkerPortfolioDelegate_SecurityPoolForkerPortfolioDelegate,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCommitmentIndexDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolSettlementBookDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioSettlementDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolReporterLedgerDeployer,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioRecapAuctionDeployer,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinatorDeployer,
	statoblast_factories_EscalationGameFactory_EscalationGameFactory,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_OpenOraclePriceCoordinatorFactory,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_PriceCoordinatorDeploymentWorker,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_SharedPoolPriceFeedDeploymentWorker,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_factories_ShareTokenFactory_ShareTokenFactory,
	statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	statoblast_openOracle_OpenOracle_OpenOracle,
} from '../contractArtifact.js'
import { getRuntimeNetworkProfile, type NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getZoltarContractAddresses, PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'

export { getZoltarAddress, PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'

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
		securityPoolCapitalLedgerDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer,
		securityPoolCommitmentIndexDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCommitmentIndexDeployer,
		securityPoolCapitalFeeStreamsDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer,
		securityPoolSettlementBookDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolSettlementBookDeployer,
		securityPoolPortfolioSettlementDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioSettlementDeployer,
		securityPoolReporterLedgerDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolReporterLedgerDeployer,
		securityPoolPortfolioRecapAuctionDeployer: statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioRecapAuctionDeployer,
		securityPoolPortfolioForkCoordinatorDeployer: statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinatorDeployer,
		securityPoolOperationsDelegate: statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate,
		securityPoolEventEmitter: statoblast_SecurityPoolEventEmitter_SecurityPoolEventEmitter,
		securityPoolUtils: statoblast_SecurityPoolUtils_SecurityPoolUtils,
		shareTokenFactory: statoblast_factories_ShareTokenFactory_ShareTokenFactory,
		uniformPriceDualCapBatchAuctionFactory: statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	},
	{ proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS, zeroSalt: ZERO_SALT },
)

export const {
	getEscalationGameFactoryByteCode,
	getOpenOraclePriceCoordinatorFactoryByteCode,
	getPriceCoordinatorDeploymentWorkerByteCode,
	getSharedPoolPriceFeedDeploymentWorkerByteCode,
	getSecurityPoolFactoryByteCode,
	getSecurityPoolForkerByteCode,
	getSecurityPoolForkerPortfolioDelegateByteCode,
	getSecurityPoolCapitalLedgerDeployerByteCode,
	getSecurityPoolCommitmentIndexDeployerByteCode,
	getSecurityPoolCapitalFeeStreamsDeployerByteCode,
	getSecurityPoolSettlementBookDeployerByteCode,
	getSecurityPoolPortfolioSettlementDeployerByteCode,
	getSecurityPoolReporterLedgerDeployerByteCode,
	getSecurityPoolPortfolioRecapAuctionDeployerByteCode,
	getSecurityPoolPortfolioForkCoordinatorDeployerByteCode,
	getSecurityPoolOperationsDelegateByteCode,
	getSecurityPoolEventEmitterByteCode,
	getShareTokenFactoryByteCode,
} = statoblastInitCodes

export const applyStatoblastLibraries = statoblastInitCodes.applyLibraries

export const getSecurityPoolPortfolioByteCode = () => statoblastInitCodes.applyLibraries(statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio.evm.bytecode.object)

export const getSecurityPoolPortfolioRuntimeCode = () => statoblastInitCodes.applyLibraries(statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio.evm.deployedBytecode.object)

export const getSecurityPoolEventEmitterRuntimeCode = () => statoblastInitCodes.applyLibraries(statoblast_SecurityPoolEventEmitter_SecurityPoolEventEmitter.evm.deployedBytecode.object)
export const getSecurityPoolOperationsDelegateRuntimeCode = () => statoblastInitCodes.applyLibraries(statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate.evm.deployedBytecode.object)

export function getInfraContractAddresses(profile: NetworkProfile = getRuntimeNetworkProfile()) {
	const zoltarAddresses = getZoltarContractAddresses(profile)
	return statoblastInitCodes.createInfraContractAddresses(profile.wethAddress, {
		getZoltarAddress: () => zoltarAddresses.zoltar,
		getZoltarQuestionDataAddress: () => zoltarAddresses.zoltarQuestionData,
	})()
}

// Constructor arguments for the statoblast infrastructure steps, keyed by step
// id, as appended to each step's init code. Deployment manifests record these
// so explorer source verification never re-derives deployment parameters.
export function getInfraStepConstructorArguments(profile: NetworkProfile = getRuntimeNetworkProfile()): Partial<Record<DeploymentStepId, string>> {
	const addresses = getInfraContractAddresses(profile)
	return {
		uniformPriceDualCapBatchAuctionFactory: '',
		securityPoolUtils: '',
		securityPoolEventEmitter: constructorArgumentsFromInitCode(getSecurityPoolEventEmitterByteCode(), statoblast_SecurityPoolEventEmitter_SecurityPoolEventEmitter.evm.bytecode.object),
		securityPoolOperationsDelegate: constructorArgumentsFromInitCode(getSecurityPoolOperationsDelegateByteCode(), statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate.evm.bytecode.object),
		openOracle: '',
		priceCoordinatorDeploymentWorker: '',
		sharedPoolPriceFeedDeploymentWorker: '',
		shareTokenFactory: constructorArgumentsFromInitCode(getShareTokenFactoryByteCode(addresses.zoltar), statoblast_factories_ShareTokenFactory_ShareTokenFactory.evm.bytecode.object),
		openOraclePriceCoordinatorFactory: constructorArgumentsFromInitCode(getOpenOraclePriceCoordinatorFactoryByteCode(profile.wethAddress), statoblast_factories_OpenOraclePriceCoordinatorFactory_OpenOraclePriceCoordinatorFactory.evm.bytecode.object),
		securityPoolForkerPortfolioDelegate: constructorArgumentsFromInitCode(getSecurityPoolForkerPortfolioDelegateByteCode(addresses.zoltar), statoblast_SecurityPoolForkerPortfolioDelegate_SecurityPoolForkerPortfolioDelegate.evm.bytecode.object),
		securityPoolCapitalLedgerDeployer: constructorArgumentsFromInitCode(getSecurityPoolCapitalLedgerDeployerByteCode(), statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer.evm.bytecode.object),
		securityPoolCommitmentIndexDeployer: constructorArgumentsFromInitCode(getSecurityPoolCommitmentIndexDeployerByteCode(), statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCommitmentIndexDeployer.evm.bytecode.object),
		securityPoolCapitalFeeStreamsDeployer: constructorArgumentsFromInitCode(getSecurityPoolCapitalFeeStreamsDeployerByteCode(), statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer.evm.bytecode.object),
		securityPoolSettlementBookDeployer: constructorArgumentsFromInitCode(getSecurityPoolSettlementBookDeployerByteCode(), statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolSettlementBookDeployer.evm.bytecode.object),
		securityPoolPortfolioSettlementDeployer: constructorArgumentsFromInitCode(getSecurityPoolPortfolioSettlementDeployerByteCode(), statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioSettlementDeployer.evm.bytecode.object),
		securityPoolReporterLedgerDeployer: constructorArgumentsFromInitCode(getSecurityPoolReporterLedgerDeployerByteCode(), statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolReporterLedgerDeployer.evm.bytecode.object),
		securityPoolPortfolioRecapAuctionDeployer: constructorArgumentsFromInitCode(getSecurityPoolPortfolioRecapAuctionDeployerByteCode(), statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioRecapAuctionDeployer.evm.bytecode.object),
		securityPoolPortfolioForkCoordinatorDeployer: constructorArgumentsFromInitCode(getSecurityPoolPortfolioForkCoordinatorDeployerByteCode(), statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinatorDeployer.evm.bytecode.object),
		securityPoolForker: constructorArgumentsFromInitCode(getSecurityPoolForkerByteCode(addresses.zoltar), statoblast_SecurityPoolForker_SecurityPoolForker.evm.bytecode.object),
		escalationGameClaimDelegate: '',
		escalationGameDepositDelegate: '',
		escalationGameFactory: constructorArgumentsFromInitCode(getEscalationGameFactoryByteCode(addresses.escalationGameClaimDelegate, addresses.escalationGameDepositDelegate), statoblast_factories_EscalationGameFactory_EscalationGameFactory.evm.bytecode.object),
		securityPoolFactory: constructorArgumentsFromInitCode(getSecurityPoolFactoryByteCode(addresses), statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
	}
}

type BootstrapDescendantAddresses = {
	[id: string]: Address
	escalationGameProofVerifier: Address
	liquidationApprovalRegistryDeployer: Address
	liquidationApprovalRegistryImplementation: Address
	oracleReportDelegate: Address
	priceCoordinatorCreationCodeFirstChunk: Address
	priceCoordinatorCreationCodeSecondChunk: Address
	sharedPoolPriceFeedCreationCodeFirstChunk: Address
	sharedPoolPriceFeedCreationCodeSecondChunk: Address
	securityPoolCreationCodeFirstChunk: Address
	securityPoolCreationCodeSecondChunk: Address
	securityPoolDeployer: Address
	securityPoolDeploymentWorker: Address
}

export function getBootstrapDescendantAddresses(profile: NetworkProfile = getRuntimeNetworkProfile()): BootstrapDescendantAddresses {
	const infrastructure = getInfraContractAddresses(profile)
	const liquidationApprovalRegistryDeployer = getCreateAddress({ from: infrastructure.openOraclePriceCoordinatorFactory, nonce: 1n })
	const priceCoordinatorDeploymentWorker = infrastructure.priceCoordinatorDeploymentWorker
	const securityPoolDeployer = getCreateAddress({ from: infrastructure.securityPoolFactory, nonce: 1n })
	const securityPoolDeploymentWorker = getCreateAddress({ from: securityPoolDeployer, nonce: 1n })
	return {
		liquidationApprovalRegistryDeployer,
		liquidationApprovalRegistryImplementation: getCreateAddress({ from: liquidationApprovalRegistryDeployer, nonce: 1n }),
		sharedPoolPriceFeedCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.sharedPoolPriceFeedDeploymentWorker, nonce: 1n }),
		sharedPoolPriceFeedCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.sharedPoolPriceFeedDeploymentWorker, nonce: 2n }),
		oracleReportDelegate: getCreateAddress({ from: priceCoordinatorDeploymentWorker, nonce: 3n }),
		priceCoordinatorCreationCodeFirstChunk: getCreateAddress({ from: priceCoordinatorDeploymentWorker, nonce: 1n }),
		priceCoordinatorCreationCodeSecondChunk: getCreateAddress({ from: priceCoordinatorDeploymentWorker, nonce: 2n }),
		escalationGameCreationCodePartOne: getCreateAddress({ from: infrastructure.escalationGameFactory, nonce: 2n }),
		escalationGameCreationCodePartTwo: getCreateAddress({ from: infrastructure.escalationGameFactory, nonce: 3n }),
		escalationGameProofVerifier: infrastructure.escalationGameProofVerifier,
		securityPoolDeployer,
		securityPoolDeploymentWorker,
		securityPoolCreationCodeFirstChunk: getCreateAddress({ from: securityPoolDeploymentWorker, nonce: 1n }),
		securityPoolCreationCodeSecondChunk: getCreateAddress({ from: securityPoolDeploymentWorker, nonce: 2n }),
		securityPoolForkerEscalationGameForkerDelegate: getCreateAddress({ from: infrastructure.securityPoolForker, nonce: 2n }),
		securityPoolForkerVaultMigrationDelegate: getCreateAddress({ from: infrastructure.securityPoolForker, nonce: 1n }),
		securityPoolCapitalCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.securityPoolCapitalLedgerDeployer, nonce: 1n }),
		securityPoolCapitalCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.securityPoolCapitalLedgerDeployer, nonce: 2n }),
		securityPoolForkCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.securityPoolPortfolioForkCoordinatorDeployer, nonce: 1n }),
		securityPoolForkCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.securityPoolPortfolioForkCoordinatorDeployer, nonce: 2n }),
	}
}

export function getOpenOracleAddress() {
	return getInfraContractAddresses().openOracle
}

export function getPortfolioDeployers(profile: NetworkProfile = getRuntimeNetworkProfile()) {
	const addresses = getInfraContractAddresses(profile)
	return {
		capital: addresses.securityPoolCapitalLedgerDeployer,
		commitments: addresses.securityPoolCommitmentIndexDeployer,
		fees: addresses.securityPoolCapitalFeeStreamsDeployer,
		books: addresses.securityPoolSettlementBookDeployer,
		settlement: addresses.securityPoolPortfolioSettlementDeployer,
		reporters: addresses.securityPoolReporterLedgerDeployer,
		forks: addresses.securityPoolPortfolioForkCoordinatorDeployer,
	}
}

type PortfolioModuleId =
	| 'securityPoolCapitalLedgerDeployer'
	| 'securityPoolCommitmentIndexDeployer'
	| 'securityPoolCapitalFeeStreamsDeployer'
	| 'securityPoolSettlementBookDeployer'
	| 'securityPoolPortfolioSettlementDeployer'
	| 'securityPoolReporterLedgerDeployer'
	| 'securityPoolPortfolioRecapAuctionDeployer'
	| 'securityPoolPortfolioForkCoordinatorDeployer'
type PortfolioModuleDeployment = { id: PortfolioModuleId; label: string; bytecode: typeof getSecurityPoolCapitalLedgerDeployerByteCode; artifact: { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } } }
export const portfolioModuleDeployments: readonly PortfolioModuleDeployment[] = [
	{ id: 'securityPoolCapitalLedgerDeployer', label: 'SecurityPoolCapitalLedgerDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer, bytecode: getSecurityPoolCapitalLedgerDeployerByteCode },
	{ id: 'securityPoolCommitmentIndexDeployer', label: 'SecurityPoolCommitmentIndexDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCommitmentIndexDeployer, bytecode: getSecurityPoolCommitmentIndexDeployerByteCode },
	{ id: 'securityPoolCapitalFeeStreamsDeployer', label: 'SecurityPoolCapitalFeeStreamsDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer, bytecode: getSecurityPoolCapitalFeeStreamsDeployerByteCode },
	{ id: 'securityPoolSettlementBookDeployer', label: 'SecurityPoolSettlementBookDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolSettlementBookDeployer, bytecode: getSecurityPoolSettlementBookDeployerByteCode },
	{ id: 'securityPoolPortfolioSettlementDeployer', label: 'SecurityPoolPortfolioSettlementDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioSettlementDeployer, bytecode: getSecurityPoolPortfolioSettlementDeployerByteCode },
	{ id: 'securityPoolReporterLedgerDeployer', label: 'SecurityPoolReporterLedgerDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolReporterLedgerDeployer, bytecode: getSecurityPoolReporterLedgerDeployerByteCode },
	{ id: 'securityPoolPortfolioRecapAuctionDeployer', label: 'SecurityPoolPortfolioRecapAuctionDeployer', artifact: statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioRecapAuctionDeployer, bytecode: getSecurityPoolPortfolioRecapAuctionDeployerByteCode },
	{ id: 'securityPoolPortfolioForkCoordinatorDeployer', label: 'SecurityPoolPortfolioForkCoordinatorDeployer', artifact: statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinatorDeployer, bytecode: getSecurityPoolPortfolioForkCoordinatorDeployerByteCode },
] as const

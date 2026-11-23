import type { Hex } from '@zoltar/core-shared/evm/ethereum'
import { getCreateAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { constructorArgumentsFromInitCode } from '@zoltar/core-shared/deployment/deploymentAddresses'
import type { DeploymentStepId } from '@zoltar/ui-core-shared/types/contracts.js'
import { createStatoblastInitCodes } from '@zoltar/statoblast-shared/deployment/initCodes'
import { statoblast_Multicall3_Multicall3 } from '@zoltar/ui-core-shared/contractArtifact.js'
import {
	statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate,
	statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate,
	statoblast_SecurityPoolEventEmitter_SecurityPoolEventEmitter,
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio,
	statoblast_SecurityPoolForkerPortfolioDelegate_SecurityPoolForkerPortfolioDelegate,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCommitmentIndexDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolSettlementBookDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioSettlementDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioServicesDeployer,
	statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolReporterLedgerDeployer,
	statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinatorDeployer,
	statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuctionDeployer,
	statoblast_factories_EscalationGameFactory_EscalationGameFactory,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_OpenOraclePriceCoordinatorFactory,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_PriceCoordinatorDeploymentWorker,
	statoblast_factories_OpenOraclePriceCoordinatorFactory_SharedPoolPriceFeedDeploymentWorker,
	statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
	statoblast_factories_ShareTokenFactory_ShareTokenFactory,
	statoblast_openOracle_OpenOracle_OpenOracle,
} from '../contractArtifact.js'
import { getRuntimeNetworkProfile, type NetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { getZoltarContractAddresses, PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'

export { getZoltarAddress, PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from '@zoltar/ui-zoltar-shared/protocol/zoltarDeploymentHelpers.js'

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
		securityPoolPortfolio: statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio,
		securityPoolForker: statoblast_SecurityPoolForker_SecurityPoolForker,
		securityPoolForkerPortfolioDelegate: statoblast_SecurityPoolForkerPortfolioDelegate_SecurityPoolForkerPortfolioDelegate,
		securityPoolCapitalLedgerDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer,
		securityPoolCommitmentIndexDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCommitmentIndexDeployer,
		securityPoolCapitalFeeStreamsDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer,
		securityPoolSettlementBookDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolSettlementBookDeployer,
		securityPoolPortfolioSettlementDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioSettlementDeployer,
		securityPoolPortfolioServicesDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioServicesDeployer,
		securityPoolReporterLedgerDeployer: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolReporterLedgerDeployer,
		securityPoolPortfolioForkCoordinatorDeployer: statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinatorDeployer,
		securityPoolPortfolioAuctionDeployer: statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuctionDeployer,
		securityPoolOperationsDelegate: statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate,
		securityPoolEventEmitter: statoblast_SecurityPoolEventEmitter_SecurityPoolEventEmitter,
		shareTokenFactory: statoblast_factories_ShareTokenFactory_ShareTokenFactory,
	},
	{ proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS, zeroSalt: ZERO_SALT },
)

const {
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
	getSecurityPoolPortfolioServicesDeployerByteCode,
	getSecurityPoolReporterLedgerDeployerByteCode,
	getSecurityPoolPortfolioForkCoordinatorDeployerByteCode,
	getSecurityPoolPortfolioAuctionDeployerByteCode,
	getSecurityPoolOperationsDelegateByteCode,
	getSecurityPoolEventEmitterByteCode,
	getShareTokenFactoryByteCode,
} = statoblastInitCodes

export {
	getEscalationGameFactoryByteCode,
	getOpenOraclePriceCoordinatorFactoryByteCode,
	getPriceCoordinatorDeploymentWorkerByteCode,
	getSharedPoolPriceFeedDeploymentWorkerByteCode,
	getSecurityPoolFactoryByteCode,
	getSecurityPoolForkerByteCode,
	getSecurityPoolForkerPortfolioDelegateByteCode,
	getSecurityPoolOperationsDelegateByteCode,
	getSecurityPoolEventEmitterByteCode,
	getShareTokenFactoryByteCode,
}

/** The linked creation code the canonical factory pins by hash and deploys for every portfolio. */
export const getSecurityPoolPortfolioCreationCode = statoblastInitCodes.getSecurityPoolPortfolioCreationCode

export const getSecurityPoolPortfolioRuntimeCode = (): Hex => `0x${statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio.evm.deployedBytecode.object}`

export const getSecurityPoolEventEmitterRuntimeCode = (): Hex => `0x${statoblast_SecurityPoolEventEmitter_SecurityPoolEventEmitter.evm.deployedBytecode.object}`
export const getSecurityPoolOperationsDelegateRuntimeCode = (): Hex => `0x${statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate.evm.deployedBytecode.object}`

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
		securityPoolPortfolioServicesDeployer: constructorArgumentsFromInitCode(getSecurityPoolPortfolioServicesDeployerByteCode(), statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioServicesDeployer.evm.bytecode.object),
		securityPoolReporterLedgerDeployer: constructorArgumentsFromInitCode(getSecurityPoolReporterLedgerDeployerByteCode(), statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolReporterLedgerDeployer.evm.bytecode.object),
		securityPoolPortfolioForkCoordinatorDeployer: constructorArgumentsFromInitCode(getSecurityPoolPortfolioForkCoordinatorDeployerByteCode(), statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinatorDeployer.evm.bytecode.object),
		securityPoolPortfolioAuctionDeployer: constructorArgumentsFromInitCode(getSecurityPoolPortfolioAuctionDeployerByteCode(), statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuctionDeployer.evm.bytecode.object),
		securityPoolForker: constructorArgumentsFromInitCode(getSecurityPoolForkerByteCode(addresses.zoltar), statoblast_SecurityPoolForker_SecurityPoolForker.evm.bytecode.object),
		escalationGameDepositDelegate: '',
		escalationGameFactory: constructorArgumentsFromInitCode(getEscalationGameFactoryByteCode(addresses.escalationGameDepositDelegate), statoblast_factories_EscalationGameFactory_EscalationGameFactory.evm.bytecode.object),
		securityPoolFactory: constructorArgumentsFromInitCode(getSecurityPoolFactoryByteCode(addresses), statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
	}
}

type BootstrapDescendantAddresses = {
	[id: string]: Address
	escalationGameProofVerifier: Address
	oracleReportDelegate: Address
	priceCoordinatorCreationCodeFirstChunk: Address
	priceCoordinatorCreationCodeSecondChunk: Address
	sharedPoolPriceFeedCreationCodeFirstChunk: Address
	sharedPoolPriceFeedCreationCodeSecondChunk: Address
	securityPoolCreationCodeFirstChunk: Address
	securityPoolCreationCodeSecondChunk: Address
	securityPoolCommitmentIndexImplementation: Address
	securityPoolCapitalFeeStreamsImplementation: Address
	securityPoolDeployer: Address
	securityPoolDeploymentWorker: Address
}

export function getBootstrapDescendantAddresses(profile: NetworkProfile = getRuntimeNetworkProfile()): BootstrapDescendantAddresses {
	const infrastructure = getInfraContractAddresses(profile)
	const priceCoordinatorDeploymentWorker = infrastructure.priceCoordinatorDeploymentWorker
	const securityPoolDeployer = getCreateAddress({ from: infrastructure.securityPoolFactory, nonce: 1n })
	const securityPoolDeploymentWorker = getCreateAddress({ from: securityPoolDeployer, nonce: 1n })
	return {
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
		securityPoolCapitalCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.securityPoolCapitalLedgerDeployer, nonce: 1n }),
		securityPoolCapitalCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.securityPoolCapitalLedgerDeployer, nonce: 2n }),
		securityPoolCommitmentIndexImplementation: getCreateAddress({ from: infrastructure.securityPoolCommitmentIndexDeployer, nonce: 1n }),
		securityPoolCapitalFeeStreamsImplementation: getCreateAddress({ from: infrastructure.securityPoolCapitalFeeStreamsDeployer, nonce: 1n }),
		securityPoolServicesCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.securityPoolPortfolioServicesDeployer, nonce: 1n }),
		securityPoolServicesCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.securityPoolPortfolioServicesDeployer, nonce: 2n }),
		securityPoolSettlementBookCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.securityPoolSettlementBookDeployer, nonce: 1n }),
		securityPoolSettlementBookCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.securityPoolSettlementBookDeployer, nonce: 2n }),
		securityPoolForkCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.securityPoolPortfolioForkCoordinatorDeployer, nonce: 1n }),
		securityPoolAuctionCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.securityPoolPortfolioAuctionDeployer, nonce: 1n }),
		securityPoolForkCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.securityPoolPortfolioForkCoordinatorDeployer, nonce: 2n }),
		securityPoolAuctionCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.securityPoolPortfolioAuctionDeployer, nonce: 2n }),
		securityPoolAuctionVaultImplementation: getCreateAddress({ from: infrastructure.securityPoolPortfolioAuctionDeployer, nonce: 3n }),
	}
}

export function getOpenOracleAddress() {
	return getInfraContractAddresses().openOracle
}

type PortfolioModuleId =
	| 'securityPoolCapitalLedgerDeployer'
	| 'securityPoolCommitmentIndexDeployer'
	| 'securityPoolCapitalFeeStreamsDeployer'
	| 'securityPoolSettlementBookDeployer'
	| 'securityPoolPortfolioSettlementDeployer'
	| 'securityPoolPortfolioServicesDeployer'
	| 'securityPoolReporterLedgerDeployer'
	| 'securityPoolPortfolioForkCoordinatorDeployer'
	| 'securityPoolPortfolioAuctionDeployer'
type PortfolioModuleDeployment = { id: PortfolioModuleId; label: string; bytecode: typeof getSecurityPoolCapitalLedgerDeployerByteCode; artifact: { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } } }
export const portfolioModuleDeployments: readonly PortfolioModuleDeployment[] = [
	{ id: 'securityPoolCapitalLedgerDeployer', label: 'SecurityPoolCapitalLedgerDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalLedgerDeployer, bytecode: getSecurityPoolCapitalLedgerDeployerByteCode },
	{ id: 'securityPoolCommitmentIndexDeployer', label: 'SecurityPoolCommitmentIndexDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCommitmentIndexDeployer, bytecode: getSecurityPoolCommitmentIndexDeployerByteCode },
	{ id: 'securityPoolCapitalFeeStreamsDeployer', label: 'SecurityPoolCapitalFeeStreamsDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer, bytecode: getSecurityPoolCapitalFeeStreamsDeployerByteCode },
	{ id: 'securityPoolSettlementBookDeployer', label: 'SecurityPoolSettlementBookDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolSettlementBookDeployer, bytecode: getSecurityPoolSettlementBookDeployerByteCode },
	{ id: 'securityPoolPortfolioSettlementDeployer', label: 'SecurityPoolPortfolioSettlementDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioSettlementDeployer, bytecode: getSecurityPoolPortfolioSettlementDeployerByteCode },
	{ id: 'securityPoolPortfolioServicesDeployer', label: 'SecurityPoolPortfolioServicesDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolPortfolioServicesDeployer, bytecode: getSecurityPoolPortfolioServicesDeployerByteCode },
	{ id: 'securityPoolReporterLedgerDeployer', label: 'SecurityPoolReporterLedgerDeployer', artifact: statoblast_SecurityPoolPortfolioModuleDeployers_SecurityPoolReporterLedgerDeployer, bytecode: getSecurityPoolReporterLedgerDeployerByteCode },
	{ id: 'securityPoolPortfolioForkCoordinatorDeployer', label: 'SecurityPoolPortfolioForkCoordinatorDeployer', artifact: statoblast_SecurityPoolPortfolioForkCoordinator_SecurityPoolPortfolioForkCoordinatorDeployer, bytecode: getSecurityPoolPortfolioForkCoordinatorDeployerByteCode },
	{ id: 'securityPoolPortfolioAuctionDeployer', label: 'SecurityPoolPortfolioAuctionDeployer', artifact: statoblast_SecurityPoolPortfolioAuction_SecurityPoolPortfolioAuctionDeployer, bytecode: getSecurityPoolPortfolioAuctionDeployerByteCode },
] as const

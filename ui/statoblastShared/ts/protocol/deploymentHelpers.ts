import * as deploymentCopy from '../copy/deployment.js'
import type { Hex } from '@zoltar/core-shared/evm/ethereum'
import { getCreateAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { constructorArgumentsFromInitCode } from '@zoltar/core-shared/deployment/deploymentAddresses'
import type { DeploymentStepId } from '@zoltar/ui-core-shared/types/contracts.js'
import { createStatoblastInitCodes } from '@zoltar/statoblast-shared/deployment/initCodes'
import { statoblast_Multicall3_Multicall3 } from '@zoltar/ui-core-shared/contractArtifact.js'
import {
	statoblast_EscalationGameDepositDelegate_EscalationGameDepositDelegate,
	statoblast_QuestionLedgerDelegate_QuestionLedgerDelegate,
	statoblast_QuestionForker_QuestionForker,
	statoblast_SecurityPool_SecurityPool,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalLedgerDeployer,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolCommitmentIndexDeployer,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementBookDeployer,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementDeployer,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolServicesDeployer,
	statoblast_SecurityPoolModuleDeployers_SecurityPoolReporterLedgerDeployer,
	statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinatorDeployer,
	statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuctionDeployer,
	statoblast_factories_EscalationGameFactory_EscalationGameFactory,
	statoblast_factories_SharedPoolPriceFeedFactory_SharedPoolPriceFeedFactory,
	statoblast_factories_SharedPoolPriceFeedFactory_SharedPoolPriceFeedDeploymentWorker,
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
		sharedPoolPriceFeedFactory: statoblast_factories_SharedPoolPriceFeedFactory_SharedPoolPriceFeedFactory,
		sharedPoolPriceFeedDeploymentWorker: statoblast_factories_SharedPoolPriceFeedFactory_SharedPoolPriceFeedDeploymentWorker,
		securityPoolFactory: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
		securityPool: statoblast_SecurityPool_SecurityPool,
		questionForker: statoblast_QuestionForker_QuestionForker,
		securityPoolCapitalLedgerDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalLedgerDeployer,
		securityPoolCommitmentIndexDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolCommitmentIndexDeployer,
		securityPoolCapitalFeeStreamsDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer,
		securityPoolSettlementBookDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementBookDeployer,
		securityPoolSettlementDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementDeployer,
		securityPoolServicesDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolServicesDeployer,
		securityPoolReporterLedgerDeployer: statoblast_SecurityPoolModuleDeployers_SecurityPoolReporterLedgerDeployer,
		securityPoolForkCoordinatorDeployer: statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinatorDeployer,
		securityPoolRepairAuctionDeployer: statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuctionDeployer,
		questionLedgerDelegate: statoblast_QuestionLedgerDelegate_QuestionLedgerDelegate,
		shareTokenFactory: statoblast_factories_ShareTokenFactory_ShareTokenFactory,
	},
	{ proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS, zeroSalt: ZERO_SALT },
)

const {
	getEscalationGameFactoryByteCode,
	getSharedPoolPriceFeedFactoryByteCode,
	getSharedPoolPriceFeedDeploymentWorkerByteCode,
	getSecurityPoolFactoryByteCode,
	getQuestionForkerByteCode,
	getSecurityPoolCapitalLedgerDeployerByteCode,
	getSecurityPoolCommitmentIndexDeployerByteCode,
	getSecurityPoolCapitalFeeStreamsDeployerByteCode,
	getSecurityPoolSettlementBookDeployerByteCode,
	getSecurityPoolSettlementDeployerByteCode,
	getSecurityPoolServicesDeployerByteCode,
	getSecurityPoolReporterLedgerDeployerByteCode,
	getSecurityPoolForkCoordinatorDeployerByteCode,
	getSecurityPoolRepairAuctionDeployerByteCode,
	getQuestionLedgerDelegateByteCode,
	getShareTokenFactoryByteCode,
} = statoblastInitCodes

export { getEscalationGameFactoryByteCode, getSharedPoolPriceFeedFactoryByteCode, getSharedPoolPriceFeedDeploymentWorkerByteCode, getSecurityPoolFactoryByteCode, getQuestionForkerByteCode, getQuestionLedgerDelegateByteCode, getShareTokenFactoryByteCode }

/** The linked creation code the canonical factory pins by hash and deploys for every security pool. */
export const getSecurityPoolCreationCode = statoblastInitCodes.getSecurityPoolCreationCode

export const getSecurityPoolRuntimeCode = (): Hex => `0x${statoblast_SecurityPool_SecurityPool.evm.deployedBytecode.object}`

export const getQuestionLedgerDelegateRuntimeCode = (): Hex => `0x${statoblast_QuestionLedgerDelegate_QuestionLedgerDelegate.evm.deployedBytecode.object}`

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
		questionLedgerDelegate: constructorArgumentsFromInitCode(getQuestionLedgerDelegateByteCode(), statoblast_QuestionLedgerDelegate_QuestionLedgerDelegate.evm.bytecode.object),
		openOracle: '',
		sharedPoolPriceFeedDeploymentWorker: '',
		shareTokenFactory: constructorArgumentsFromInitCode(getShareTokenFactoryByteCode(addresses.zoltar), statoblast_factories_ShareTokenFactory_ShareTokenFactory.evm.bytecode.object),
		sharedPoolPriceFeedFactory: constructorArgumentsFromInitCode(getSharedPoolPriceFeedFactoryByteCode(profile.wethAddress), statoblast_factories_SharedPoolPriceFeedFactory_SharedPoolPriceFeedFactory.evm.bytecode.object),
		securityPoolCapitalLedgerDeployer: constructorArgumentsFromInitCode(getSecurityPoolCapitalLedgerDeployerByteCode(), statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalLedgerDeployer.evm.bytecode.object),
		securityPoolCommitmentIndexDeployer: constructorArgumentsFromInitCode(getSecurityPoolCommitmentIndexDeployerByteCode(), statoblast_SecurityPoolModuleDeployers_SecurityPoolCommitmentIndexDeployer.evm.bytecode.object),
		securityPoolCapitalFeeStreamsDeployer: constructorArgumentsFromInitCode(getSecurityPoolCapitalFeeStreamsDeployerByteCode(), statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer.evm.bytecode.object),
		securityPoolSettlementBookDeployer: constructorArgumentsFromInitCode(getSecurityPoolSettlementBookDeployerByteCode(), statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementBookDeployer.evm.bytecode.object),
		securityPoolSettlementDeployer: constructorArgumentsFromInitCode(getSecurityPoolSettlementDeployerByteCode(), statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementDeployer.evm.bytecode.object),
		securityPoolServicesDeployer: constructorArgumentsFromInitCode(getSecurityPoolServicesDeployerByteCode(), statoblast_SecurityPoolModuleDeployers_SecurityPoolServicesDeployer.evm.bytecode.object),
		securityPoolReporterLedgerDeployer: constructorArgumentsFromInitCode(getSecurityPoolReporterLedgerDeployerByteCode(), statoblast_SecurityPoolModuleDeployers_SecurityPoolReporterLedgerDeployer.evm.bytecode.object),
		securityPoolForkCoordinatorDeployer: constructorArgumentsFromInitCode(getSecurityPoolForkCoordinatorDeployerByteCode(), statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinatorDeployer.evm.bytecode.object),
		securityPoolRepairAuctionDeployer: constructorArgumentsFromInitCode(getSecurityPoolRepairAuctionDeployerByteCode(), statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuctionDeployer.evm.bytecode.object),
		questionForker: constructorArgumentsFromInitCode(getQuestionForkerByteCode(addresses.zoltar), statoblast_QuestionForker_QuestionForker.evm.bytecode.object),
		escalationGameDepositDelegate: '',
		escalationGameFactory: constructorArgumentsFromInitCode(getEscalationGameFactoryByteCode(addresses.escalationGameDepositDelegate), statoblast_factories_EscalationGameFactory_EscalationGameFactory.evm.bytecode.object),
		securityPoolFactory: constructorArgumentsFromInitCode(getSecurityPoolFactoryByteCode(addresses), statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
	}
}

type BootstrapDescendantAddresses = {
	[id: string]: Address
	escalationGameProofVerifier: Address
	sharedPoolPriceFeedCreationCodeFirstChunk: Address
	sharedPoolPriceFeedCreationCodeSecondChunk: Address
	questionLedgerCreationCodeFirstChunk: Address
	questionLedgerCreationCodeSecondChunk: Address
	securityPoolCommitmentIndexImplementation: Address
	securityPoolCapitalLifecycleDelegate: Address
	securityPoolCapitalRepairAuctionDelegate: Address
	securityPoolCapitalFeeStreamsImplementation: Address
	questionLedgerDeployer: Address
}

export function getBootstrapDescendantAddresses(profile: NetworkProfile = getRuntimeNetworkProfile()): BootstrapDescendantAddresses {
	const infrastructure = getInfraContractAddresses(profile)
	const questionLedgerDeployer = getCreateAddress({ from: infrastructure.securityPoolFactory, nonce: 1n })
	return {
		sharedPoolPriceFeedCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.sharedPoolPriceFeedDeploymentWorker, nonce: 1n }),
		sharedPoolPriceFeedCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.sharedPoolPriceFeedDeploymentWorker, nonce: 2n }),
		escalationGameCreationCodePartOne: getCreateAddress({ from: infrastructure.escalationGameFactory, nonce: 2n }),
		escalationGameCreationCodePartTwo: getCreateAddress({ from: infrastructure.escalationGameFactory, nonce: 3n }),
		escalationGameProofVerifier: infrastructure.escalationGameProofVerifier,
		questionLedgerDeployer,
		questionLedgerCreationCodeFirstChunk: getCreateAddress({ from: questionLedgerDeployer, nonce: 1n }),
		questionLedgerCreationCodeSecondChunk: getCreateAddress({ from: questionLedgerDeployer, nonce: 2n }),
		securityPoolCapitalCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.securityPoolCapitalLedgerDeployer, nonce: 1n }),
		securityPoolCapitalCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.securityPoolCapitalLedgerDeployer, nonce: 2n }),
		securityPoolCommitmentIndexImplementation: getCreateAddress({ from: infrastructure.securityPoolCommitmentIndexDeployer, nonce: 1n }),
		securityPoolCapitalLifecycleDelegate: getCreateAddress({ from: infrastructure.securityPoolCapitalLedgerDeployer, nonce: 3n }),
		securityPoolCapitalRepairAuctionDelegate: getCreateAddress({ from: infrastructure.securityPoolCapitalFeeStreamsDeployer, nonce: 1n }),
		securityPoolCapitalFeeStreamsImplementation: getCreateAddress({ from: infrastructure.securityPoolCapitalFeeStreamsDeployer, nonce: 2n }),
		securityPoolServicesCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.securityPoolServicesDeployer, nonce: 1n }),
		securityPoolServicesCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.securityPoolServicesDeployer, nonce: 2n }),
		securityPoolSettlementBookCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.securityPoolSettlementBookDeployer, nonce: 1n }),
		securityPoolSettlementBookCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.securityPoolSettlementBookDeployer, nonce: 2n }),
		securityPoolForkCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.securityPoolForkCoordinatorDeployer, nonce: 1n }),
		securityPoolAuctionCreationCodeFirstChunk: getCreateAddress({ from: infrastructure.securityPoolRepairAuctionDeployer, nonce: 1n }),
		securityPoolForkCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.securityPoolForkCoordinatorDeployer, nonce: 2n }),
		securityPoolAuctionCreationCodeSecondChunk: getCreateAddress({ from: infrastructure.securityPoolRepairAuctionDeployer, nonce: 2n }),
	}
}

export function getOpenOracleAddress() {
	return getInfraContractAddresses().openOracle
}

type SecurityPoolModuleId =
	| 'securityPoolCapitalLedgerDeployer'
	| 'securityPoolCommitmentIndexDeployer'
	| 'securityPoolCapitalFeeStreamsDeployer'
	| 'securityPoolSettlementBookDeployer'
	| 'securityPoolSettlementDeployer'
	| 'securityPoolServicesDeployer'
	| 'securityPoolReporterLedgerDeployer'
	| 'securityPoolForkCoordinatorDeployer'
	| 'securityPoolRepairAuctionDeployer'
type SecurityPoolModuleDeployment = { id: SecurityPoolModuleId; label: string; bytecode: typeof getSecurityPoolCapitalLedgerDeployerByteCode; artifact: { evm: { deployedBytecode: { object: string; immutableReferences: Readonly<Record<string, readonly { start: number; length: number }[]>> } } } }
export const securityPoolModuleDeployments: readonly SecurityPoolModuleDeployment[] = [
	{ id: 'securityPoolCapitalLedgerDeployer', label: deploymentCopy.poolCapitalDeployment, artifact: statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalLedgerDeployer, bytecode: getSecurityPoolCapitalLedgerDeployerByteCode },
	{ id: 'securityPoolCommitmentIndexDeployer', label: deploymentCopy.poolCommitmentDeployment, artifact: statoblast_SecurityPoolModuleDeployers_SecurityPoolCommitmentIndexDeployer, bytecode: getSecurityPoolCommitmentIndexDeployerByteCode },
	{ id: 'securityPoolCapitalFeeStreamsDeployer', label: deploymentCopy.poolFeesDeployment, artifact: statoblast_SecurityPoolModuleDeployers_SecurityPoolCapitalFeeStreamsDeployer, bytecode: getSecurityPoolCapitalFeeStreamsDeployerByteCode },
	{ id: 'securityPoolSettlementBookDeployer', label: deploymentCopy.poolPayoutDataDeployment, artifact: statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementBookDeployer, bytecode: getSecurityPoolSettlementBookDeployerByteCode },
	{ id: 'securityPoolSettlementDeployer', label: deploymentCopy.poolPayoutDeployment, artifact: statoblast_SecurityPoolModuleDeployers_SecurityPoolSettlementDeployer, bytecode: getSecurityPoolSettlementDeployerByteCode },
	{ id: 'securityPoolServicesDeployer', label: deploymentCopy.poolOperationsDeployment, artifact: statoblast_SecurityPoolModuleDeployers_SecurityPoolServicesDeployer, bytecode: getSecurityPoolServicesDeployerByteCode },
	{ id: 'securityPoolReporterLedgerDeployer', label: deploymentCopy.poolReportingDeployment, artifact: statoblast_SecurityPoolModuleDeployers_SecurityPoolReporterLedgerDeployer, bytecode: getSecurityPoolReporterLedgerDeployerByteCode },
	{ id: 'securityPoolForkCoordinatorDeployer', label: deploymentCopy.poolForkDeployment, artifact: statoblast_SecurityPoolForkCoordinator_SecurityPoolForkCoordinatorDeployer, bytecode: getSecurityPoolForkCoordinatorDeployerByteCode },
	{ id: 'securityPoolRepairAuctionDeployer', label: deploymentCopy.repairAuctionDeployment, artifact: statoblast_SecurityPoolRepairAuction_SecurityPoolRepairAuctionDeployer, bytecode: getSecurityPoolRepairAuctionDeployerByteCode },
] as const

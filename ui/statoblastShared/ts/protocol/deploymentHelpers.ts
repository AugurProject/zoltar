import { getCreateAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { constructorArgumentsFromInitCode } from '@zoltar/core-shared/deployment/deploymentAddresses'
import type { DeploymentStepId } from '@zoltar/ui-core-shared/types/contracts.js'
import { createStatoblastInitCodes } from '@zoltar/statoblast-shared/deployment/initCodes'
import { statoblast_Multicall3_Multicall3 } from '@zoltar/ui-core-shared/contractArtifact.js'
import {
	statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate,
	statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate,
	statoblast_SecurityPoolForker_SecurityPoolForker,
	statoblast_SecurityPoolUtils_SecurityPoolUtils,
	statoblast_factories_EscalationGameFactory_EscalationGameFactory,
	statoblast_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory,
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
		escalationGameFactory: statoblast_factories_EscalationGameFactory_EscalationGameFactory,
		multicall3: statoblast_Multicall3_Multicall3,
		openOracle: statoblast_openOracle_OpenOracle_OpenOracle,
		priceOracleManagerAndOperatorQueuerFactory: statoblast_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory,
		securityPoolFactory: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory,
		securityPoolForker: statoblast_SecurityPoolForker_SecurityPoolForker,
		securityPoolOperationsDelegate: statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate,
		securityPoolUtils: statoblast_SecurityPoolUtils_SecurityPoolUtils,
		shareTokenFactory: statoblast_factories_ShareTokenFactory_ShareTokenFactory,
		uniformPriceDualCapBatchAuctionFactory: statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory,
	},
	{ proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS, zeroSalt: ZERO_SALT },
)

export const { getEscalationGameFactoryByteCode, getPriceOracleManagerAndOperatorQueuerFactoryByteCode, getSecurityPoolFactoryByteCode, getSecurityPoolForkerByteCode, getSecurityPoolOperationsDelegateByteCode, getShareTokenFactoryByteCode } = statoblastInitCodes

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
		securityPoolOperationsDelegate: constructorArgumentsFromInitCode(getSecurityPoolOperationsDelegateByteCode(), statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate.evm.bytecode.object),
		openOracle: '',
		shareTokenFactory: constructorArgumentsFromInitCode(getShareTokenFactoryByteCode(addresses.zoltar), statoblast_factories_ShareTokenFactory_ShareTokenFactory.evm.bytecode.object),
		priceOracleManagerAndOperatorQueuerFactory: constructorArgumentsFromInitCode(getPriceOracleManagerAndOperatorQueuerFactoryByteCode(profile.wethAddress), statoblast_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object),
		securityPoolForker: constructorArgumentsFromInitCode(getSecurityPoolForkerByteCode(addresses.zoltar), statoblast_SecurityPoolForker_SecurityPoolForker.evm.bytecode.object),
		escalationGameClaimDelegate: '',
		escalationGameFactory: constructorArgumentsFromInitCode(getEscalationGameFactoryByteCode(addresses.escalationGameClaimDelegate), statoblast_factories_EscalationGameFactory_EscalationGameFactory.evm.bytecode.object),
		securityPoolFactory: constructorArgumentsFromInitCode(getSecurityPoolFactoryByteCode(addresses), statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
	}
}

type BootstrapDescendantAddresses = {
	[id: string]: Address
	escalationGameProofVerifier: Address
	liquidationApprovalRegistryDeployer: Address
	liquidationApprovalRegistryImplementation: Address
	priceCoordinatorCreationCodeFirstChunk: Address
	priceCoordinatorCreationCodeSecondChunk: Address
	priceCoordinatorDeploymentWorker: Address
	securityPoolCreationCodeFirstChunk: Address
	securityPoolCreationCodeSecondChunk: Address
	securityPoolDeployer: Address
	securityPoolDeploymentWorker: Address
}

export function getBootstrapDescendantAddresses(profile: NetworkProfile = getRuntimeNetworkProfile()): BootstrapDescendantAddresses {
	const infrastructure = getInfraContractAddresses(profile)
	const liquidationApprovalRegistryDeployer = getCreateAddress({ from: infrastructure.priceOracleManagerAndOperatorQueuerFactory, nonce: 1n })
	const priceCoordinatorDeploymentWorker = getCreateAddress({ from: infrastructure.priceOracleManagerAndOperatorQueuerFactory, nonce: 2n })
	const securityPoolDeployer = getCreateAddress({ from: infrastructure.securityPoolFactory, nonce: 1n })
	const securityPoolDeploymentWorker = getCreateAddress({ from: securityPoolDeployer, nonce: 2n })
	return {
		liquidationApprovalRegistryDeployer,
		liquidationApprovalRegistryImplementation: getCreateAddress({ from: liquidationApprovalRegistryDeployer, nonce: 1n }),
		priceCoordinatorDeploymentWorker,
		priceCoordinatorCreationCodeFirstChunk: getCreateAddress({ from: priceCoordinatorDeploymentWorker, nonce: 1n }),
		priceCoordinatorCreationCodeSecondChunk: getCreateAddress({ from: priceCoordinatorDeploymentWorker, nonce: 2n }),
		escalationGameCreationCodePartOne: getCreateAddress({ from: infrastructure.escalationGameFactory, nonce: 2n }),
		escalationGameCreationCodePartTwo: getCreateAddress({ from: infrastructure.escalationGameFactory, nonce: 3n }),
		escalationGameProofVerifier: infrastructure.escalationGameProofVerifier,
		securityPoolDeployer,
		securityPoolDeploymentWorker,
		securityPoolCreationCodeFirstChunk: getCreateAddress({ from: securityPoolDeploymentWorker, nonce: 1n }),
		securityPoolCreationCodeSecondChunk: getCreateAddress({ from: securityPoolDeploymentWorker, nonce: 2n }),
		securityPoolEventEmitter: getCreateAddress({ from: securityPoolDeployer, nonce: 1n }),
		securityPoolForkerEscalationGameForkerDelegate: getCreateAddress({ from: infrastructure.securityPoolForker, nonce: 2n }),
		securityPoolForkerEventEmitter: getCreateAddress({ from: infrastructure.securityPoolForker, nonce: 3n }),
		securityPoolForkerVaultMigrationDelegate: getCreateAddress({ from: infrastructure.securityPoolForker, nonce: 1n }),
	}
}

export function getOpenOracleAddress() {
	return getInfraContractAddresses().openOracle
}

import { concatHex, encodeAbiParameters, encodeDeployData, getCreate2Address, getCreateAddress, keccak256, toHex, type Address } from '@zoltar/shared/ethereum'
import { OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_FEE_PERCENTAGE, ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_MULTIPLIER, ORACLE_PROTOCOL_FEE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE } from '@zoltar/shared/oracleInitialReport'
import { createApplyLinkedLibrariesHelper, createInfraContractAddressHelper } from '@zoltar/shared/deploymentAddresses'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/shared/protocolConfig'
import {
	ScalarOutcomes_ScalarOutcomes,
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
} from '@zoltar/ui-core-shared/contractArtifact.js'
import { getWethAddress } from './activeProtocolAddresses.js'
import { getRuntimeNetworkProfile, type NetworkProfile } from '@zoltar/ui-core-shared/lib/networkProfile.js'
import { getZoltarContractAddresses, MULTICALL3_BYTECODE, PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from './zoltarDeploymentHelpers.js'

export { OPEN_ORACLE_SECURITY_MULTIPLIER_BPS, ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE } from '@zoltar/shared/oracleInitialReport'
export { getZoltarAddress, getZoltarInitCode, getZoltarQuestionDataByteCode, MULTICALL3_BYTECODE, PROXY_DEPLOYER_ADDRESS, ZERO_SALT } from './zoltarDeploymentHelpers.js'
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

const getSecurityPoolUtilsAddress = () =>
	getCreate2Address({
		bytecode: `0x${statoblast_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`,
		from: PROXY_DEPLOYER_ADDRESS,
		salt: ZERO_SALT,
	})

const getScalarOutcomesAddress = () =>
	getCreate2Address({
		bytecode: `0x${ScalarOutcomes_ScalarOutcomes.evm.bytecode.object}`,
		from: PROXY_DEPLOYER_ADDRESS,
		salt: ZERO_SALT,
	})

const { applyLibraries } = createApplyLinkedLibrariesHelper(() => [
	{
		hash: keccak256(toHex('contracts/ScalarOutcomes.sol:ScalarOutcomes')).slice(2, 36),
		address: getScalarOutcomesAddress(),
	},
	{
		hash: keccak256(toHex('contracts/statoblast/SecurityPoolUtils.sol:SecurityPoolUtils')).slice(2, 36),
		address: getSecurityPoolUtilsAddress(),
	},
])

export const getShareTokenFactoryByteCode = (zoltarAddress: Address) =>
	encodeDeployData({
		abi: statoblast_factories_ShareTokenFactory_ShareTokenFactory.abi,
		bytecode: `0x${statoblast_factories_ShareTokenFactory_ShareTokenFactory.evm.bytecode.object}`,
		args: [zoltarAddress],
	})

export const getEscalationGameFactoryByteCode = (claimDelegate: Address) =>
	encodeDeployData({
		abi: statoblast_factories_EscalationGameFactory_EscalationGameFactory.abi,
		bytecode: `0x${statoblast_factories_EscalationGameFactory_EscalationGameFactory.evm.bytecode.object}`,
		args: [claimDelegate],
	})

export const getPriceOracleManagerAndOperatorQueuerFactoryByteCode = (wethAddress = getWethAddress()) =>
	concatHex([
		applyLibraries(statoblast_factories_PriceOracleManagerAndOperatorQueuerFactory_PriceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object),
		encodeAbiParameters(
			[
				{ type: 'address' },
				{ type: 'uint256' },
				{ type: 'uint32' },
				{ type: 'uint256' },
				{ type: 'uint256' },
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
				wethAddress,
				ORACLE_REPORT_GAS,
				ORACLE_SETTLEMENT_GAS,
				ORACLE_GAS_UNITS_FOR_ONE_DISPUTE,
				ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
				OPEN_ORACLE_SECURITY_MULTIPLIER_BPS,
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

export const getSecurityPoolForkerByteCode = (zoltarAddress: Address) =>
	encodeDeployData({
		abi: statoblast_SecurityPoolForker_SecurityPoolForker.abi,
		bytecode: applyLibraries(statoblast_SecurityPoolForker_SecurityPoolForker.evm.bytecode.object),
		args: [zoltarAddress],
	})

export const getSecurityPoolOperationsDelegateByteCode = () => applyLibraries(statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate.evm.bytecode.object)

export const getSecurityPoolOperationsDelegateRuntimeCode = () => applyLibraries(statoblast_SecurityPoolOperationsDelegate_SecurityPoolOperationsDelegate.evm.deployedBytecode.object)

export const getSecurityPoolFactoryByteCode = ({
	escalationGameFactory,
	openOracle,
	priceOracleManagerAndOperatorQueuerFactory,
	securityPoolForker,
	securityPoolOperationsDelegate,
	shareTokenFactory,
	uniformPriceDualCapBatchAuctionFactory,
	zoltar,
	zoltarQuestionData,
}: {
	escalationGameFactory: Address
	openOracle: Address
	priceOracleManagerAndOperatorQueuerFactory: Address
	securityPoolForker: Address
	securityPoolOperationsDelegate: Address
	shareTokenFactory: Address
	uniformPriceDualCapBatchAuctionFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}) =>
	(() => {
		return encodeDeployData({
			abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			bytecode: applyLibraries(statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.evm.bytecode.object),
			args: [
				securityPoolForker,
				zoltarQuestionData,
				escalationGameFactory,
				openOracle,
				zoltar,
				shareTokenFactory,
				uniformPriceDualCapBatchAuctionFactory,
				priceOracleManagerAndOperatorQueuerFactory,
				DEFAULT_PROTOCOL_CONFIG.initialEscalationGameDepositAttoRep,
				DEFAULT_PROTOCOL_CONFIG.minimumSecurityBondDebtAttoEth,
				DEFAULT_PROTOCOL_CONFIG.minimumVaultRepDepositAttoRep,
				securityPoolOperationsDelegate,
			],
		})
	})()

export function getInfraContractAddresses(profile: NetworkProfile = getRuntimeNetworkProfile()) {
	const zoltarAddresses = getZoltarContractAddresses(profile)
	return createInfraContractAddressHelper({
		escalationGameClaimDelegateBytecode: `0x${statoblast_EscalationGameClaimDelegate_EscalationGameClaimDelegate.evm.bytecode.object}`,
		getEscalationGameFactoryByteCode,
		getSecurityPoolFactoryByteCode,
		getSecurityPoolForkerByteCode,
		getShareTokenFactoryByteCode,
		getZoltarAddress: () => zoltarAddresses.zoltar,
		getZoltarQuestionDataAddress: () => zoltarAddresses.zoltarQuestionData,
		multicall3Bytecode: MULTICALL3_BYTECODE,
		openOracleBytecode: `0x${statoblast_openOracle_OpenOracle_OpenOracle.evm.bytecode.object}`,
		priceOracleManagerAndOperatorQueuerFactoryBytecode: () => getPriceOracleManagerAndOperatorQueuerFactoryByteCode(profile.wethAddress),
		proxyDeployerAddress: PROXY_DEPLOYER_ADDRESS,
		scalarOutcomesBytecode: `0x${ScalarOutcomes_ScalarOutcomes.evm.bytecode.object}`,
		securityPoolUtilsBytecode: `0x${statoblast_SecurityPoolUtils_SecurityPoolUtils.evm.bytecode.object}`,
		securityPoolOperationsDelegateBytecode: getSecurityPoolOperationsDelegateByteCode(),
		uniformPriceDualCapBatchAuctionFactoryBytecode: `0x${statoblast_factories_UniformPriceDualCapBatchAuctionFactory_UniformPriceDualCapBatchAuctionFactory.evm.bytecode.object}`,
		zeroSalt: ZERO_SALT,
	}).getInfraContractAddresses()
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

export function getMulticall3Address() {
	return getZoltarContractAddresses().multicall3
}

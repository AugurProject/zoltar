import { concatHex, encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256, toHex, type Abi, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { createApplyLinkedLibrariesHelper } from '@zoltar/core-shared/deployment/deploymentAddresses'
import { DEFAULT_PROTOCOL_CONFIG } from '@zoltar/core-shared/deployment/protocolConfig'
import {
	OPEN_ORACLE_SECURITY_MULTIPLIER_BPS,
	ORACLE_DISPUTE_DELAY,
	ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
	ORACLE_FEE_PERCENTAGE,
	ORACLE_GAS_UNITS_FOR_ONE_DISPUTE,
	ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
	ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
	ORACLE_MULTIPLIER,
	ORACLE_PROTOCOL_FEE,
	ORACLE_PROTOCOL_FEE_RECIPIENT,
	ORACLE_REPORT_GAS,
	ORACLE_SETTLEMENT_GAS,
	ORACLE_SETTLEMENT_TIME,
	ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
	ORACLE_TIME_TYPE,
	ORACLE_TRACK_DISPUTES,
} from '../initialReport/oracleInitialReport.js'
import { createInfraContractAddressHelper } from './deploymentAddresses.js'

const SECURITY_POOL_UTILS_LIBRARY = 'contracts/statoblast/SecurityPoolUtils.sol:SecurityPoolUtils'

// Constructor parameters shared by the price coordinator and its factory, after their gas parameters.
const ORACLE_SETTLEMENT_PARAMETER_TYPES = [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint48' }, { type: 'uint24' }, { type: 'uint24' }, { type: 'uint24' }, { type: 'uint16' }, { type: 'bool' }, { type: 'bool' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }] as const
const ORACLE_SETTLEMENT_PARAMETERS = [
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
] as const

/** ABI-encoded PriceOracleManagerAndOperatorQueuerFactory constructor arguments. */
function encodePriceOracleManagerAndOperatorQueuerFactoryArguments(weth: Address): Hex {
	return encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'uint32' }, { type: 'uint256' }, ...ORACLE_SETTLEMENT_PARAMETER_TYPES], [weth, ORACLE_REPORT_GAS, ORACLE_SETTLEMENT_GAS, ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, ...ORACLE_SETTLEMENT_PARAMETERS])
}

type PriceCoordinatorArguments = {
	initialReportPriorityFeeAttoEthPerGas: bigint
	openOracle: Address
	repToken: Address
	weth: Address
}

/** @internal ABI-encoded OpenOraclePriceCoordinator constructor arguments; the contract simulator derives price coordinator addresses from them. */
export function encodeOpenOraclePriceCoordinatorArguments({ initialReportPriorityFeeAttoEthPerGas, openOracle, repToken, weth }: PriceCoordinatorArguments): Hex {
	return encodeAbiParameters(
		[{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint32' }, { type: 'uint256' }, { type: 'uint256' }, ...ORACLE_SETTLEMENT_PARAMETER_TYPES],
		[openOracle, repToken, weth, ORACLE_REPORT_GAS, ORACLE_SETTLEMENT_GAS, ORACLE_GAS_UNITS_FOR_ONE_DISPUTE, initialReportPriorityFeeAttoEthPerGas, ...ORACLE_SETTLEMENT_PARAMETERS],
	)
}

type BytecodeArtifact = Readonly<{ evm: Readonly<{ bytecode: Readonly<{ object: string }> }> }>
type ContractArtifact = BytecodeArtifact & Readonly<{ abi: Abi }>

/** Compiled artifacts for the proxy-deployed statoblast infrastructure; callers supply them from their own artifact module. */
type StatoblastInfrastructureArtifacts = {
	escalationGameClaimDelegate: BytecodeArtifact
	escalationGameFactory: ContractArtifact
	multicall3: BytecodeArtifact
	openOracle: BytecodeArtifact
	priceOracleManagerAndOperatorQueuerFactory: BytecodeArtifact
	securityPoolFactory: ContractArtifact
	securityPoolForker: ContractArtifact
	securityPoolOperationsDelegate: BytecodeArtifact
	securityPoolUtils: BytecodeArtifact
	shareTokenFactory: ContractArtifact
	uniformPriceDualCapBatchAuctionFactory: BytecodeArtifact
}

type SecurityPoolFactoryInputs = {
	escalationGameFactory: Address
	openOracle: Address
	priceOracleManagerAndOperatorQueuerFactory: Address
	securityPoolForker: Address
	securityPoolOperationsDelegate: Address
	shareTokenFactory: Address
	uniformPriceDualCapBatchAuctionFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}

type ZoltarAddressSources = {
	getZoltarAddress: () => Address
	getZoltarQuestionDataAddress: () => Address
}

const bytecodeOf = (artifact: BytecodeArtifact): Hex => `0x${artifact.evm.bytecode.object}`

/** Init-code builders for the statoblast infrastructure, deployed through the CREATE2 proxy deployer. */
export function createStatoblastInitCodes(artifacts: StatoblastInfrastructureArtifacts, { proxyDeployerAddress, zeroSalt }: { proxyDeployerAddress: Address; zeroSalt: Hex }) {
	const getSecurityPoolUtilsAddress = () => getCreate2Address({ bytecode: bytecodeOf(artifacts.securityPoolUtils), from: proxyDeployerAddress, salt: zeroSalt })
	const { applyLibraries } = createApplyLinkedLibrariesHelper(() => [{ hash: keccak256(toHex(SECURITY_POOL_UTILS_LIBRARY)).slice(2, 36), address: getSecurityPoolUtilsAddress() }])

	const getShareTokenFactoryByteCode = (zoltar: Address) => encodeDeployData({ abi: artifacts.shareTokenFactory.abi, bytecode: bytecodeOf(artifacts.shareTokenFactory), args: [zoltar] })
	const getEscalationGameFactoryByteCode = (claimDelegate: Address) => encodeDeployData({ abi: artifacts.escalationGameFactory.abi, bytecode: bytecodeOf(artifacts.escalationGameFactory), args: [claimDelegate] })
	const getPriceOracleManagerAndOperatorQueuerFactoryByteCode = (weth: Address) => concatHex([applyLibraries(artifacts.priceOracleManagerAndOperatorQueuerFactory.evm.bytecode.object), encodePriceOracleManagerAndOperatorQueuerFactoryArguments(weth)])
	const getSecurityPoolForkerByteCode = (zoltar: Address) => encodeDeployData({ abi: artifacts.securityPoolForker.abi, bytecode: applyLibraries(artifacts.securityPoolForker.evm.bytecode.object), args: [zoltar] })
	const getSecurityPoolOperationsDelegateByteCode = () => applyLibraries(artifacts.securityPoolOperationsDelegate.evm.bytecode.object)
	const getSecurityPoolFactoryByteCode = (inputs: SecurityPoolFactoryInputs) =>
		encodeDeployData({
			abi: artifacts.securityPoolFactory.abi,
			bytecode: applyLibraries(artifacts.securityPoolFactory.evm.bytecode.object),
			args: [
				inputs.securityPoolForker,
				inputs.zoltarQuestionData,
				inputs.escalationGameFactory,
				inputs.openOracle,
				inputs.zoltar,
				inputs.shareTokenFactory,
				inputs.uniformPriceDualCapBatchAuctionFactory,
				inputs.priceOracleManagerAndOperatorQueuerFactory,
				DEFAULT_PROTOCOL_CONFIG.minimumSecurityBondDebtAttoEth,
				DEFAULT_PROTOCOL_CONFIG.minimumVaultRepDepositAttoRep,
				inputs.securityPoolOperationsDelegate,
			],
		})

	/** CREATE2 addresses of every infrastructure contract for one WETH deployment and Zoltar core. */
	const createInfraContractAddresses = (weth: Address, zoltar: ZoltarAddressSources) =>
		createInfraContractAddressHelper({
			escalationGameClaimDelegateBytecode: bytecodeOf(artifacts.escalationGameClaimDelegate),
			getEscalationGameFactoryByteCode,
			getSecurityPoolFactoryByteCode,
			getSecurityPoolForkerByteCode,
			getShareTokenFactoryByteCode,
			getZoltarAddress: zoltar.getZoltarAddress,
			getZoltarQuestionDataAddress: zoltar.getZoltarQuestionDataAddress,
			multicall3Bytecode: bytecodeOf(artifacts.multicall3),
			openOracleBytecode: bytecodeOf(artifacts.openOracle),
			priceOracleManagerAndOperatorQueuerFactoryBytecode: () => getPriceOracleManagerAndOperatorQueuerFactoryByteCode(weth),
			proxyDeployerAddress,
			securityPoolUtilsBytecode: bytecodeOf(artifacts.securityPoolUtils),
			securityPoolOperationsDelegateBytecode: getSecurityPoolOperationsDelegateByteCode(),
			uniformPriceDualCapBatchAuctionFactoryBytecode: bytecodeOf(artifacts.uniformPriceDualCapBatchAuctionFactory),
			zeroSalt,
		}).getInfraContractAddresses

	return {
		applyLibraries,
		createInfraContractAddresses,
		getEscalationGameFactoryByteCode,
		getPriceOracleManagerAndOperatorQueuerFactoryByteCode,
		getSecurityPoolFactoryByteCode,
		getSecurityPoolForkerByteCode,
		getSecurityPoolOperationsDelegateByteCode,
		getShareTokenFactoryByteCode,
	}
}

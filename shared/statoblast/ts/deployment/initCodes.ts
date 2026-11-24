import { concatHex, encodeAbiParameters, encodeDeployData, getCreate2Address, keccak256, type Abi, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import {
	ORACLE_DISPUTE_DELAY,
	ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
	ORACLE_FEE_PERCENTAGE,
	ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
	ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
	ORACLE_MULTIPLIER,
	ORACLE_PROTOCOL_FEE,
	ORACLE_PROTOCOL_FEE_RECIPIENT,
	ORACLE_SETTLEMENT_TIME,
	ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
} from '../initialReport/oracleInitialReport.js'
import { createInfraContractAddressHelper } from './deploymentAddresses.js'

// Constructor parameters shared by the price coordinator and its factory, after their gas parameters.
const ORACLE_SETTLEMENT_PARAMETER_TYPES = [{ type: 'uint256' }, { type: 'uint48' }, { type: 'uint24' }, { type: 'uint24' }, { type: 'uint24' }, { type: 'uint16' }, { type: 'address' }, { type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }] as const
const ORACLE_SETTLEMENT_PARAMETERS = [
	ORACLE_TARGET_PRICE_ERROR_FOR_DISPUTE,
	ORACLE_SETTLEMENT_TIME,
	ORACLE_DISPUTE_DELAY,
	ORACLE_PROTOCOL_FEE,
	ORACLE_FEE_PERCENTAGE,
	ORACLE_MULTIPLIER,
	ORACLE_PROTOCOL_FEE_RECIPIENT,
	ORACLE_ESCALATION_HALT_MULTIPLIER_BPS,
	ORACLE_MAX_SETTLEMENT_BASE_FEE_MULTIPLIER_BPS,
	ORACLE_MIN_LIQUIDATION_PRICE_DISTANCE_BPS,
] as const

/** ABI-encoded OpenOraclePriceCoordinatorFactory constructor arguments. */
function encodeOpenOraclePriceCoordinatorFactoryArguments(weth: Address, coordinatorWorker: Address, feedWorker: Address): Hex {
	return encodeAbiParameters([{ type: 'address' }, ...ORACLE_SETTLEMENT_PARAMETER_TYPES, { type: 'address' }, { type: 'address' }], [weth, ...ORACLE_SETTLEMENT_PARAMETERS, coordinatorWorker, feedWorker])
}

type PriceCoordinatorArguments = {
	initialReportPriorityFeeAttoEthPerGas: bigint
	openOracle: Address
	repToken: Address
	weth: Address
	reportDelegate: Address
}

/** @internal ABI-encoded OpenOraclePriceCoordinator constructor arguments; the contract simulator derives price coordinator addresses from them. */
export function encodeOpenOraclePriceCoordinatorArguments({ initialReportPriorityFeeAttoEthPerGas, openOracle, repToken, weth, reportDelegate }: PriceCoordinatorArguments): Hex {
	return encodeAbiParameters([{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }, ...ORACLE_SETTLEMENT_PARAMETER_TYPES, { type: 'address' }], [openOracle, repToken, weth, initialReportPriorityFeeAttoEthPerGas, ...ORACLE_SETTLEMENT_PARAMETERS, reportDelegate])
}

type BytecodeArtifact = Readonly<{ evm: Readonly<{ bytecode: Readonly<{ object: string }> }> }>
type ContractArtifact = BytecodeArtifact & Readonly<{ abi: Abi }>

/** Compiled artifacts for the proxy-deployed statoblast infrastructure; callers supply them from their own artifact module. */
type StatoblastInfrastructureArtifacts = {
	escalationGameDepositDelegate: BytecodeArtifact
	escalationGameFactory: ContractArtifact
	multicall3: BytecodeArtifact
	openOracle: BytecodeArtifact
	openOraclePriceCoordinatorFactory: BytecodeArtifact
	priceCoordinatorDeploymentWorker: BytecodeArtifact
	sharedPoolPriceFeedDeploymentWorker: BytecodeArtifact
	securityPoolFactory: ContractArtifact
	securityPool: BytecodeArtifact
	questionForker: ContractArtifact
	questionForkerDelegate: ContractArtifact
	questionLedgerOperationsDelegate: BytecodeArtifact
	questionLedgerEventEmitter: BytecodeArtifact
	securityPoolCapitalLedgerDeployer: BytecodeArtifact
	securityPoolCommitmentIndexDeployer: BytecodeArtifact
	securityPoolCapitalFeeStreamsDeployer: BytecodeArtifact
	securityPoolSettlementBookDeployer: BytecodeArtifact
	securityPoolSettlementDeployer: BytecodeArtifact
	securityPoolServicesDeployer: BytecodeArtifact
	securityPoolReporterLedgerDeployer: BytecodeArtifact
	securityPoolForkCoordinatorDeployer: BytecodeArtifact
	securityPoolRepairAuctionDeployer: BytecodeArtifact
	shareTokenFactory: ContractArtifact
}

type SecurityPoolFactoryInputs = {
	escalationGameFactory: Address
	openOracle: Address
	openOraclePriceCoordinatorFactory: Address
	questionForker: Address
	questionLedgerOperationsDelegate: Address
	questionLedgerEventEmitter: Address
	securityPoolCapitalLedgerDeployer: Address
	securityPoolCommitmentIndexDeployer: Address
	securityPoolCapitalFeeStreamsDeployer: Address
	securityPoolSettlementBookDeployer: Address
	securityPoolSettlementDeployer: Address
	securityPoolReporterLedgerDeployer: Address
	securityPoolForkCoordinatorDeployer: Address
	securityPoolServicesDeployer: Address
	securityPoolRepairAuctionDeployer: Address
	shareTokenFactory: Address
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
	const getShareTokenFactoryByteCode = (zoltar: Address) => encodeDeployData({ abi: artifacts.shareTokenFactory.abi, bytecode: bytecodeOf(artifacts.shareTokenFactory), args: [zoltar] })
	const getEscalationGameFactoryByteCode = (depositDelegate: Address) => encodeDeployData({ abi: artifacts.escalationGameFactory.abi, bytecode: bytecodeOf(artifacts.escalationGameFactory), args: [depositDelegate] })
	const getPriceCoordinatorDeploymentWorkerByteCode = (): Hex => `0x${artifacts.priceCoordinatorDeploymentWorker.evm.bytecode.object}`
	const getSharedPoolPriceFeedDeploymentWorkerByteCode = (): Hex => `0x${artifacts.sharedPoolPriceFeedDeploymentWorker.evm.bytecode.object}`
	const getWorkerAddress = (bytecode: Hex) => getCreate2Address({ bytecode, from: proxyDeployerAddress, salt: zeroSalt })
	const getOpenOraclePriceCoordinatorFactoryByteCode = (weth: Address) =>
		concatHex([`0x${artifacts.openOraclePriceCoordinatorFactory.evm.bytecode.object}`, encodeOpenOraclePriceCoordinatorFactoryArguments(weth, getWorkerAddress(getPriceCoordinatorDeploymentWorkerByteCode()), getWorkerAddress(getSharedPoolPriceFeedDeploymentWorkerByteCode()))])
	const getQuestionForkerDelegateByteCode = (zoltar: Address) => encodeDeployData({ abi: artifacts.questionForkerDelegate.abi, bytecode: `0x${artifacts.questionForkerDelegate.evm.bytecode.object}`, args: [zoltar] })
	const getQuestionForkerByteCode = (zoltar: Address) => encodeDeployData({ abi: artifacts.questionForker.abi, bytecode: `0x${artifacts.questionForker.evm.bytecode.object}`, args: [zoltar, getWorkerAddress(getQuestionForkerDelegateByteCode(zoltar))] })
	const getQuestionLedgerAccountingModuleByteCode = (): Hex => `0x${artifacts.questionLedgerEventEmitter.evm.bytecode.object}`
	const getQuestionLedgerOperationsDelegateByteCode = (): Hex => `0x${artifacts.questionLedgerOperationsDelegate.evm.bytecode.object}`
	const getSecurityPoolCapitalLedgerDeployerByteCode = (): Hex => `0x${artifacts.securityPoolCapitalLedgerDeployer.evm.bytecode.object}`
	const getSecurityPoolCommitmentIndexDeployerByteCode = (): Hex => `0x${artifacts.securityPoolCommitmentIndexDeployer.evm.bytecode.object}`
	const getSecurityPoolCapitalFeeStreamsDeployerByteCode = (): Hex => `0x${artifacts.securityPoolCapitalFeeStreamsDeployer.evm.bytecode.object}`
	const getSecurityPoolSettlementBookDeployerByteCode = (): Hex => `0x${artifacts.securityPoolSettlementBookDeployer.evm.bytecode.object}`
	const getSecurityPoolSettlementDeployerByteCode = (): Hex => `0x${artifacts.securityPoolSettlementDeployer.evm.bytecode.object}`
	const getSecurityPoolServicesDeployerByteCode = (): Hex => `0x${artifacts.securityPoolServicesDeployer.evm.bytecode.object}`
	const getSecurityPoolReporterLedgerDeployerByteCode = (): Hex => `0x${artifacts.securityPoolReporterLedgerDeployer.evm.bytecode.object}`
	const getSecurityPoolForkCoordinatorDeployerByteCode = (): Hex => `0x${artifacts.securityPoolForkCoordinatorDeployer.evm.bytecode.object}`
	const getSecurityPoolRepairAuctionDeployerByteCode = (): Hex => `0x${artifacts.securityPoolRepairAuctionDeployer.evm.bytecode.object}`
	/** The only security pool creation code the factory deploys; its hash is a factory constructor argument. */
	const getSecurityPoolCreationCode = (): Hex => `0x${artifacts.securityPool.evm.bytecode.object}`
	const getSecurityPoolFactoryByteCode = (inputs: SecurityPoolFactoryInputs) =>
		encodeDeployData({
			abi: artifacts.securityPoolFactory.abi,
			bytecode: `0x${artifacts.securityPoolFactory.evm.bytecode.object}`,
			args: [
				inputs.questionForker,
				inputs.zoltarQuestionData,
				inputs.escalationGameFactory,
				inputs.openOracle,
				inputs.zoltar,
				inputs.shareTokenFactory,
				inputs.openOraclePriceCoordinatorFactory,
				inputs.questionLedgerOperationsDelegate,
				inputs.questionLedgerEventEmitter,
				keccak256(getSecurityPoolCreationCode()),
				// The order is the security pool constructor's module deployer order.
				[
					inputs.securityPoolCapitalLedgerDeployer,
					inputs.securityPoolCommitmentIndexDeployer,
					inputs.securityPoolCapitalFeeStreamsDeployer,
					inputs.securityPoolSettlementBookDeployer,
					inputs.securityPoolSettlementDeployer,
					inputs.securityPoolReporterLedgerDeployer,
					inputs.securityPoolForkCoordinatorDeployer,
					inputs.securityPoolServicesDeployer,
					inputs.securityPoolRepairAuctionDeployer,
				],
			],
		})

	/** CREATE2 addresses of every infrastructure contract for one WETH deployment and Zoltar core. */
	const createInfraContractAddresses = (weth: Address, zoltar: ZoltarAddressSources) =>
		createInfraContractAddressHelper({
			escalationGameDepositDelegateBytecode: bytecodeOf(artifacts.escalationGameDepositDelegate),
			getEscalationGameFactoryByteCode,
			getSecurityPoolFactoryByteCode,
			getQuestionForkerByteCode,
			getQuestionForkerDelegateByteCode,
			getShareTokenFactoryByteCode,
			getZoltarAddress: zoltar.getZoltarAddress,
			getZoltarQuestionDataAddress: zoltar.getZoltarQuestionDataAddress,
			multicall3Bytecode: bytecodeOf(artifacts.multicall3),
			openOracleBytecode: bytecodeOf(artifacts.openOracle),
			openOraclePriceCoordinatorFactoryBytecode: () => getOpenOraclePriceCoordinatorFactoryByteCode(weth),
			priceCoordinatorDeploymentWorkerBytecode: getPriceCoordinatorDeploymentWorkerByteCode(),
			sharedPoolPriceFeedDeploymentWorkerBytecode: getSharedPoolPriceFeedDeploymentWorkerByteCode(),
			proxyDeployerAddress,
			questionLedgerOperationsDelegateBytecode: getQuestionLedgerOperationsDelegateByteCode(),
			questionLedgerEventEmitterBytecode: getQuestionLedgerAccountingModuleByteCode(),
			securityPoolCapitalLedgerDeployerBytecode: getSecurityPoolCapitalLedgerDeployerByteCode(),
			securityPoolCommitmentIndexDeployerBytecode: getSecurityPoolCommitmentIndexDeployerByteCode(),
			securityPoolCapitalFeeStreamsDeployerBytecode: getSecurityPoolCapitalFeeStreamsDeployerByteCode(),
			securityPoolSettlementBookDeployerBytecode: getSecurityPoolSettlementBookDeployerByteCode(),
			securityPoolSettlementDeployerBytecode: getSecurityPoolSettlementDeployerByteCode(),
			securityPoolServicesDeployerBytecode: getSecurityPoolServicesDeployerByteCode(),
			securityPoolReporterLedgerDeployerBytecode: getSecurityPoolReporterLedgerDeployerByteCode(),
			securityPoolForkCoordinatorDeployerBytecode: getSecurityPoolForkCoordinatorDeployerByteCode(),
			securityPoolRepairAuctionDeployerBytecode: getSecurityPoolRepairAuctionDeployerByteCode(),
			zeroSalt,
		}).getInfraContractAddresses

	return {
		createInfraContractAddresses,
		getEscalationGameFactoryByteCode,
		getOpenOraclePriceCoordinatorFactoryByteCode,
		getPriceCoordinatorDeploymentWorkerByteCode,
		getSharedPoolPriceFeedDeploymentWorkerByteCode,
		getSecurityPoolFactoryByteCode,
		getSecurityPoolCreationCode,
		getQuestionForkerByteCode,
		getQuestionForkerDelegateByteCode,
		getQuestionLedgerOperationsDelegateByteCode,
		getQuestionLedgerAccountingModuleByteCode,
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
	}
}

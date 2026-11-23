import { getCreateAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getProxyDeployerCreate2Address } from '@zoltar/core-shared/deployment/deploymentAddresses'

type SecurityPoolFactoryAddressInputs = {
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
	securityPoolAuctionDeployer: Address
	shareTokenFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}

type InfraContractAddressConfig = {
	escalationGameDepositDelegateBytecode: Hex
	getEscalationGameFactoryByteCode: (depositDelegate: Address) => Hex
	getSecurityPoolFactoryByteCode: (inputs: SecurityPoolFactoryAddressInputs) => Hex
	getQuestionForkerByteCode: (zoltarAddress: Address) => Hex
	getQuestionForkerDelegateByteCode: (zoltarAddress: Address) => Hex
	getShareTokenFactoryByteCode: (zoltarAddress: Address) => Hex
	multicall3Bytecode: Hex
	openOracleBytecode: Hex
	openOraclePriceCoordinatorFactoryBytecode: () => Hex
	priceCoordinatorDeploymentWorkerBytecode: Hex
	sharedPoolPriceFeedDeploymentWorkerBytecode: Hex
	proxyDeployerAddress: Address
	questionLedgerOperationsDelegateBytecode: Hex
	questionLedgerEventEmitterBytecode: Hex
	securityPoolCapitalLedgerDeployerBytecode: Hex
	securityPoolCommitmentIndexDeployerBytecode: Hex
	securityPoolCapitalFeeStreamsDeployerBytecode: Hex
	securityPoolSettlementBookDeployerBytecode: Hex
	securityPoolSettlementDeployerBytecode: Hex
	securityPoolServicesDeployerBytecode: Hex
	securityPoolReporterLedgerDeployerBytecode: Hex
	securityPoolForkCoordinatorDeployerBytecode: Hex
	securityPoolAuctionDeployerBytecode: Hex
	zeroSalt: Hex
	getZoltarAddress: () => Address
	getZoltarQuestionDataAddress: () => Address
}

type InfraContractAddresses = {
	escalationGameFactory: Address
	escalationGameProofVerifier: Address
	escalationGameDepositDelegate: Address
	multicall3: Address
	openOracle: Address
	openOraclePriceCoordinatorFactory: Address
	priceCoordinatorDeploymentWorker: Address
	sharedPoolPriceFeedDeploymentWorker: Address
	securityPoolFactory: Address
	questionForker: Address
	questionForkerDelegate: Address
	questionLedgerOperationsDelegate: Address
	questionLedgerEventEmitter: Address
	securityPoolCapitalLedgerDeployer: Address
	securityPoolCommitmentIndexDeployer: Address
	securityPoolCapitalFeeStreamsDeployer: Address
	securityPoolSettlementBookDeployer: Address
	securityPoolSettlementDeployer: Address
	securityPoolServicesDeployer: Address
	securityPoolReporterLedgerDeployer: Address
	securityPoolForkCoordinatorDeployer: Address
	securityPoolAuctionDeployer: Address
	shareTokenFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}

export function createInfraContractAddressHelper(config: InfraContractAddressConfig) {
	const getInfraContractAddresses = (): InfraContractAddresses => {
		const addresses = {
			multicall3: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.multicall3Bytecode),
			securityPoolCapitalLedgerDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolCapitalLedgerDeployerBytecode),
			securityPoolCommitmentIndexDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolCommitmentIndexDeployerBytecode),
			securityPoolCapitalFeeStreamsDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolCapitalFeeStreamsDeployerBytecode),
			securityPoolSettlementBookDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolSettlementBookDeployerBytecode),
			securityPoolSettlementDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolSettlementDeployerBytecode),
			securityPoolServicesDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolServicesDeployerBytecode),
			securityPoolReporterLedgerDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolReporterLedgerDeployerBytecode),
			securityPoolForkCoordinatorDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolForkCoordinatorDeployerBytecode),
			securityPoolAuctionDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolAuctionDeployerBytecode),
			openOracle: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.openOracleBytecode),
			zoltarQuestionData: config.getZoltarQuestionDataAddress(),
			zoltar: config.getZoltarAddress(),
			shareTokenFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getShareTokenFactoryByteCode(config.getZoltarAddress())),
			priceCoordinatorDeploymentWorker: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.priceCoordinatorDeploymentWorkerBytecode),
			sharedPoolPriceFeedDeploymentWorker: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.sharedPoolPriceFeedDeploymentWorkerBytecode),
			openOraclePriceCoordinatorFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.openOraclePriceCoordinatorFactoryBytecode()),
			questionForkerDelegate: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getQuestionForkerDelegateByteCode(config.getZoltarAddress())),
			questionForker: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getQuestionForkerByteCode(config.getZoltarAddress())),
			escalationGameDepositDelegate: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.escalationGameDepositDelegateBytecode),
		}
		const escalationGameFactory = getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getEscalationGameFactoryByteCode(addresses.escalationGameDepositDelegate))
		const questionLedgerEventEmitter = getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.questionLedgerEventEmitterBytecode)
		const questionLedgerOperationsDelegate = getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.questionLedgerOperationsDelegateBytecode)
		const escalationGameProofVerifier = getCreateAddress({
			from: escalationGameFactory,
			nonce: 1n,
		})

		return {
			...addresses,
			escalationGameFactory,
			escalationGameProofVerifier,
			questionLedgerOperationsDelegate,
			questionLedgerEventEmitter,
			securityPoolFactory: getProxyDeployerCreate2Address(
				config.proxyDeployerAddress,
				config.zeroSalt,
				config.getSecurityPoolFactoryByteCode({
					escalationGameFactory,
					openOracle: addresses.openOracle,
					openOraclePriceCoordinatorFactory: addresses.openOraclePriceCoordinatorFactory,
					questionForker: addresses.questionForker,
					questionLedgerOperationsDelegate,
					questionLedgerEventEmitter,
					securityPoolCapitalLedgerDeployer: addresses.securityPoolCapitalLedgerDeployer,
					securityPoolCommitmentIndexDeployer: addresses.securityPoolCommitmentIndexDeployer,
					securityPoolCapitalFeeStreamsDeployer: addresses.securityPoolCapitalFeeStreamsDeployer,
					securityPoolSettlementBookDeployer: addresses.securityPoolSettlementBookDeployer,
					securityPoolSettlementDeployer: addresses.securityPoolSettlementDeployer,
					securityPoolReporterLedgerDeployer: addresses.securityPoolReporterLedgerDeployer,
					securityPoolForkCoordinatorDeployer: addresses.securityPoolForkCoordinatorDeployer,
					securityPoolServicesDeployer: addresses.securityPoolServicesDeployer,
					securityPoolAuctionDeployer: addresses.securityPoolAuctionDeployer,
					shareTokenFactory: addresses.shareTokenFactory,
					zoltar: addresses.zoltar,
					zoltarQuestionData: addresses.zoltarQuestionData,
				}),
			),
		}
	}

	return {
		getInfraContractAddresses,
	}
}

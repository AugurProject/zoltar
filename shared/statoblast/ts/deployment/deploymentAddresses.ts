import { getCreateAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getProxyDeployerCreate2Address } from '@zoltar/core-shared/deployment/deploymentAddresses'

type SecurityPoolFactoryAddressInputs = {
	escalationGameFactory: Address
	openOracle: Address
	sharedPoolPriceFeedFactory: Address
	questionForker: Address
	questionLedgerDelegate: Address
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

type InfraContractAddressConfig = {
	escalationGameDepositDelegateBytecode: Hex
	getEscalationGameFactoryByteCode: (depositDelegate: Address) => Hex
	getSecurityPoolFactoryByteCode: (inputs: SecurityPoolFactoryAddressInputs) => Hex
	getQuestionForkerByteCode: (zoltarAddress: Address) => Hex
	getShareTokenFactoryByteCode: (zoltarAddress: Address) => Hex
	multicall3Bytecode: Hex
	openOracleBytecode: Hex
	sharedPoolPriceFeedFactoryBytecode: () => Hex
	sharedPoolPriceFeedDeploymentWorkerBytecode: Hex
	proxyDeployerAddress: Address
	questionLedgerDelegateBytecode: Hex
	securityPoolCapitalLedgerDeployerBytecode: Hex
	securityPoolCommitmentIndexDeployerBytecode: Hex
	securityPoolCapitalFeeStreamsDeployerBytecode: Hex
	securityPoolSettlementBookDeployerBytecode: Hex
	securityPoolSettlementDeployerBytecode: Hex
	securityPoolServicesDeployerBytecode: Hex
	securityPoolReporterLedgerDeployerBytecode: Hex
	securityPoolForkCoordinatorDeployerBytecode: Hex
	securityPoolRepairAuctionDeployerBytecode: Hex
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
	sharedPoolPriceFeedFactory: Address
	sharedPoolPriceFeedDeploymentWorker: Address
	securityPoolFactory: Address
	questionForker: Address
	questionLedgerDelegate: Address
	securityPoolCapitalLedgerDeployer: Address
	securityPoolCommitmentIndexDeployer: Address
	securityPoolCapitalFeeStreamsDeployer: Address
	securityPoolSettlementBookDeployer: Address
	securityPoolSettlementDeployer: Address
	securityPoolServicesDeployer: Address
	securityPoolReporterLedgerDeployer: Address
	securityPoolForkCoordinatorDeployer: Address
	securityPoolRepairAuctionDeployer: Address
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
			securityPoolRepairAuctionDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolRepairAuctionDeployerBytecode),
			openOracle: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.openOracleBytecode),
			zoltarQuestionData: config.getZoltarQuestionDataAddress(),
			zoltar: config.getZoltarAddress(),
			shareTokenFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getShareTokenFactoryByteCode(config.getZoltarAddress())),
			sharedPoolPriceFeedDeploymentWorker: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.sharedPoolPriceFeedDeploymentWorkerBytecode),
			sharedPoolPriceFeedFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.sharedPoolPriceFeedFactoryBytecode()),
			questionForker: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getQuestionForkerByteCode(config.getZoltarAddress())),
			escalationGameDepositDelegate: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.escalationGameDepositDelegateBytecode),
		}
		const escalationGameFactory = getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getEscalationGameFactoryByteCode(addresses.escalationGameDepositDelegate))
		const questionLedgerDelegate = getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.questionLedgerDelegateBytecode)
		const escalationGameProofVerifier = getCreateAddress({
			from: escalationGameFactory,
			nonce: 1n,
		})

		return {
			...addresses,
			escalationGameFactory,
			escalationGameProofVerifier,
			questionLedgerDelegate,
			securityPoolFactory: getProxyDeployerCreate2Address(
				config.proxyDeployerAddress,
				config.zeroSalt,
				config.getSecurityPoolFactoryByteCode({
					escalationGameFactory,
					openOracle: addresses.openOracle,
					sharedPoolPriceFeedFactory: addresses.sharedPoolPriceFeedFactory,
					questionForker: addresses.questionForker,
					questionLedgerDelegate,
					securityPoolCapitalLedgerDeployer: addresses.securityPoolCapitalLedgerDeployer,
					securityPoolCommitmentIndexDeployer: addresses.securityPoolCommitmentIndexDeployer,
					securityPoolCapitalFeeStreamsDeployer: addresses.securityPoolCapitalFeeStreamsDeployer,
					securityPoolSettlementBookDeployer: addresses.securityPoolSettlementBookDeployer,
					securityPoolSettlementDeployer: addresses.securityPoolSettlementDeployer,
					securityPoolReporterLedgerDeployer: addresses.securityPoolReporterLedgerDeployer,
					securityPoolForkCoordinatorDeployer: addresses.securityPoolForkCoordinatorDeployer,
					securityPoolServicesDeployer: addresses.securityPoolServicesDeployer,
					securityPoolRepairAuctionDeployer: addresses.securityPoolRepairAuctionDeployer,
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

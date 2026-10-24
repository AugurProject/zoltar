import { getCreateAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getProxyDeployerCreate2Address } from '@zoltar/core-shared/deployment/deploymentAddresses'

type SecurityPoolFactoryAddressInputs = {
	escalationGameFactory: Address
	openOracle: Address
	openOraclePriceCoordinatorFactory: Address
	securityPoolForker: Address
	securityPoolOperationsDelegate: Address
	securityPoolEventEmitter: Address
	shareTokenFactory: Address
	uniformPriceDualCapBatchAuctionFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}

type InfraContractAddressConfig = {
	escalationGameClaimDelegateBytecode: Hex
	escalationGameDepositDelegateBytecode: Hex
	getEscalationGameFactoryByteCode: (claimDelegate: Address, depositDelegate: Address) => Hex
	getSecurityPoolFactoryByteCode: (inputs: SecurityPoolFactoryAddressInputs) => Hex
	getSecurityPoolForkerByteCode: (zoltarAddress: Address) => Hex
	getSecurityPoolForkerPortfolioDelegateByteCode: (zoltarAddress: Address) => Hex
	getShareTokenFactoryByteCode: (zoltarAddress: Address) => Hex
	multicall3Bytecode: Hex
	openOracleBytecode: Hex
	openOraclePriceCoordinatorFactoryBytecode: () => Hex
	priceCoordinatorDeploymentWorkerBytecode: Hex
	sharedPoolPriceFeedDeploymentWorkerBytecode: Hex
	proxyDeployerAddress: Address
	securityPoolUtilsBytecode: Hex
	securityPoolOperationsDelegateBytecode: Hex
	securityPoolEventEmitterBytecode: Hex
	securityPoolCapitalLedgerDeployerBytecode: Hex
	securityPoolCommitmentIndexDeployerBytecode: Hex
	securityPoolCapitalFeeStreamsDeployerBytecode: Hex
	securityPoolSettlementBookDeployerBytecode: Hex
	securityPoolPortfolioSettlementDeployerBytecode: Hex
	securityPoolReporterLedgerDeployerBytecode: Hex
	securityPoolPortfolioRecapAuctionDeployerBytecode: Hex
	securityPoolPortfolioForkCoordinatorDeployerBytecode: Hex
	uniformPriceDualCapBatchAuctionFactoryBytecode: Hex
	zeroSalt: Hex
	getZoltarAddress: () => Address
	getZoltarQuestionDataAddress: () => Address
}

type InfraContractAddresses = {
	escalationGameClaimDelegate: Address
	escalationGameFactory: Address
	escalationGameProofVerifier: Address
	escalationGameDepositDelegate: Address
	multicall3: Address
	openOracle: Address
	openOraclePriceCoordinatorFactory: Address
	priceCoordinatorDeploymentWorker: Address
	sharedPoolPriceFeedDeploymentWorker: Address
	securityPoolFactory: Address
	securityPoolForker: Address
	securityPoolForkerPortfolioDelegate: Address
	securityPoolOperationsDelegate: Address
	securityPoolEventEmitter: Address
	securityPoolUtils: Address
	securityPoolCapitalLedgerDeployer: Address
	securityPoolCommitmentIndexDeployer: Address
	securityPoolCapitalFeeStreamsDeployer: Address
	securityPoolSettlementBookDeployer: Address
	securityPoolPortfolioSettlementDeployer: Address
	securityPoolReporterLedgerDeployer: Address
	securityPoolPortfolioRecapAuctionDeployer: Address
	securityPoolPortfolioForkCoordinatorDeployer: Address
	shareTokenFactory: Address
	uniformPriceDualCapBatchAuctionFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}

export function createInfraContractAddressHelper(config: InfraContractAddressConfig) {
	const getInfraContractAddresses = (): InfraContractAddresses => {
		const addresses = {
			multicall3: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.multicall3Bytecode),
			securityPoolUtils: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolUtilsBytecode),
			securityPoolCapitalLedgerDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolCapitalLedgerDeployerBytecode),
			securityPoolCommitmentIndexDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolCommitmentIndexDeployerBytecode),
			securityPoolCapitalFeeStreamsDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolCapitalFeeStreamsDeployerBytecode),
			securityPoolSettlementBookDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolSettlementBookDeployerBytecode),
			securityPoolPortfolioSettlementDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolPortfolioSettlementDeployerBytecode),
			securityPoolReporterLedgerDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolReporterLedgerDeployerBytecode),
			securityPoolPortfolioRecapAuctionDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolPortfolioRecapAuctionDeployerBytecode),
			securityPoolPortfolioForkCoordinatorDeployer: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolPortfolioForkCoordinatorDeployerBytecode),
			openOracle: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.openOracleBytecode),
			zoltarQuestionData: config.getZoltarQuestionDataAddress(),
			zoltar: config.getZoltarAddress(),
			shareTokenFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getShareTokenFactoryByteCode(config.getZoltarAddress())),
			priceCoordinatorDeploymentWorker: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.priceCoordinatorDeploymentWorkerBytecode),
			sharedPoolPriceFeedDeploymentWorker: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.sharedPoolPriceFeedDeploymentWorkerBytecode),
			openOraclePriceCoordinatorFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.openOraclePriceCoordinatorFactoryBytecode()),
			securityPoolForkerPortfolioDelegate: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getSecurityPoolForkerPortfolioDelegateByteCode(config.getZoltarAddress())),
			securityPoolForker: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getSecurityPoolForkerByteCode(config.getZoltarAddress())),
			escalationGameClaimDelegate: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.escalationGameClaimDelegateBytecode),
			escalationGameDepositDelegate: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.escalationGameDepositDelegateBytecode),
			uniformPriceDualCapBatchAuctionFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.uniformPriceDualCapBatchAuctionFactoryBytecode),
		}
		const escalationGameFactory = getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getEscalationGameFactoryByteCode(addresses.escalationGameClaimDelegate, addresses.escalationGameDepositDelegate))
		const securityPoolEventEmitter = getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolEventEmitterBytecode)
		const securityPoolOperationsDelegate = getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolOperationsDelegateBytecode)
		const escalationGameProofVerifier = getCreateAddress({
			from: escalationGameFactory,
			nonce: 1n,
		})

		return {
			...addresses,
			escalationGameFactory,
			escalationGameProofVerifier,
			securityPoolOperationsDelegate,
			securityPoolEventEmitter,
			securityPoolFactory: getProxyDeployerCreate2Address(
				config.proxyDeployerAddress,
				config.zeroSalt,
				config.getSecurityPoolFactoryByteCode({
					escalationGameFactory,
					openOracle: addresses.openOracle,
					openOraclePriceCoordinatorFactory: addresses.openOraclePriceCoordinatorFactory,
					securityPoolForker: addresses.securityPoolForker,
					securityPoolOperationsDelegate,
					securityPoolEventEmitter,
					shareTokenFactory: addresses.shareTokenFactory,
					uniformPriceDualCapBatchAuctionFactory: addresses.uniformPriceDualCapBatchAuctionFactory,
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

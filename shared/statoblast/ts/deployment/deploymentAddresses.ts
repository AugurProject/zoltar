import { getCreateAddress, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getProxyDeployerCreate2Address } from '@zoltar/core-shared/deployment/deploymentAddresses'

type SecurityPoolFactoryAddressInputs = {
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

type InfraContractAddressConfig = {
	escalationGameClaimDelegateBytecode: Hex
	getEscalationGameFactoryByteCode: (claimDelegate: Address) => Hex
	getSecurityPoolFactoryByteCode: (inputs: SecurityPoolFactoryAddressInputs) => Hex
	getSecurityPoolForkerByteCode: (zoltarAddress: Address) => Hex
	getShareTokenFactoryByteCode: (zoltarAddress: Address) => Hex
	multicall3Bytecode: Hex
	openOracleBytecode: Hex
	priceOracleManagerAndOperatorQueuerFactoryBytecode: () => Hex
	proxyDeployerAddress: Address
	scalarOutcomesBytecode: Hex
	securityPoolUtilsBytecode: Hex
	securityPoolOperationsDelegateBytecode: Hex
	uniformPriceDualCapBatchAuctionFactoryBytecode: Hex
	zeroSalt: Hex
	getZoltarAddress: () => Address
	getZoltarQuestionDataAddress: () => Address
}

type InfraContractAddresses = {
	escalationGameClaimDelegate: Address
	escalationGameFactory: Address
	escalationGameProofVerifier: Address
	multicall3: Address
	openOracle: Address
	priceOracleManagerAndOperatorQueuerFactory: Address
	scalarOutcomes: Address
	securityPoolFactory: Address
	securityPoolForker: Address
	securityPoolOperationsDelegate: Address
	securityPoolUtils: Address
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
			openOracle: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.openOracleBytecode),
			zoltarQuestionData: config.getZoltarQuestionDataAddress(),
			zoltar: config.getZoltarAddress(),
			shareTokenFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getShareTokenFactoryByteCode(config.getZoltarAddress())),
			priceOracleManagerAndOperatorQueuerFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.priceOracleManagerAndOperatorQueuerFactoryBytecode()),
			securityPoolForker: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getSecurityPoolForkerByteCode(config.getZoltarAddress())),
			escalationGameClaimDelegate: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.escalationGameClaimDelegateBytecode),
			scalarOutcomes: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.scalarOutcomesBytecode),
			uniformPriceDualCapBatchAuctionFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.uniformPriceDualCapBatchAuctionFactoryBytecode),
		}
		const escalationGameFactory = getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getEscalationGameFactoryByteCode(addresses.escalationGameClaimDelegate))
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
			securityPoolFactory: getProxyDeployerCreate2Address(
				config.proxyDeployerAddress,
				config.zeroSalt,
				config.getSecurityPoolFactoryByteCode({
					escalationGameFactory,
					openOracle: addresses.openOracle,
					priceOracleManagerAndOperatorQueuerFactory: addresses.priceOracleManagerAndOperatorQueuerFactory,
					securityPoolForker: addresses.securityPoolForker,
					securityPoolOperationsDelegate,
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

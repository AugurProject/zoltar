import { getCreate2Address, type Address, type Hex } from 'viem'

type LibraryReplacement = {
	address: Address
	hash: string
}

type SecurityPoolFactoryAddressInputs = {
	escalationGameFactory: Address
	openOracle: Address
	priceOracleManagerAndOperatorQueuerFactory: Address
	securityPoolForker: Address
	shareTokenFactory: Address
	uniformPriceDualCapBatchAuctionFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}

type InfraContractAddressInputs = {
	getEscalationGameFactoryByteCode: () => Hex
	getSecurityPoolFactoryByteCode: (inputs: SecurityPoolFactoryAddressInputs) => Hex
	getSecurityPoolForkerByteCode: (zoltarAddress: Address) => Hex
	getShareTokenFactoryByteCode: (zoltarAddress: Address) => Hex
	openOracleBytecode: Hex
	priceOracleManagerAndOperatorQueuerFactoryBytecode: Hex
	proxyDeployerAddress: Address
	scalarOutcomesBytecode: Hex
	securityPoolUtilsBytecode: Hex
	uniformPriceDualCapBatchAuctionFactoryBytecode: Hex
	zeroSalt: Hex
	zoltar: Address
	zoltarQuestionData: Address
}

type DeploymentStatusOracleAddressInputs = {
	deploymentStatusOracleBytecode: Hex
	proxyDeployerAddress: Address
	zeroSalt: Hex
}

type ZoltarAddressInputs = {
	getZoltarInitCode: (zoltarQuestionDataAddress: Address) => Hex
	proxyDeployerAddress: Address
	zeroSalt: Hex
	zoltarQuestionDataAddress: Address
}

type ZoltarQuestionDataAddressInputs = {
	proxyDeployerAddress: Address
	zeroSalt: Hex
	zoltarQuestionDataBytecode: Hex
}

type DeploymentAddressConfig = {
	deploymentStatusOracleBytecode: () => Hex
	getEscalationGameFactoryByteCode: () => Hex
	getSecurityPoolFactoryByteCode: (inputs: SecurityPoolFactoryAddressInputs) => Hex
	getSecurityPoolForkerByteCode: (zoltarAddress: Address) => Hex
	getShareTokenFactoryByteCode: (zoltarAddress: Address) => Hex
	getZoltarInitCode: (zoltarQuestionDataAddress: Address) => Hex
	libraryReplacements: () => readonly LibraryReplacement[]
	openOracleBytecode: Hex
	priceOracleManagerAndOperatorQueuerFactoryBytecode: Hex
	proxyDeployerAddress: Address
	scalarOutcomesBytecode: Hex
	securityPoolUtilsBytecode: Hex
	uniformPriceDualCapBatchAuctionFactoryBytecode: Hex
	zeroSalt: Hex
	zoltarQuestionDataBytecode: () => Hex
}

export type InfraContractAddresses = {
	escalationGameFactory: Address
	openOracle: Address
	priceOracleManagerAndOperatorQueuerFactory: Address
	scalarOutcomes: Address
	securityPoolFactory: Address
	securityPoolForker: Address
	securityPoolUtils: Address
	shareTokenFactory: Address
	uniformPriceDualCapBatchAuctionFactory: Address
	zoltar: Address
	zoltarQuestionData: Address
}

function getProxyDeployerCreate2Address(proxyDeployerAddress: Address, zeroSalt: Hex, bytecode: Hex) {
	return getCreate2Address({
		bytecode,
		from: proxyDeployerAddress,
		salt: zeroSalt,
	})
}

export function applyLinkedLibraries(bytecode: string, replacements: readonly LibraryReplacement[]): Hex {
	let updatedBytecode = bytecode
	for (const { hash, address } of replacements) {
		updatedBytecode = updatedBytecode.replaceAll(`__$${hash}$__`, address.slice(2).toLowerCase())
	}
	return `0x${updatedBytecode}`
}

function getZoltarQuestionDataAddressBase({ proxyDeployerAddress, zeroSalt, zoltarQuestionDataBytecode }: ZoltarQuestionDataAddressInputs): Address {
	return getProxyDeployerCreate2Address(proxyDeployerAddress, zeroSalt, zoltarQuestionDataBytecode)
}

function getZoltarAddressBase({ getZoltarInitCode, proxyDeployerAddress, zeroSalt, zoltarQuestionDataAddress }: ZoltarAddressInputs): Address {
	return getProxyDeployerCreate2Address(proxyDeployerAddress, zeroSalt, getZoltarInitCode(zoltarQuestionDataAddress))
}

function getInfraContractAddressesBase({
	getEscalationGameFactoryByteCode,
	getSecurityPoolFactoryByteCode,
	getSecurityPoolForkerByteCode,
	getShareTokenFactoryByteCode,
	openOracleBytecode,
	priceOracleManagerAndOperatorQueuerFactoryBytecode,
	proxyDeployerAddress,
	scalarOutcomesBytecode,
	securityPoolUtilsBytecode,
	uniformPriceDualCapBatchAuctionFactoryBytecode,
	zeroSalt,
	zoltar,
	zoltarQuestionData,
}: InfraContractAddressInputs): InfraContractAddresses {
	const addresses = {
		securityPoolUtils: getProxyDeployerCreate2Address(proxyDeployerAddress, zeroSalt, securityPoolUtilsBytecode),
		openOracle: getProxyDeployerCreate2Address(proxyDeployerAddress, zeroSalt, openOracleBytecode),
		zoltarQuestionData,
		zoltar,
		shareTokenFactory: getProxyDeployerCreate2Address(proxyDeployerAddress, zeroSalt, getShareTokenFactoryByteCode(zoltar)),
		priceOracleManagerAndOperatorQueuerFactory: getProxyDeployerCreate2Address(proxyDeployerAddress, zeroSalt, priceOracleManagerAndOperatorQueuerFactoryBytecode),
		securityPoolForker: getProxyDeployerCreate2Address(proxyDeployerAddress, zeroSalt, getSecurityPoolForkerByteCode(zoltar)),
		escalationGameFactory: getProxyDeployerCreate2Address(proxyDeployerAddress, zeroSalt, getEscalationGameFactoryByteCode()),
		scalarOutcomes: getProxyDeployerCreate2Address(proxyDeployerAddress, zeroSalt, scalarOutcomesBytecode),
		uniformPriceDualCapBatchAuctionFactory: getProxyDeployerCreate2Address(proxyDeployerAddress, zeroSalt, uniformPriceDualCapBatchAuctionFactoryBytecode),
	}

	return {
		...addresses,
		securityPoolFactory: getProxyDeployerCreate2Address(
			proxyDeployerAddress,
			zeroSalt,
			getSecurityPoolFactoryByteCode({
				escalationGameFactory: addresses.escalationGameFactory,
				openOracle: addresses.openOracle,
				priceOracleManagerAndOperatorQueuerFactory: addresses.priceOracleManagerAndOperatorQueuerFactory,
				securityPoolForker: addresses.securityPoolForker,
				shareTokenFactory: addresses.shareTokenFactory,
				uniformPriceDualCapBatchAuctionFactory: addresses.uniformPriceDualCapBatchAuctionFactory,
				zoltar: addresses.zoltar,
				zoltarQuestionData: addresses.zoltarQuestionData,
			}),
		),
	}
}

function getDeploymentStatusOracleAddressBase({ deploymentStatusOracleBytecode, proxyDeployerAddress, zeroSalt }: DeploymentStatusOracleAddressInputs): Address {
	return getProxyDeployerCreate2Address(proxyDeployerAddress, zeroSalt, deploymentStatusOracleBytecode)
}

export function createDeploymentAddressHelpers(config: DeploymentAddressConfig) {
	const applyLinkedLibrariesToBytecode = (bytecode: string) => applyLinkedLibraries(bytecode, config.libraryReplacements())

	const getZoltarQuestionDataAddress = () =>
		getZoltarQuestionDataAddressBase({
			proxyDeployerAddress: config.proxyDeployerAddress,
			zeroSalt: config.zeroSalt,
			zoltarQuestionDataBytecode: config.zoltarQuestionDataBytecode(),
		})

	const getZoltarAddress = () =>
		getZoltarAddressBase({
			getZoltarInitCode: config.getZoltarInitCode,
			proxyDeployerAddress: config.proxyDeployerAddress,
			zeroSalt: config.zeroSalt,
			zoltarQuestionDataAddress: getZoltarQuestionDataAddress(),
		})

	const getInfraContractAddresses = () =>
		getInfraContractAddressesBase({
			getEscalationGameFactoryByteCode: config.getEscalationGameFactoryByteCode,
			getSecurityPoolFactoryByteCode: config.getSecurityPoolFactoryByteCode,
			getSecurityPoolForkerByteCode: config.getSecurityPoolForkerByteCode,
			getShareTokenFactoryByteCode: config.getShareTokenFactoryByteCode,
			openOracleBytecode: config.openOracleBytecode,
			priceOracleManagerAndOperatorQueuerFactoryBytecode: config.priceOracleManagerAndOperatorQueuerFactoryBytecode,
			proxyDeployerAddress: config.proxyDeployerAddress,
			scalarOutcomesBytecode: config.scalarOutcomesBytecode,
			securityPoolUtilsBytecode: config.securityPoolUtilsBytecode,
			uniformPriceDualCapBatchAuctionFactoryBytecode: config.uniformPriceDualCapBatchAuctionFactoryBytecode,
			zeroSalt: config.zeroSalt,
			zoltar: getZoltarAddress(),
			zoltarQuestionData: getZoltarQuestionDataAddress(),
		})

	const getDeploymentStatusOracleAddress = () =>
		getDeploymentStatusOracleAddressBase({
			deploymentStatusOracleBytecode: config.deploymentStatusOracleBytecode(),
			proxyDeployerAddress: config.proxyDeployerAddress,
			zeroSalt: config.zeroSalt,
		})

	return {
		applyLinkedLibraries: applyLinkedLibrariesToBytecode,
		getDeploymentStatusOracleAddress,
		getInfraContractAddresses,
		getZoltarAddress,
		getZoltarQuestionDataAddress,
	}
}

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

type ZoltarAddressConfig = {
	getZoltarInitCode: (zoltarQuestionDataAddress: Address) => Hex
	proxyDeployerAddress: Address
	zeroSalt: Hex
	zoltarQuestionDataBytecode: () => Hex
}

type InfraContractAddressConfig = {
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
	getZoltarAddress: () => Address
	getZoltarQuestionDataAddress: () => Address
}

type DeploymentStatusOracleAddressConfig = {
	deploymentStatusOracleBytecode: () => Hex
	proxyDeployerAddress: Address
	zeroSalt: Hex
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

export function createApplyLinkedLibrariesHelper(libraryReplacements: () => readonly LibraryReplacement[]) {
	const applyLibraries = (bytecode: string) => applyLinkedLibraries(bytecode, libraryReplacements())

	return {
		applyLibraries,
	}
}

export function createZoltarAddressHelpers(config: ZoltarAddressConfig) {
	const getZoltarQuestionDataAddress = () =>
		getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.zoltarQuestionDataBytecode())

	const getZoltarAddress = () =>
		getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getZoltarInitCode(getZoltarQuestionDataAddress()))

	return {
		getZoltarAddress,
		getZoltarQuestionDataAddress,
	}
}

export function createInfraContractAddressHelper(config: InfraContractAddressConfig) {
	const getInfraContractAddresses = (): InfraContractAddresses => {
		const addresses = {
			securityPoolUtils: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.securityPoolUtilsBytecode),
			openOracle: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.openOracleBytecode),
			zoltarQuestionData: config.getZoltarQuestionDataAddress(),
			zoltar: config.getZoltarAddress(),
			shareTokenFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getShareTokenFactoryByteCode(config.getZoltarAddress())),
			priceOracleManagerAndOperatorQueuerFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.priceOracleManagerAndOperatorQueuerFactoryBytecode),
			securityPoolForker: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getSecurityPoolForkerByteCode(config.getZoltarAddress())),
			escalationGameFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getEscalationGameFactoryByteCode()),
			scalarOutcomes: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.scalarOutcomesBytecode),
			uniformPriceDualCapBatchAuctionFactory: getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.uniformPriceDualCapBatchAuctionFactoryBytecode),
		}

		return {
			...addresses,
			securityPoolFactory: getProxyDeployerCreate2Address(
				config.proxyDeployerAddress,
				config.zeroSalt,
				config.getSecurityPoolFactoryByteCode({
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

	return {
		getInfraContractAddresses,
	}
}

export function createDeploymentStatusOracleAddressHelper(config: DeploymentStatusOracleAddressConfig) {
	const getDeploymentStatusOracleAddress = () =>
		getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.deploymentStatusOracleBytecode())

	return {
		getDeploymentStatusOracleAddress,
	}
}

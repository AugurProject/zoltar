import { getCreate2Address, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'

type LibraryReplacement = {
	address: Address
	hash: string
}

type DeploymentStatusOracleAddressConfig = {
	deploymentStatusOracleBytecode: () => Hex
	proxyDeployerAddress: Address
	zeroSalt: Hex
}

export function getProxyDeployerCreate2Address(proxyDeployerAddress: Address, zeroSalt: Hex, bytecode: Hex) {
	return getCreate2Address({
		bytecode,
		from: proxyDeployerAddress,
		salt: zeroSalt,
	})
}

function applyLinkedLibraries(bytecode: string, replacements: readonly LibraryReplacement[]): Hex {
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

export function createDeploymentStatusOracleAddressHelper(config: DeploymentStatusOracleAddressConfig) {
	const getDeploymentStatusOracleAddress = () => getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.deploymentStatusOracleBytecode())

	return {
		getDeploymentStatusOracleAddress,
	}
}

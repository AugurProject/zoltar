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

// Library linking replaces equal-length placeholders, so the compiled creation
// bytecode length still marks where appended constructor arguments begin.
export function constructorArgumentsFromInitCode(initCode: Hex, creationBytecode: string): string {
	if (initCode.length < 2 + creationBytecode.length) throw new Error('Init code is shorter than the compiled creation bytecode it should extend')
	return initCode.slice(2 + creationBytecode.length)
}

export function createDeploymentStatusOracleAddressHelper(config: DeploymentStatusOracleAddressConfig) {
	const getDeploymentStatusOracleAddress = () => getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.deploymentStatusOracleBytecode())

	return {
		getDeploymentStatusOracleAddress,
	}
}

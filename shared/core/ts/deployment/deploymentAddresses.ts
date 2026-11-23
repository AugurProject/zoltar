import { getCreate2Address, type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
export { CANONICAL_TRADING_FEE_BPS, tradingDeploymentData } from './tradingDeployment.js'

/** Runtime bytecode of the deterministic proxy deployer that every canonical deployment goes through. */
export const PROXY_DEPLOYER_RUNTIME_CODE = '0x60003681823780368234f58015156014578182fd5b80825250506014600cf3' satisfies Hex

export function zoltarDeploymentStatusStepAddresses(networkId: string, genesisRepToken: Address, addresses: Readonly<{ proxyDeployer: Address; multicall3: Address; zoltarQuestionData: Address; zoltar: Address }>) {
	return [addresses.proxyDeployer, ...(networkId === 'sepolia' ? [genesisRepToken] : []), addresses.multicall3, addresses.zoltarQuestionData, addresses.zoltar]
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

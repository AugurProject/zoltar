import { type Address, type Hex } from '@zoltar/core-shared/evm/ethereum'
import { getProxyDeployerCreate2Address } from '@zoltar/core-shared/deployment/deploymentAddresses'

type ZoltarAddressConfig = {
	getZoltarInitCode: (zoltarQuestionDataAddress: Address) => Hex
	proxyDeployerAddress: Address
	zeroSalt: Hex
	zoltarQuestionDataBytecode: () => Hex
}

export function createZoltarAddressHelpers(config: ZoltarAddressConfig) {
	const getZoltarQuestionDataAddress = () => getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.zoltarQuestionDataBytecode())

	const getZoltarAddress = () => getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getZoltarInitCode(getZoltarQuestionDataAddress()))

	return {
		getZoltarAddress,
		getZoltarQuestionDataAddress,
	}
}

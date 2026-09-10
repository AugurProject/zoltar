import { getProxyDeployerCreate2Address } from '@zoltar/core-shared/deployment/deploymentAddresses';
export function createZoltarAddressHelpers(config) {
    const getZoltarQuestionDataAddress = () => getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.zoltarQuestionDataBytecode());
    const getZoltarAddress = () => getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.getZoltarInitCode(getZoltarQuestionDataAddress()));
    return {
        getZoltarAddress,
        getZoltarQuestionDataAddress,
    };
}

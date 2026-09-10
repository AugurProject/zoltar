import { getCreate2Address } from '@zoltar/core-shared/evm/ethereum';
export function getProxyDeployerCreate2Address(proxyDeployerAddress, zeroSalt, bytecode) {
    return getCreate2Address({
        bytecode,
        from: proxyDeployerAddress,
        salt: zeroSalt,
    });
}
function applyLinkedLibraries(bytecode, replacements) {
    let updatedBytecode = bytecode;
    for (const { hash, address } of replacements) {
        updatedBytecode = updatedBytecode.replaceAll(`__$${hash}$__`, address.slice(2).toLowerCase());
    }
    return `0x${updatedBytecode}`;
}
export function createApplyLinkedLibrariesHelper(libraryReplacements) {
    const applyLibraries = (bytecode) => applyLinkedLibraries(bytecode, libraryReplacements());
    return {
        applyLibraries,
    };
}
export function createDeploymentStatusOracleAddressHelper(config) {
    const getDeploymentStatusOracleAddress = () => getProxyDeployerCreate2Address(config.proxyDeployerAddress, config.zeroSalt, config.deploymentStatusOracleBytecode());
    return {
        getDeploymentStatusOracleAddress,
    };
}

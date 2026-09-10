import { type Address, type Hex } from '@zoltar/core-shared/evm/ethereum';
type LibraryReplacement = {
    address: Address;
    hash: string;
};
type DeploymentStatusOracleAddressConfig = {
    deploymentStatusOracleBytecode: () => Hex;
    proxyDeployerAddress: Address;
    zeroSalt: Hex;
};
export declare function getProxyDeployerCreate2Address(proxyDeployerAddress: Address, zeroSalt: Hex, bytecode: Hex): `0x${string}`;
export declare function createApplyLinkedLibrariesHelper(libraryReplacements: () => readonly LibraryReplacement[]): {
    applyLibraries: (bytecode: string) => `0x${string}`;
};
export declare function createDeploymentStatusOracleAddressHelper(config: DeploymentStatusOracleAddressConfig): {
    getDeploymentStatusOracleAddress: () => `0x${string}`;
};
export {};

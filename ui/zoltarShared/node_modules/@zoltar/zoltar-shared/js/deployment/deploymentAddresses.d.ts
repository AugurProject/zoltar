import { type Address, type Hex } from '@zoltar/core-shared/evm/ethereum';
type ZoltarAddressConfig = {
    getZoltarInitCode: (zoltarQuestionDataAddress: Address) => Hex;
    proxyDeployerAddress: Address;
    zeroSalt: Hex;
    zoltarQuestionDataBytecode: () => Hex;
};
export declare function createZoltarAddressHelpers(config: ZoltarAddressConfig): {
    getZoltarAddress: () => `0x${string}`;
    getZoltarQuestionDataAddress: () => `0x${string}`;
};
export {};

import { type Address, type Hex } from '@zoltar/core-shared/evm/ethereum';
type RepTokenAddressConfig = {
    genesisRepTokenAddress: Address;
    getReputationTokenInitCode: (zoltarAddress: Address) => Hex;
    getZoltarAddress: () => Address;
};
export declare function createRepTokenAddressHelper(config: RepTokenAddressConfig): {
    getRepTokenAddress: (universeId: bigint) => `0x${string}`;
};
export {};

import { type Address, type Hash } from '@zoltar/shared/ethereum';
import { type Chain } from '@zoltar/shared/ethereum';
export type NetworkProfile = {
    chain: Chain;
    chainIdHex: string;
    displayName: string;
    genesisRepTokenAddress: Address;
    id: 'mainnet' | 'sepolia' | 'simulation';
    isSupportedAppChain: boolean;
    repPricingMode: 'unavailable' | 'uniswap' | 'mock';
    transactionExplorerBaseUrl?: string;
    uniswapPoolExplorerBaseUrl: string;
    uniswapV3FactoryAddress: Address;
    uniswapV3QuoterAddress: Address;
    uniswapV4QuoterAddress: Address;
    usdcAddress: Address;
    wethAddress: Address;
};
export declare const MAINNET_WETH_ADDRESS = "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2";
export declare const MAINNET_NETWORK_PROFILE: NetworkProfile;
export declare const SEPOLIA_NETWORK_PROFILE: NetworkProfile;
export declare function getPublicNetworkProfile(network: string | undefined): NetworkProfile;
export declare function getPublicNetworkProfileForChainId(chainId: string | undefined): NetworkProfile | undefined;
export declare function getNetworkSwitchTarget(profile: NetworkProfile): string;
export declare function getRuntimeNetworkProfile(): NetworkProfile;
export declare function setRuntimeNetworkProfile(profile: NetworkProfile): void;
export declare function resetRuntimeNetworkProfile(): void;
export declare function createSimulationProfile({ genesisRepTokenAddress, wethAddress }: {
    genesisRepTokenAddress: Address;
    wethAddress: Address;
}): NetworkProfile;
export declare function buildTransactionExplorerUrl(profile: NetworkProfile, hash: Hash): string | undefined;
export declare function formatTransactionNetworkLabel(profile: NetworkProfile): string;
//# sourceMappingURL=networkProfile.d.ts.map
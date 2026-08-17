import { type Address } from '@zoltar/shared/ethereum';
export type WalletAssetWatchResult = {
    status: 'accepted';
} | {
    status: 'declined';
} | {
    status: 'dismissed';
} | {
    status: 'failed';
} | {
    status: 'stale';
} | {
    status: 'unavailable';
} | {
    status: 'unsupported';
} | {
    status: 'wrong-network';
};
export type WalletAssetMetadata = {
    decimals: number;
    symbol: string;
};
export type WalletAssetRequest = {
    method: 'wallet_watchAsset';
    params: {
        options: {
            address: Address;
            decimals: number;
            symbol: string;
        };
        type: 'ERC20';
    };
};
type WalletAssetRequestDependencies = {
    expectedChainId: string;
    expectedAccount: Address;
    getActiveAccount: () => Promise<Address | undefined>;
    getActiveChainId: () => Promise<string>;
    isCurrent: () => boolean;
    readTokenMetadata: (address: Address) => Promise<WalletAssetMetadata>;
    request: (request: WalletAssetRequest) => Promise<unknown>;
};
export declare function normalizeWalletAssetFailure(_reason: unknown): WalletAssetWatchResult;
export declare function requestWalletWatchAsset(address: Address, dependencies: WalletAssetRequestDependencies): Promise<WalletAssetWatchResult>;
export declare function watchActiveWalletAsset(address: Address, expectedAccount: Address, isCurrent: () => boolean): Promise<WalletAssetWatchResult>;
export {};
//# sourceMappingURL=walletAsset.d.ts.map
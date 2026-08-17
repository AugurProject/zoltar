import type { Address } from '@zoltar/shared/ethereum';
export declare function getChainIdDecimalLabel(chainId: string | undefined): string | undefined;
export declare function getChainDisplayLabel(chainId: string | undefined): string | undefined;
export declare function getKnownChainName(chainId: string | undefined): string | undefined;
export declare function isSupportedAppChain(chainId: string | undefined): boolean;
export declare function isActiveAppChain(chainId: string | undefined): boolean;
export declare function getWalletScopedAccountAddress(accountAddress: Address | undefined, chainId: string | undefined): `0x${string}` | undefined;
export declare function getWrongNetworkMessage(): string | undefined;
//# sourceMappingURL=network.d.ts.map
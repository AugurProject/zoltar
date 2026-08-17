export declare const DEFAULT_RPC_URL = "https://ethereum.dark.florist";
export type ConfiguredRpcSource = 'default' | 'environment' | 'global' | 'localStorage' | 'override' | 'url';
type ConfiguredRpcOverrideSource = Exclude<ConfiguredRpcSource, 'default'>;
export type RejectedRpcOverride = {
    reason: string;
    source: ConfiguredRpcOverrideSource;
    url: string;
};
export type ConfiguredRpcConfig = {
    rejectedOverride?: RejectedRpcOverride | undefined;
    source: ConfiguredRpcSource;
    url: string;
};
type LocationLike = {
    hash?: string;
    search?: string;
};
type StorageLike = {
    getItem(key: string): string | null;
};
export declare function resolveConfiguredRpcConfig({ fallbackRpcUrl, location, overrideRpcUrl, storage }?: {
    fallbackRpcUrl?: string;
    location?: LocationLike;
    overrideRpcUrl?: string;
    storage?: StorageLike;
}): ConfiguredRpcConfig;
export declare function resolveConfiguredRpcUrl(options?: Parameters<typeof resolveConfiguredRpcConfig>[0]): string;
export {};
//# sourceMappingURL=rpcConfig.d.ts.map
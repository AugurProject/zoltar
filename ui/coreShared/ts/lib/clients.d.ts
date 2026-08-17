import type { Address } from '@zoltar/shared/ethereum';
import type { CreateWriteClientCallbacks } from './chainBackend.js';
export type { ReadClient, WriteClient } from './chainBackend.js';
export { normalizeAccount } from './chainBackend.js';
export declare function createConnectedReadClient(): import("@zoltar/shared/ethereum").PublicClient<{
    kind: "custom";
    provider: import("@zoltar/shared/ethereum").EIP1193Provider;
    requestScheduler?: import("@zoltar/shared/ethereum").RpcRequestScheduler | undefined;
    retryCount: number;
    retryDelay: number;
} | {
    kind: "http";
    fetchFn?: import("@zoltar/shared/ethereum").RpcFetchFn | undefined;
    requestTimeout: number;
    requestScheduler?: import("@zoltar/shared/ethereum").RpcRequestScheduler | undefined;
    responseParser?: import("@zoltar/shared/ethereum").RpcResponseParser | undefined;
    retryCount: number;
    retryDelay: number;
    url: string;
}, import("@zoltar/shared/ethereum").Chain | undefined>;
export declare function createWalletWriteClient(accountAddress: Address, callbacks?: CreateWriteClientCallbacks): import("./chainBackend.js").WriteClient;
//# sourceMappingURL=clients.d.ts.map
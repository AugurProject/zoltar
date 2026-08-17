import { createPublicClient, type Account, type Address, type Hash, type Hex, type PublicActions, type Transport, type WalletClient } from '@zoltar/shared/ethereum';
import { type InjectedEthereum } from '../injectedEthereum.js';
import { type NetworkProfile } from './networkProfile.js';
import { type ConfiguredRpcSource, type RejectedRpcOverride } from './rpcConfig.js';
export type ReadClient = ReturnType<typeof createPublicClient>;
export type WriteClient = WalletClient<Transport, NetworkProfile['chain'], Account> & PublicActions<Transport, NetworkProfile['chain']> & {
    assertCanonicalRawTransactionCost?: (signer: Address, costAttoEth: bigint) => void;
    installSimulationProxyDeployer?: (parameters: {
        address: Address;
        runtimeCode: Hex;
    }) => Promise<void>;
    onTransactionPrepared?: ((preview: TransactionRequestPreview) => void) | undefined;
    onTransactionSubmitted?: ((hash: Hash) => void) | undefined;
    patchSimulationGenesisRepToken?: (parameters: {
        repAddress: Address;
        zoltarAddress: Address;
    }) => Promise<void>;
    recordCanonicalFunding?: (signer: Address, amountAttoEth: bigint) => void;
    recordCanonicalRawTransaction?: (signer: Address, costAttoEth: bigint) => void;
    requiresWalletConfirmation?: boolean | undefined;
};
export type CreateWriteClientCallbacks = {
    onTransactionPrepared?: ((preview: TransactionRequestPreview) => void) | undefined;
    onTransactionSubmitted?: (hash: Hash) => void;
};
export type TransactionRequestPreview = {
    account: Account | Address | undefined;
    args: readonly unknown[] | undefined;
    chainName: string | undefined;
    contractAddress?: Address | undefined;
    contractLabel?: string | undefined;
    data?: Hex | undefined;
    dataLabel?: string | undefined;
    functionName: string;
    requiresWalletConfirmation?: boolean | undefined;
    to?: Address | undefined;
    toLabel?: string | undefined;
    value: bigint | undefined;
};
type ReadTransportMode = 'provider' | 'rpc';
export type ReadBackendStatus = {
    blockNumber: bigint | undefined;
    blockTimestamp: bigint | undefined;
    rejectedRpcOverride?: RejectedRpcOverride | undefined;
    rpcSource: ConfiguredRpcSource;
    rpcUrl: string;
    transportMode: ReadTransportMode;
};
export type ChainBackend = {
    bootstrapError: string | undefined;
    bootstrapLabel: string | undefined;
    bootstrapProgress: number | undefined;
    createReadClient(): ReadClient;
    createWriteClient(accountAddress: Address, callbacks?: CreateWriteClientCallbacks): WriteClient;
    currentTimestamp?: bigint;
    disconnectWallet?: () => Promise<void>;
    getAccounts(): Promise<readonly Address[]>;
    getChainId(): Promise<string>;
    getProvider(): InjectedEthereum | undefined;
    getReadBackendStatus?(): ReadBackendStatus;
    hasWallet(): boolean;
    id: 'injected' | 'simulation';
    isBootstrapped?: boolean;
    isBootstrapping?: boolean;
    profile: NetworkProfile;
    requestAccounts(): Promise<readonly Address[]>;
    requestAccountSelection?: () => Promise<readonly Address[]>;
    setReadBackendBlock?: (block: {
        number: bigint | undefined;
        timestamp: bigint | undefined;
    }) => void;
    setReadTransportMode?: (mode: ReadTransportMode) => void;
    subscribe: ((handler: () => void) => () => void) | undefined;
    subscribeAccountsChanged(handler: () => void): () => void;
    subscribeChainChanged(handler: () => void): () => void;
    switchNetwork?: () => Promise<void>;
    waitUntilReady?(): Promise<void>;
};
export declare function normalizeAccount(value: unknown): Address | undefined;
export declare function createInjectedBackend({ profile, rpcUrl }?: {
    profile?: NetworkProfile;
    rpcUrl?: string;
}): ChainBackend;
export {};
//# sourceMappingURL=chainBackend.d.ts.map
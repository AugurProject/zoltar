import type { Address } from '@zoltar/shared/ethereum';
import type { ReadBackendStatus } from '../../lib/chainBackend.js';
import type { AccountState, RefreshStateOptions } from '../../types/app.js';
import type { DeploymentStatus, ReadClient } from '../../types/contracts.js';
type LoadWalletStateParameters = {
    chainIdPromise: Promise<string> | undefined;
    connectedAddress: Address | undefined;
    ethBalanceAttoEthPromise: Promise<bigint> | undefined;
    fallbackChainId?: string;
    getAccountState: () => AccountState;
    isCurrent: () => boolean;
    setAccountState: (state: AccountState) => void;
    setEthBalanceErrorMessage?: (message: string | undefined) => void;
    setErrorMessage: (message: string | undefined) => void;
    setWethBalanceAttoEthErrorMessage?: (message: string | undefined) => void;
    trackLoad: <TResult>(work: () => Promise<TResult>) => Promise<TResult>;
    wethBalanceAttoEthPromise: Promise<bigint> | undefined;
};
export declare function loadWalletState({ chainIdPromise, connectedAddress, ethBalanceAttoEthPromise, fallbackChainId, getAccountState, isCurrent, setAccountState, setErrorMessage, setEthBalanceErrorMessage, setWethBalanceAttoEthErrorMessage, trackLoad, wethBalanceAttoEthPromise }: LoadWalletStateParameters): Promise<void>;
type UseOnchainStateOptions = {
    activeEnvironmentNonce?: number;
    enableChainClock?: boolean;
    onSupportedNetworkChange?: (chainId: string) => void;
};
export type UseOnchainStateDependencies = {
    getDeploymentSteps: () => ReadonlyArray<DeploymentStatus>;
    getWethAddress: () => Address;
    loadDeploymentStatusOracleSnapshot: (readClient: ReadClient) => Promise<{
        augurStatoblastDeployed: boolean;
        deploymentStatuses: DeploymentStatus[];
    }>;
    loadErc20Balance: (readClient: ReadClient, tokenAddress: Address, accountAddress: Address) => Promise<bigint>;
};
export declare function useOnchainState({ activeEnvironmentNonce, enableChainClock, onSupportedNetworkChange }: UseOnchainStateOptions | undefined, dependencies: UseOnchainStateDependencies): {
    accountState: AccountState;
    changeWallet: () => Promise<void>;
    connectWallet: () => Promise<void>;
    chainClockError: string | undefined;
    currentBlockNumber: bigint | undefined;
    currentTimestamp: bigint | undefined;
    deploymentStatusError: string | undefined;
    deploymentStatuses: DeploymentStatus[];
    errorMessage: string | undefined;
    errorMessages: string[];
    readBackendMessage: string | undefined;
    readBackendValidated: boolean;
    readBackendStatus: ReadBackendStatus;
    environmentBootstrapError: string | undefined;
    environmentBootstrapLabel: string | undefined;
    environmentBootstrapProgress: number | undefined;
    environmentReady: boolean;
    isBootstrappingEnvironment: boolean;
    hasInjectedWallet: boolean;
    hasLoadedDeploymentStatuses: boolean;
    isConnectingWallet: boolean;
    isManagingWallet: boolean;
    isLoadingDeploymentStatuses: boolean;
    isRefreshing: boolean;
    augurStatoblastDeployed: boolean | undefined;
    refreshState: (options?: RefreshStateOptions) => Promise<void>;
    setDeploymentStatuses: (update: (current: DeploymentStatus[]) => DeploymentStatus[]) => void;
    disconnectWallet: () => Promise<void>;
    switchNetwork: () => Promise<void>;
    walletBootstrapComplete: boolean;
};
export {};
//# sourceMappingURL=useOnchainState.d.ts.map
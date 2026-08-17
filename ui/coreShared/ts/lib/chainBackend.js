import { createPublicClient, createWalletClient, custom, http, publicActions } from '@zoltar/shared/ethereum';
import { getInjectedEthereum } from '../injectedEthereum.js';
import { hasErrorCode, hasErrorMessage } from './errors.js';
import { tryParseAddressInput } from './inputs.js';
import { sameChainId } from './chainId.js';
import { getNetworkSwitchTarget, MAINNET_NETWORK_PROFILE } from './networkProfile.js';
import { resolveConfiguredRpcConfig } from './rpcConfig.js';
function createReadClientForProfile(profile, transportMode, rpcUrl, ethereum) {
    return createPublicClient({
        chain: profile.chain,
        transport: transportMode === 'provider' && ethereum !== undefined ? custom(ethereum, { retryCount: 0 }) : http(rpcUrl, { batch: { wait: 100 } }),
    });
}
function withTransactionCallbacks(baseClient, callbacks, validateBeforeSend) {
    const sendRawTransaction = async (parameters) => {
        await validateBeforeSend?.();
        const hash = await baseClient.sendRawTransaction(parameters);
        callbacks.onTransactionSubmitted?.(hash);
        return hash;
    };
    const sendTransaction = async (parameters) => {
        await validateBeforeSend?.();
        const hash = await baseClient.sendTransaction(parameters);
        callbacks.onTransactionSubmitted?.(hash);
        return hash;
    };
    const writeContract = async (parameters) => {
        await validateBeforeSend?.();
        const hash = await baseClient.writeContract(parameters);
        callbacks.onTransactionSubmitted?.(hash);
        return hash;
    };
    return {
        ...baseClient,
        onTransactionPrepared: callbacks.onTransactionPrepared,
        onTransactionSubmitted: callbacks.onTransactionSubmitted,
        sendRawTransaction,
        sendTransaction,
        writeContract,
    };
}
export function normalizeAccount(value) {
    return typeof value === 'string' ? tryParseAddressInput(value) : undefined;
}
function isProviderRequestError(error) {
    return hasErrorCode(error) || hasErrorMessage(error);
}
async function readProviderAccounts(ethereum) {
    if (ethereum === undefined)
        return [];
    let result;
    try {
        result = await ethereum.request({ method: 'eth_accounts' });
    }
    catch (error) {
        if (!isProviderRequestError(error))
            throw error;
        return [];
    }
    if (!Array.isArray(result))
        return [];
    return result.map(normalizeAccount).filter((address) => address !== undefined);
}
async function readProviderChainId(ethereum) {
    if (ethereum === undefined)
        throw new Error('Unable to verify wallet network because no injected wallet was found.');
    let result;
    try {
        result = await ethereum.request({ method: 'eth_chainId' });
    }
    catch (error) {
        if (!isProviderRequestError(error))
            throw error;
        throw new Error('Unable to verify wallet network.');
    }
    if (typeof result !== 'string')
        throw new Error('Wallet returned an invalid chain ID.');
    return result;
}
export function createInjectedBackend({ profile = MAINNET_NETWORK_PROFILE, rpcUrl } = {}) {
    const getProvider = () => getInjectedEthereum();
    let readTransportMode = 'provider';
    let readBackendBlockNumber;
    let readBackendBlockTimestamp;
    const fallbackRpcUrl = profile.chain.rpcUrls.default.http[0];
    if (fallbackRpcUrl === undefined)
        throw new Error(`No default RPC URL is configured for ${profile.displayName}`);
    const configuredRpc = resolveConfiguredRpcConfig(rpcUrl === undefined ? { fallbackRpcUrl } : { fallbackRpcUrl, overrideRpcUrl: rpcUrl });
    return {
        bootstrapError: undefined,
        bootstrapLabel: undefined,
        bootstrapProgress: undefined,
        createReadClient: () => createReadClientForProfile(profile, readTransportMode, configuredRpc.url, getProvider()),
        createWriteClient: (accountAddress, callbacks = {}) => {
            const ethereum = getProvider();
            if (ethereum === undefined)
                throw new Error('No injected wallet found');
            const baseClient = createWalletClient({
                account: accountAddress,
                chain: profile.chain,
                transport: custom(ethereum),
            }).extend(publicActions);
            return withTransactionCallbacks(baseClient, callbacks, async () => {
                const currentAccounts = await readProviderAccounts(ethereum);
                const currentAccount = currentAccounts[0];
                if (currentAccount === undefined)
                    throw new Error('Wallet account is no longer connected. Reconnect your wallet and try again.');
                if (currentAccount.toLowerCase() !== accountAddress.toLowerCase())
                    throw new Error('Wallet account changed. Review the action with the connected account and try again.');
                const currentChainId = await readProviderChainId(ethereum);
                if (!sameChainId(currentChainId, profile.chainIdHex))
                    throw new Error(`Wallet network changed. Switch to ${getNetworkSwitchTarget(profile)} and try again.`);
            });
        },
        disconnectWallet: async () => {
            const ethereum = getProvider();
            if (ethereum === undefined)
                throw new Error('No injected wallet found');
            await ethereum.request({ method: 'wallet_revokePermissions', params: [{ eth_accounts: {} }] });
        },
        getAccounts: async () => await readProviderAccounts(getProvider()),
        getChainId: async () => {
            return await readProviderChainId(getProvider());
        },
        getProvider,
        getReadBackendStatus: () => ({
            blockNumber: readBackendBlockNumber,
            blockTimestamp: readBackendBlockTimestamp,
            rejectedRpcOverride: configuredRpc.rejectedOverride,
            rpcSource: configuredRpc.source,
            rpcUrl: configuredRpc.url,
            transportMode: readTransportMode,
        }),
        hasWallet: () => getProvider() !== undefined,
        id: 'injected',
        profile,
        requestAccounts: async () => {
            const ethereum = getProvider();
            if (ethereum === undefined)
                return [];
            const result = await ethereum.request({ method: 'eth_requestAccounts' });
            if (!Array.isArray(result))
                return [];
            return result.map(normalizeAccount).filter((address) => address !== undefined);
        },
        requestAccountSelection: async () => {
            const ethereum = getProvider();
            if (ethereum === undefined)
                return [];
            await ethereum.request({ method: 'wallet_requestPermissions', params: [{ eth_accounts: {} }] });
            return await readProviderAccounts(ethereum);
        },
        setReadTransportMode: mode => {
            readTransportMode = mode;
        },
        setReadBackendBlock: (block) => {
            readBackendBlockNumber = block.number;
            readBackendBlockTimestamp = block.timestamp;
        },
        subscribe: undefined,
        subscribeAccountsChanged: handler => {
            const ethereum = getProvider();
            ethereum?.on?.('accountsChanged', handler);
            return () => {
                ethereum?.removeListener?.('accountsChanged', handler);
            };
        },
        subscribeChainChanged: handler => {
            const ethereum = getProvider();
            ethereum?.on?.('chainChanged', handler);
            return () => {
                ethereum?.removeListener?.('chainChanged', handler);
            };
        },
        switchNetwork: async () => {
            const ethereum = getProvider();
            if (ethereum === undefined)
                throw new Error('No injected wallet found');
            await ethereum.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: profile.chainIdHex }] });
        },
    };
}
//# sourceMappingURL=chainBackend.js.map
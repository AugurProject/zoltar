import { createPublicClient, createWalletClient, custom, publicActions } from '@zoltar/shared/ethereum';
import { normalizeAccount } from '../lib/chainBackend.js';
import { createSimulationProfile } from '../lib/networkProfile.js';
import { predictSimulationTokenAddresses } from './bootstrap.js';
const QA_ACCOUNTS = [normalizeAccount('0x00000000000000000000000000000000000000a1'), normalizeAccount('0x00000000000000000000000000000000000000b2'), normalizeAccount('0x00000000000000000000000000000000000000c3')].filter((account) => account !== undefined);
function createListenerMap() {
    return {
        accountsChanged: new Set(),
        chainChanged: new Set(),
        state: new Set(),
    };
}
function emitListeners(listeners, eventName) {
    for (const listener of listeners[eventName]) {
        listener();
    }
}
function resolveWorkerPath(appId = 'zoltar') {
    const currentUrl = new URL(import.meta.url);
    if (currentUrl.protocol === 'file:')
        return new URL(`../../../${appId}/ts/simulation/tevmWorker.ts`, import.meta.url);
    return new URL(`../../../${appId}/js/simulation/tevmWorker.worker.js`, import.meta.url);
}
function createWorkerConnection(workerPath) {
    const worker = new Worker(workerPath, { type: 'module' });
    return {
        clearHandlers: () => {
            worker.onmessage = null;
            worker.onerror = null;
            worker.onmessageerror = null;
        },
        postMessage: message => worker.postMessage(message),
        setErrorHandler: handler => {
            worker.onerror = handler;
        },
        setMessageErrorHandler: handler => {
            worker.onmessageerror = handler;
        },
        setMessageHandler: handler => {
            worker.onmessage = handler;
        },
        terminate: () => worker.terminate(),
    };
}
function createSimulationProvider(requestRpc) {
    const request = (async (parameters) => await requestRpc(parameters));
    return {
        on: () => undefined,
        removeListener: () => undefined,
        request,
    };
}
export async function createSimulationBackend({ appId = 'zoltar', initialBootstrapError, savedState, savedStateId, scenario }, dependencies = {}) {
    const primaryAccount = QA_ACCOUNTS[0];
    if (primaryAccount === undefined)
        throw new Error('No simulation QA accounts configured');
    const profile = createSimulationProfile(predictSimulationTokenAddresses(primaryAccount));
    const initialization = savedState !== undefined && savedStateId !== undefined
        ? {
            envelope: savedState,
            kind: 'saved-state',
            stateId: savedStateId,
        }
        : {
            kind: 'scenario',
            scenario: scenario ?? 'baseline',
        };
    const listeners = createListenerMap();
    const workerPath = resolveWorkerPath(appId);
    const worker = (dependencies.createWorkerConnection ?? createWorkerConnection)(workerPath);
    const pendingRequests = new Map();
    let nextRequestId = 1;
    let currentState = undefined;
    let bootstrapPromise = undefined;
    let disposed = false;
    let terminalError = undefined;
    let rejectReady = undefined;
    const rejectPendingRequests = (error) => {
        for (const pendingRequest of pendingRequests.values()) {
            pendingRequest.reject(error);
        }
        pendingRequests.clear();
    };
    const failWorker = (error) => {
        if (disposed)
            return;
        terminalError = error;
        disposed = true;
        worker.clearHandlers();
        rejectPendingRequests(error);
        rejectReady?.(error);
        rejectReady = undefined;
        worker.terminate();
    };
    const requestFromWorker = (message) => new Promise((resolve, reject) => {
        if (terminalError !== undefined) {
            reject(terminalError);
            return;
        }
        if (disposed) {
            reject(new Error('Simulation backend has been disposed'));
            return;
        }
        const requestId = nextRequestId;
        nextRequestId += 1;
        pendingRequests.set(requestId, {
            reject,
            resolve: value => {
                resolve(value);
            },
        });
        try {
            worker.postMessage({
                ...message,
                id: requestId,
            });
        }
        catch (error) {
            pendingRequests.delete(requestId);
            reject(error instanceof Error ? error : new Error('Simulation worker request failed'));
        }
    });
    const callWorker = async (method, params) => await requestFromWorker({
        method,
        params,
        type: 'call',
    });
    const requestRpc = async (parameters) => await requestFromWorker({
        method: parameters.method,
        params: parameters.params,
        type: 'rpc',
    });
    const applyState = (nextState) => {
        const previousSelectedAccount = currentState?.selectedAccount;
        currentState = nextState;
        if (previousSelectedAccount !== undefined && previousSelectedAccount !== nextState.selectedAccount)
            emitListeners(listeners, 'accountsChanged');
        emitListeners(listeners, 'state');
    };
    const patchState = (patch) => {
        const state = currentState;
        if (state === undefined)
            return;
        applyState({
            ...state,
            ...patch,
        });
    };
    const waitForReady = new Promise((resolve, reject) => {
        rejectReady = reject;
        worker.setMessageHandler(event => {
            const message = event.data;
            if (message.type === 'ready') {
                applyState(message.state);
                rejectReady = undefined;
                resolve(message.state);
                return;
            }
            if (message.type === 'state') {
                applyState(message.state);
                return;
            }
            if (message.type === 'error' && message.id === undefined) {
                failWorker(new Error(message.message));
                return;
            }
            if (message.type === 'result') {
                const requestId = message.id;
                const pendingRequest = pendingRequests.get(requestId);
                if (pendingRequest === undefined)
                    return;
                pendingRequests.delete(requestId);
                pendingRequest.resolve(message.value);
                return;
            }
            if (message.type === 'error' && message.id !== undefined) {
                const requestId = message.id;
                const pendingRequest = pendingRequests.get(requestId);
                if (pendingRequest === undefined)
                    return;
                pendingRequests.delete(requestId);
                pendingRequest.reject(new Error(message.message));
            }
        });
        worker.setErrorHandler(event => {
            const locationSuffix = event.filename === undefined || event.filename === '' ? '' : ` at ${event.filename}${event.lineno === 0 ? '' : `:${event.lineno}${event.colno === 0 ? '' : `:${event.colno}`}`}`;
            failWorker(new Error(`${event.message || 'Simulation worker failed'}${locationSuffix} (worker: ${workerPath.toString()})`));
        });
        worker.setMessageErrorHandler(() => {
            failWorker(new Error(`Simulation worker message deserialization failed (worker: ${workerPath.toString()})`));
        });
        try {
            worker.postMessage({
                initialization,
                type: 'init',
            });
        }
        catch (error) {
            failWorker(error instanceof Error ? error : new Error('Simulation worker initialization failed'));
        }
    });
    await waitForReady;
    if (initialBootstrapError !== undefined) {
        const state = currentState;
        if (state === undefined)
            throw new Error('Simulation worker state is unavailable');
        applyState(Object.assign({}, state, { bootstrapError: initialBootstrapError }));
    }
    const requireState = () => {
        if (currentState === undefined)
            throw new Error('Simulation worker state is unavailable');
        return currentState;
    };
    const provider = createSimulationProvider(requestRpc);
    const createBaseWriteClient = (accountAddress) => createWalletClient({
        account: accountAddress,
        chain: profile.chain,
        transport: custom(provider),
    }).extend(publicActions);
    const backend = {
        accounts: QA_ACCOUNTS,
        advanceTime: async (seconds) => {
            await callWorker('advanceTime', { seconds });
        },
        bootstrap: async () => {
            if (bootstrapPromise === undefined) {
                patchState({
                    bootstrapError: currentState?.bootstrapError,
                    bootstrapLabel: 'Starting simulation bootstrap',
                    bootstrapProgress: 0,
                    isBootstrapping: true,
                });
                bootstrapPromise = callWorker('bootstrap', undefined);
            }
            return await bootstrapPromise;
        },
        get bootstrapError() {
            return requireState().bootstrapError;
        },
        get bootstrapLabel() {
            return requireState().bootstrapLabel;
        },
        get bootstrapProgress() {
            return requireState().bootstrapProgress;
        },
        createReadClient: () => createPublicClient({
            chain: profile.chain,
            transport: custom(provider),
        }),
        createWriteClient: (accountAddress, callbacks = {}) => {
            const baseClient = createBaseWriteClient(accountAddress);
            const sendRawTransaction = async (parameters) => {
                const hash = await baseClient.sendRawTransaction(parameters);
                callbacks.onTransactionSubmitted?.(hash);
                return hash;
            };
            const sendTransaction = async (parameters) => {
                const hash = await baseClient.sendTransaction(parameters);
                callbacks.onTransactionSubmitted?.(hash);
                return hash;
            };
            const writeContract = async (parameters) => {
                const hash = await baseClient.writeContract(parameters);
                callbacks.onTransactionSubmitted?.(hash);
                return hash;
            };
            const waitForTransactionReceipt = async (parameters) => await callWorker('waitForTransactionReceipt', { hash: parameters.hash });
            return {
                ...baseClient,
                installSimulationProxyDeployer: async ({ address, runtimeCode }) => {
                    await callWorker('installSimulationProxyDeployer', { address, runtimeCode });
                },
                onTransactionPrepared: callbacks.onTransactionPrepared,
                patchSimulationGenesisRepToken: async ({ repAddress, zoltarAddress }) => {
                    await callWorker('patchSimulationGenesisRepToken', { repAddress, zoltarAddress });
                },
                requiresWalletConfirmation: false,
                sendRawTransaction,
                sendTransaction,
                waitForTransactionReceipt,
                writeContract,
            };
        },
        get blockCountSinceReset() {
            return requireState().blockCountSinceReset;
        },
        get currentTimestamp() {
            return requireState().currentTimestamp;
        },
        get currentScenario() {
            return requireState().currentScenario;
        },
        dispose: async () => {
            if (disposed)
                return;
            disposed = true;
            worker.clearHandlers();
            rejectPendingRequests(new Error('Simulation backend has been disposed'));
            worker.terminate();
        },
        exportState: async (name) => await callWorker('exportState', { name }),
        get isBootstrapped() {
            return requireState().isBootstrapped;
        },
        get isBootstrapping() {
            return requireState().isBootstrapping;
        },
        getAccounts: async () => await callWorker('getAccounts', undefined),
        getChainId: async () => profile.chainIdHex,
        getProvider: () => provider,
        getReadBackendStatus: () => ({
            blockNumber: requireState().blockCountSinceReset,
            blockTimestamp: requireState().currentTimestamp,
            rpcSource: 'default',
            rpcUrl: 'browser-simulation',
            transportMode: 'provider',
        }),
        hasWallet: () => true,
        id: 'simulation',
        isActive: true,
        mintRep: async (amount) => {
            await callWorker('mintRep', { amount });
        },
        mineBlock: async () => {
            await callWorker('mineBlock', undefined);
        },
        profile,
        get queryDelayMilliseconds() {
            return requireState().queryDelayMilliseconds;
        },
        get repPerEthPrice() {
            return requireState().repPerEthPrice;
        },
        get repPerUsdcPrice() {
            return requireState().repPerUsdcPrice;
        },
        requestAccounts: async () => await callWorker('getAccounts', undefined),
        reset: async () => {
            await callWorker('reset', undefined);
        },
        selectAccount: async (address) => {
            await callWorker('selectAccount', { address });
        },
        get selectedAccount() {
            return requireState().selectedAccount;
        },
        get simulationSource() {
            return requireState().currentSource;
        },
        setRepPerEthPrice: async (value) => await callWorker('setRepPerEthPrice', { value }),
        setRepPerUsdcPrice: async (value) => await callWorker('setRepPerUsdcPrice', { value }),
        setQueryDelayMilliseconds: async (value) => await callWorker('setQueryDelayMilliseconds', { value }),
        setTransactionDelayMilliseconds: async (value) => await callWorker('setTransactionDelayMilliseconds', { value }),
        subscribe: handler => {
            listeners.state.add(handler);
            return () => {
                listeners.state.delete(handler);
            };
        },
        subscribeAccountsChanged: handler => {
            listeners.accountsChanged.add(handler);
            return () => {
                listeners.accountsChanged.delete(handler);
            };
        },
        subscribeChainChanged: handler => {
            listeners.chainChanged.add(handler);
            return () => {
                listeners.chainChanged.delete(handler);
            };
        },
        get transactionCountSinceReset() {
            return requireState().transactionCountSinceReset;
        },
        get transactionDelayMilliseconds() {
            return requireState().transactionDelayMilliseconds;
        },
        waitUntilReady: async () => {
            await callWorker('waitUntilReady', undefined);
        },
    };
    return backend;
}
//# sourceMappingURL=tevmBackend.js.map
import { createMemoryClient } from 'tevm';
import { createCommon } from 'tevm/common';
import { createPublicClient, createWalletClient, custom, encodeFunctionData, parseTransaction, publicActions, recoverTransactionAddress } from '@zoltar/shared/ethereum';
import { getAddress } from '@zoltar/shared/ethereum';
import { createSimulationProfile } from '../lib/networkProfile.js';
import { bootstrapSimulationChain, mintSimulationGenesisRep, predictSimulationTokenAddresses, updateZoltarGenesisRepToken } from './bootstrap.js';
import { advanceSimulationTime, getNextSimulationTimestamp, getSimulationChainTimestamp, mineNextSimulationBlock, minePendingSimulationTransactionAtTimestamp } from './clock.js';
import { serializeSavedSimulationStateEnvelope } from './savedStates.js';
const QA_ACCOUNTS = [getAddress('0x00000000000000000000000000000000000000a1'), getAddress('0x00000000000000000000000000000000000000b2'), getAddress('0x00000000000000000000000000000000000000c3')];
const DEFAULT_SIMULATION_REP_PER_ETH_PRICE = 3n * 10n ** 18n;
const DEFAULT_SIMULATION_REP_PER_USDC_PRICE = 10n ** 6n;
function formatTevmErrors(errors) {
    return errors.map(error => error.message).join(', ');
}
function normalizeRpcBigInt(value) {
    if (typeof value === 'bigint')
        return value;
    if (typeof value === 'number')
        return BigInt(value);
    if (typeof value === 'string')
        return BigInt(value);
    return undefined;
}
function normalizeRpcAddress(value) {
    if (typeof value !== 'string')
        return undefined;
    return getAddress(value);
}
function normalizeRpcTransactionRequest(value) {
    return {
        account: (() => {
            if ('account' in value)
                return value['account'];
            if ('from' in value)
                return value['from'];
            return undefined;
        })(),
        data: typeof value['data'] === 'string' ? value['data'] : undefined,
        gas: normalizeRpcBigInt(value['gas']),
        gasPrice: normalizeRpcBigInt(value['gasPrice']),
        maxFeePerGas: normalizeRpcBigInt(value['maxFeePerGas']),
        maxPriorityFeePerGas: normalizeRpcBigInt(value['maxPriorityFeePerGas']),
        nonce: normalizeRpcBigInt(value['nonce']),
        to: value['to'] === null ? null : normalizeRpcAddress(value['to']),
        value: normalizeRpcBigInt(value['value']),
    };
}
function isMissingTransactionReceiptError(error) {
    if (!(error instanceof Error))
        return false;
    return error.message.includes('Transaction receipt with hash') && error.message.includes('could not be found');
}
function normalizeRequestedAccount(value, fallbackAccount) {
    if (typeof value === 'string')
        return getAddress(value);
    if (typeof value === 'object' && value !== null && 'address' in value) {
        const address = value.address;
        if (typeof address === 'string')
            return getAddress(address);
    }
    return fallbackAccount;
}
function requireTransactionHash(hash, label) {
    if (hash === undefined)
        throw new Error(`Simulation ${label} did not return a transaction hash`);
    return hash;
}
function normalizeNonce(value) {
    if (value === undefined)
        return undefined;
    return typeof value === 'bigint' ? value : BigInt(value);
}
function createTevmTransactionRequest({ data, from, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, to, value, }) {
    return {
        addToMempool: true,
        data,
        from,
        ...(gas === undefined ? {} : { gas }),
        ...(gasPrice === undefined ? {} : { gasPrice }),
        ...(maxFeePerGas === undefined ? {} : { maxFeePerGas }),
        ...(maxPriorityFeePerGas === undefined ? {} : { maxPriorityFeePerGas }),
        ...(nonce === undefined ? {} : { nonce }),
        ...(to === undefined || to === null ? {} : { to }),
        ...(value === undefined ? {} : { value }),
    };
}
function clampDelayMilliseconds(value) {
    if (!Number.isFinite(value) || value <= 0)
        return 0;
    return Math.min(Math.trunc(value), 30000);
}
function createSimulationMemoryClient(profile) {
    return createMemoryClient({
        common: createCommon({
            ...profile.chain,
        }),
        miningConfig: {
            type: 'manual',
        },
    });
}
async function delayMilliseconds(milliseconds) {
    if (milliseconds <= 0)
        return;
    await new Promise(resolve => {
        setTimeout(resolve, milliseconds);
    });
}
function getRequiredBlockNumber(block) {
    if (block.number === undefined || block.number === null)
        throw new Error('Simulation block number was unavailable');
    return block.number;
}
async function getSimulationChainState(memoryClient) {
    const block = await memoryClient.getBlock();
    return {
        blockNumber: getRequiredBlockNumber(block),
        currentTimestamp: block.timestamp,
    };
}
function createSimulationProvider({ getChainId, getQueryDelayMilliseconds, getSelectedAccount, requestRpc }) {
    const request = (async (parameters) => {
        if (parameters.method === 'eth_accounts' || parameters.method === 'eth_requestAccounts')
            return [getSelectedAccount()];
        if (parameters.method === 'eth_chainId')
            return getChainId();
        await delayMilliseconds(getQueryDelayMilliseconds());
        return await requestRpc(parameters);
    });
    return {
        on: () => undefined,
        removeListener: () => undefined,
        request,
    };
}
function withTransactionCallbacks(baseClient, callbacks) {
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
    return {
        ...baseClient,
        onTransactionPrepared: callbacks.onTransactionPrepared,
        sendRawTransaction,
        sendTransaction,
        writeContract,
    };
}
function getInitializationScenario(initialization) {
    return initialization.kind === 'scenario' ? initialization.scenario : initialization.envelope.baseScenario;
}
function getSimulationSource(initialization) {
    return initialization.kind === 'scenario'
        ? {
            kind: 'scenario',
            scenario: initialization.scenario,
        }
        : {
            baseScenario: initialization.envelope.baseScenario,
            kind: 'saved-state',
            name: initialization.envelope.name,
            savedAt: initialization.envelope.savedAt,
            stateId: initialization.stateId,
        };
}
async function requireSuccessfulLoadState(memoryClient, state) {
    const result = await memoryClient.tevmLoadState({ state });
    if (result.errors === undefined || result.errors.length === 0)
        return;
    throw new Error(formatTevmErrors(result.errors));
}
async function requireSuccessfulDumpState(memoryClient) {
    const result = await memoryClient.tevmDumpState();
    if (result.errors === undefined || result.errors.length === 0)
        return result.state;
    throw new Error(formatTevmErrors(result.errors));
}
function getDumpedAccountState(state, address) {
    const normalizedAddress = address.toLowerCase();
    const matchingEntry = Object.entries(state).find(([candidateAddress]) => candidateAddress.toLowerCase() === normalizedAddress);
    return matchingEntry?.[1];
}
function normalizeDumpedStorage(storage) {
    const normalizedStorage = {};
    for (const [key, value] of Object.entries(storage)) {
        normalizedStorage[key] = value;
    }
    return normalizedStorage;
}
async function applyDumpedAccountState(memoryClient, address, state) {
    const accountState = getDumpedAccountState(state, address);
    if (accountState === undefined)
        throw new Error(`Missing simulation account state for ${address}`);
    const setAccountResult = await memoryClient.tevmSetAccount({
        address,
        balance: BigInt(accountState.balance),
        ...(accountState.deployedBytecode === undefined ? {} : { deployedBytecode: accountState.deployedBytecode }),
        nonce: BigInt(accountState.nonce),
        ...(accountState.storage === undefined ? {} : { state: normalizeDumpedStorage(accountState.storage) }),
    });
    if (setAccountResult.errors !== undefined && setAccountResult.errors.length > 0) {
        throw new Error(formatTevmErrors(setAccountResult.errors));
    }
}
async function applyDumpedStorageState(memoryClient, address, state) {
    const accountState = getDumpedAccountState(state, address);
    if (accountState === undefined)
        throw new Error(`Missing simulation account state for ${address}`);
    if (accountState.storage === undefined)
        throw new Error(`Missing simulation storage state for ${address}`);
    for (const [index, value] of Object.entries(accountState.storage)) {
        await memoryClient.setStorageAt({
            address,
            index: index,
            value: value,
        });
    }
}
export async function createSimulationEngine({ initialization, dependencies }) {
    const primaryAccount = QA_ACCOUNTS[0];
    if (primaryAccount === undefined)
        throw new Error('No simulation QA accounts configured');
    const predictedTokenAddresses = predictSimulationTokenAddresses(primaryAccount);
    const profile = createSimulationProfile(predictedTokenAddresses);
    const baseScenario = getInitializationScenario(initialization);
    let memoryClient = createSimulationMemoryClient(profile);
    const stateListeners = new Set();
    const impersonatedAccounts = new Set();
    let baselineTransactionCount = 0n;
    let bootstrapError = undefined;
    let bootstrapLabel = undefined;
    let bootstrapProgress = undefined;
    let blockCountSinceReset = 0n;
    let bootstrapPromise = undefined;
    let bootstrapped = false;
    let bootstrapping = false;
    let currentTimestamp = 0n;
    let queryDelayMilliseconds = 0;
    let repPerEthPrice = DEFAULT_SIMULATION_REP_PER_ETH_PRICE;
    let repPerUsdcPrice = DEFAULT_SIMULATION_REP_PER_USDC_PRICE;
    let selectedAccount = primaryAccount;
    const simulationSource = getSimulationSource(initialization);
    let transactionCountSinceReset = 0n;
    let transactionDelayMilliseconds = 1000;
    const emitState = () => {
        for (const listener of stateListeners) {
            listener();
        }
    };
    const ensureImpersonated = async (address) => {
        const normalizedAddress = address.toLowerCase();
        if (impersonatedAccounts.has(normalizedAddress))
            return;
        await memoryClient.impersonateAccount({ address });
        impersonatedAccounts.add(normalizedAddress);
    };
    const initializeSimulationAccounts = async () => {
        for (const account of QA_ACCOUNTS) {
            await ensureImpersonated(account);
        }
    };
    const mineSubmittedTransaction = async (hash) => {
        const chainTimestamp = await getSimulationChainTimestamp(memoryClient);
        await minePendingSimulationTransactionAtTimestamp(memoryClient, hash, getNextSimulationTimestamp(chainTimestamp));
    };
    const refreshSimulationState = async () => {
        const chainState = await getSimulationChainState(memoryClient);
        currentTimestamp = chainState.currentTimestamp;
        blockCountSinceReset = chainState.blockNumber;
    };
    const createMemoryBackedWriteClient = ({ accountAddress, memoryClientInstance }) => {
        const readClient = createPublicClient({
            chain: profile.chain,
            transport: custom({
                request: async (parameters) => await memoryClientInstance.request(parameters),
            }),
        });
        const sendTransaction = async ({ account, data, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, to, value }) => {
            const senderAddress = normalizeRequestedAccount(account, accountAddress);
            await memoryClientInstance.impersonateAccount({ address: senderAddress });
            const blockGasLimit = (await memoryClientInstance.getBlock()).gasLimit;
            const result = await memoryClientInstance.tevmCall(createTevmTransactionRequest({
                data: data ?? '0x',
                from: senderAddress,
                gas: gas ?? blockGasLimit,
                gasPrice,
                maxFeePerGas,
                maxPriorityFeePerGas,
                nonce: normalizeNonce(nonce),
                to,
                value,
            }));
            const hash = requireTransactionHash(result.txHash, 'temporary simulation transaction');
            const chainTimestamp = await getSimulationChainTimestamp(memoryClientInstance);
            await minePendingSimulationTransactionAtTimestamp(memoryClientInstance, hash, getNextSimulationTimestamp(chainTimestamp));
            return hash;
        };
        const writeContract = async (parameters) => await sendTransaction({
            account: parameters.account,
            data: encodeFunctionData(parameters),
            gas: parameters.gas,
            maxFeePerGas: parameters.maxFeePerGas,
            maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
            to: parameters.address,
            value: parameters.value,
        });
        return {
            account: accountAddress,
            getCode: async (parameters) => await readClient.getCode(parameters),
            readContract: async (parameters) => await readClient.readContract(parameters),
            sendTransaction,
            waitForTransactionReceipt: async (parameters) => await readClient.getTransactionReceipt({ hash: parameters.hash }),
            writeContract,
        };
    };
    const applyTemporarySimulationAccountChanges = async ({ accountsToCopy, mutate }) => {
        const baseSnapshot = await requireSuccessfulDumpState(memoryClient);
        const temporaryMemoryClient = createSimulationMemoryClient(profile);
        await requireSuccessfulLoadState(temporaryMemoryClient, baseSnapshot);
        await mutate({
            createWriteClient: accountAddress => createMemoryBackedWriteClient({
                accountAddress,
                memoryClientInstance: temporaryMemoryClient,
            }),
            memoryClient: temporaryMemoryClient,
        });
        const mutatedSnapshot = await requireSuccessfulDumpState(temporaryMemoryClient);
        for (const { address, mode } of accountsToCopy) {
            if (mode === 'storage') {
                await applyDumpedStorageState(memoryClient, address, mutatedSnapshot);
                continue;
            }
            await applyDumpedAccountState(memoryClient, address, mutatedSnapshot);
        }
    };
    const restoreSavedStateEnvelope = async (envelope, progressLabel) => {
        bootstrapError = undefined;
        bootstrapLabel = progressLabel;
        bootstrapProgress = 0;
        memoryClient = createSimulationMemoryClient(profile);
        impersonatedAccounts.clear();
        await initializeSimulationAccounts();
        await requireSuccessfulLoadState(memoryClient, envelope.state.snapshot);
        await initializeSimulationAccounts();
        queryDelayMilliseconds = clampDelayMilliseconds(envelope.state.queryDelayMilliseconds);
        repPerEthPrice = envelope.state.repPerEthPrice;
        repPerUsdcPrice = envelope.state.repPerUsdcPrice;
        transactionDelayMilliseconds = clampDelayMilliseconds(envelope.state.transactionDelayMilliseconds);
        transactionCountSinceReset = envelope.state.transactionCountSinceReset;
        const nextSelectedAccount = QA_ACCOUNTS.find(account => account.toLowerCase() === envelope.state.selectedAccount.toLowerCase());
        if (nextSelectedAccount === undefined)
            throw new Error(`Unknown saved simulation account: ${envelope.state.selectedAccount}`);
        selectedAccount = nextSelectedAccount;
        await ensureImpersonated(selectedAccount);
        await refreshSimulationState();
        baselineTransactionCount = envelope.state.transactionCountSinceReset;
        bootstrapLabel = 'Simulation scenario ready';
        bootstrapProgress = 1;
        bootstrapped = true;
    };
    const sendRawTransactionInternal = async (serializedTransaction) => {
        const parsedTransaction = parseTransaction(serializedTransaction);
        const recoveredAddress = await recoverTransactionAddress({
            serializedTransaction,
        });
        await ensureImpersonated(recoveredAddress);
        const result = await memoryClient.tevmCall(createTevmTransactionRequest({
            data: parsedTransaction.data ?? '0x',
            from: recoveredAddress,
            gas: parsedTransaction.gas,
            gasPrice: parsedTransaction.gasPrice,
            maxFeePerGas: parsedTransaction.maxFeePerGas,
            maxPriorityFeePerGas: parsedTransaction.maxPriorityFeePerGas,
            nonce: normalizeNonce(parsedTransaction.nonce),
            to: parsedTransaction.to,
            value: parsedTransaction.value,
        }));
        const hash = requireTransactionHash(result.txHash, 'raw transaction');
        await mineSubmittedTransaction(hash);
        transactionCountSinceReset += 1n;
        await refreshSimulationState();
        emitState();
        return hash;
    };
    const sendTransactionInternal = async ({ account, data, gas, gasPrice, maxFeePerGas, maxPriorityFeePerGas, nonce, to, value, }) => {
        const senderAddress = normalizeRequestedAccount(account, selectedAccount);
        await ensureImpersonated(senderAddress);
        const blockGasLimit = (await memoryClient.getBlock()).gasLimit;
        const result = await memoryClient.tevmCall(createTevmTransactionRequest({
            data: data ?? '0x',
            from: senderAddress,
            gas: gas ?? blockGasLimit,
            gasPrice,
            maxFeePerGas,
            maxPriorityFeePerGas,
            nonce: normalizeNonce(nonce),
            to,
            value,
        }));
        const hash = requireTransactionHash(result.txHash, 'transaction');
        await mineSubmittedTransaction(hash);
        transactionCountSinceReset += 1n;
        await refreshSimulationState();
        emitState();
        return hash;
    };
    const requestRpc = async (parameters) => {
        if (parameters.method === 'eth_sendRawTransaction') {
            const params = Array.isArray(parameters.params) ? parameters.params : [];
            const serializedTransaction = params[0];
            if (typeof serializedTransaction !== 'string')
                throw new Error('Simulation raw transaction payload was invalid');
            return await sendRawTransactionInternal(serializedTransaction);
        }
        if (parameters.method === 'eth_sendTransaction') {
            const params = Array.isArray(parameters.params) ? parameters.params : [];
            const request = params[0];
            if (typeof request !== 'object' || request === null)
                throw new Error('Simulation transaction payload was invalid');
            return await sendTransactionInternal(normalizeRpcTransactionRequest(request));
        }
        return await memoryClient.request(parameters);
    };
    const provider = createSimulationProvider({
        getChainId: () => profile.chainIdHex,
        getQueryDelayMilliseconds: () => queryDelayMilliseconds,
        getSelectedAccount: () => selectedAccount,
        requestRpc,
    });
    const bootstrapProvider = createSimulationProvider({
        getChainId: () => profile.chainIdHex,
        getQueryDelayMilliseconds: () => 0,
        getSelectedAccount: () => selectedAccount,
        requestRpc,
    });
    const receiptClient = createPublicClient({
        chain: profile.chain,
        transport: custom(provider),
    });
    const createWriteClientForProvider = ({ accountAddress, callbacks, currentProvider, getTransactionDelay, onReceiptResolved }) => {
        const baseClient = createWalletClient({
            account: accountAddress,
            chain: profile.chain,
            transport: custom(currentProvider),
        }).extend(publicActions);
        const sendRawTransaction = async (parameters) => {
            const hash = await sendRawTransactionInternal(parameters.serializedTransaction);
            callbacks.onTransactionSubmitted?.(hash);
            return hash;
        };
        const sendTransaction = async (parameters) => {
            const senderAddress = normalizeRequestedAccount(parameters.account, accountAddress);
            const hash = await sendTransactionInternal({
                ...parameters,
                account: senderAddress,
            });
            callbacks.onTransactionSubmitted?.(hash);
            return hash;
        };
        const writeContract = async (parameters) => {
            const senderAddress = normalizeRequestedAccount(parameters.account, accountAddress);
            const data = encodeFunctionData(parameters);
            return await sendTransaction({
                account: senderAddress,
                data,
                gas: parameters.gas,
                maxFeePerGas: parameters.maxFeePerGas,
                maxPriorityFeePerGas: parameters.maxPriorityFeePerGas,
                to: parameters.address,
                value: parameters.value,
            });
        };
        const waitForTransactionReceipt = async (parameters) => {
            await delayMilliseconds(getTransactionDelay());
            for (let attempt = 0; attempt < 3; attempt += 1) {
                try {
                    const receipt = await receiptClient.getTransactionReceipt({
                        hash: parameters.hash,
                    });
                    await onReceiptResolved();
                    return receipt;
                }
                catch (error) {
                    if (!isMissingTransactionReceiptError(error))
                        throw error;
                    await mineNextSimulationBlock(memoryClient);
                }
            }
            const receipt = await receiptClient.getTransactionReceipt({
                hash: parameters.hash,
            });
            await onReceiptResolved();
            return receipt;
        };
        return withTransactionCallbacks({
            ...baseClient,
            installSimulationProxyDeployer: async ({ address, runtimeCode }) => {
                await memoryClient.setCode({
                    address,
                    bytecode: runtimeCode,
                });
            },
            patchSimulationGenesisRepToken: async ({ zoltarAddress }) => {
                await applyTemporarySimulationAccountChanges({
                    accountsToCopy: [{ address: zoltarAddress, mode: 'storage' }],
                    mutate: async ({ createWriteClient, memoryClient: temporaryMemoryClient }) => {
                        await updateZoltarGenesisRepToken({
                            createWriteClient,
                            memoryClient: temporaryMemoryClient,
                            repAddress: profile.genesisRepTokenAddress,
                            zoltarAddress,
                        });
                    },
                });
            },
            sendRawTransaction,
            sendTransaction,
            waitForTransactionReceipt,
            writeContract,
        }, callbacks);
    };
    await initializeSimulationAccounts();
    const createBootstrapReadClient = () => createPublicClient({
        chain: profile.chain,
        transport: custom(bootstrapProvider),
    });
    const createBootstrapWriteClient = (accountAddress) => createWriteClientForProvider({
        accountAddress,
        callbacks: {},
        currentProvider: bootstrapProvider,
        getTransactionDelay: () => 0,
        onReceiptResolved: async () => undefined,
    });
    const bootstrapBuiltInScenario = async (scenario) => {
        await bootstrapSimulationChain({
            accounts: QA_ACCOUNTS,
            ...(dependencies.applyScenario === undefined ? {} : { applyScenario: dependencies.applyScenario }),
            createReadClient: createBootstrapReadClient,
            createWriteClient: createBootstrapWriteClient,
            getDeploymentSteps: dependencies.getDeploymentSteps,
            memoryClient,
            onProgress: progress => {
                bootstrapLabel = progress.label;
                bootstrapProgress = progress.value;
                emitState();
            },
            primaryAccount,
            profile,
            scenario,
        });
        await refreshSimulationState();
        baselineTransactionCount = transactionCountSinceReset;
        bootstrapLabel = 'Simulation scenario ready';
        bootstrapProgress = 1;
        bootstrapped = true;
    };
    const bootstrap = async () => {
        if (bootstrapPromise !== undefined)
            return await bootstrapPromise;
        bootstrapping = true;
        bootstrapError = undefined;
        bootstrapLabel = initialization.kind === 'scenario' ? 'Starting simulation bootstrap' : 'Loading saved simulation state';
        bootstrapProgress = 0;
        emitState();
        bootstrapPromise = (async () => {
            try {
                if (initialization.kind === 'scenario') {
                    await bootstrapBuiltInScenario(initialization.scenario);
                }
                else {
                    await restoreSavedStateEnvelope(initialization.envelope, 'Loading saved simulation state');
                }
            }
            catch (error) {
                bootstrapError = error instanceof Error ? error.message : 'Failed to bootstrap simulation scenario';
                throw error;
            }
            finally {
                bootstrapping = false;
                if (bootstrapped) {
                    bootstrapLabel = undefined;
                    bootstrapProgress = undefined;
                }
                emitState();
            }
        })();
        return await bootstrapPromise;
    };
    const getState = () => ({
        bootstrapError,
        bootstrapLabel,
        bootstrapProgress,
        blockCountSinceReset,
        currentScenario: baseScenario,
        currentTimestamp,
        currentSource: simulationSource,
        isBootstrapped: bootstrapped,
        isBootstrapping: bootstrapping,
        queryDelayMilliseconds,
        repPerEthPrice,
        repPerUsdcPrice,
        selectedAccount,
        transactionCountSinceReset,
        transactionDelayMilliseconds,
    });
    return {
        accounts: QA_ACCOUNTS,
        advanceTime: async (seconds) => {
            await advanceSimulationTime(memoryClient, seconds);
            await refreshSimulationState();
            emitState();
        },
        bootstrap,
        exportState: async (name) => {
            if (!bootstrapped)
                throw new Error('Simulation scenario must be bootstrapped before exporting state');
            const snapshot = await memoryClient.tevmDumpState();
            if (snapshot.errors !== undefined && snapshot.errors.length > 0) {
                throw new Error(snapshot.errors.map(error => error.message).join(', '));
            }
            const normalizedName = name.trim();
            if (normalizedName === '')
                throw new Error('Saved simulation state name is required');
            return serializeSavedSimulationStateEnvelope({
                baseScenario,
                name: normalizedName,
                savedAt: new Date().toISOString(),
                state: {
                    blockCountSinceReset,
                    currentTimestamp,
                    queryDelayMilliseconds,
                    repPerEthPrice,
                    repPerUsdcPrice,
                    selectedAccount,
                    snapshot: snapshot.state,
                    transactionCountSinceReset,
                    transactionDelayMilliseconds,
                },
                version: 1,
            });
        },
        getAccounts: async () => [selectedAccount],
        getChainId: async () => profile.chainIdHex,
        getProfile: () => profile,
        getState,
        installSimulationProxyDeployer: async ({ address, runtimeCode }) => {
            await memoryClient.setCode({
                address,
                bytecode: runtimeCode,
            });
        },
        mintRep: async (amount) => {
            if (!bootstrapped) {
                throw new Error('Simulation scenario must be bootstrapped before minting REP');
            }
            const repCode = await memoryClient.getCode({
                address: profile.genesisRepTokenAddress,
            });
            if (repCode === undefined || repCode === '0x') {
                throw new Error('Simulation REP token is unavailable');
            }
            const zoltarAddress = dependencies.getZoltarAddress(profile);
            const zoltarCode = await memoryClient.getCode({
                address: zoltarAddress,
            });
            const accountsToCopy = zoltarCode === undefined || zoltarCode === '0x'
                ? [{ address: profile.genesisRepTokenAddress, mode: 'full' }]
                : [
                    { address: profile.genesisRepTokenAddress, mode: 'full' },
                    { address: zoltarAddress, mode: 'storage' },
                ];
            await applyTemporarySimulationAccountChanges({
                accountsToCopy,
                mutate: async ({ createWriteClient, memoryClient: temporaryMemoryClient }) => {
                    await mintSimulationGenesisRep({
                        accountAddress: selectedAccount,
                        amount,
                        createWriteClient,
                        memoryClient: temporaryMemoryClient,
                        repAddress: profile.genesisRepTokenAddress,
                        zoltarAddress,
                    });
                },
            });
            await refreshSimulationState();
            emitState();
        },
        mineBlock: async () => {
            await mineNextSimulationBlock(memoryClient);
            await refreshSimulationState();
            emitState();
        },
        patchSimulationGenesisRepToken: async ({ zoltarAddress }) => {
            await applyTemporarySimulationAccountChanges({
                accountsToCopy: [{ address: zoltarAddress, mode: 'storage' }],
                mutate: async ({ createWriteClient, memoryClient: temporaryMemoryClient }) => {
                    await updateZoltarGenesisRepToken({
                        createWriteClient,
                        memoryClient: temporaryMemoryClient,
                        repAddress: profile.genesisRepTokenAddress,
                        zoltarAddress,
                    });
                },
            });
        },
        request: async (parameters) => await requestRpc(parameters),
        reset: async () => {
            bootstrapError = undefined;
            bootstrapLabel = 'Resetting simulation scenario';
            bootstrapProgress = 0;
            bootstrapping = true;
            emitState();
            try {
                if (initialization.kind === 'scenario') {
                    memoryClient = createSimulationMemoryClient(profile);
                    impersonatedAccounts.clear();
                    await initializeSimulationAccounts();
                    await bootstrapBuiltInScenario(initialization.scenario);
                    selectedAccount = primaryAccount;
                    transactionCountSinceReset = baselineTransactionCount;
                    repPerEthPrice = DEFAULT_SIMULATION_REP_PER_ETH_PRICE;
                    repPerUsdcPrice = DEFAULT_SIMULATION_REP_PER_USDC_PRICE;
                    queryDelayMilliseconds = 0;
                    transactionDelayMilliseconds = 1000;
                    await refreshSimulationState();
                }
                else {
                    await restoreSavedStateEnvelope(initialization.envelope, 'Resetting saved simulation state');
                }
                bootstrapLabel = undefined;
                bootstrapProgress = undefined;
            }
            finally {
                bootstrapping = false;
                emitState();
            }
        },
        selectAccount: async (address) => {
            if (!QA_ACCOUNTS.includes(address))
                throw new Error(`Unknown simulation account: ${address}`);
            selectedAccount = address;
            await ensureImpersonated(address);
            emitState();
        },
        setRepPerEthPrice: value => {
            if (value <= 0n)
                throw new Error('Simulation REP/ETH price must be greater than zero');
            repPerEthPrice = value;
            emitState();
        },
        setRepPerUsdcPrice: value => {
            if (value <= 0n)
                throw new Error('Simulation REP/USDC price must be greater than zero');
            repPerUsdcPrice = value;
            emitState();
        },
        setQueryDelayMilliseconds: value => {
            queryDelayMilliseconds = clampDelayMilliseconds(value);
            emitState();
        },
        setTransactionDelayMilliseconds: value => {
            transactionDelayMilliseconds = clampDelayMilliseconds(value);
            emitState();
        },
        subscribe: handler => {
            stateListeners.add(handler);
            return () => {
                stateListeners.delete(handler);
            };
        },
        waitForTransactionReceipt: async (hash) => {
            const writeClient = createWriteClientForProvider({
                accountAddress: selectedAccount,
                callbacks: {},
                currentProvider: provider,
                getTransactionDelay: () => transactionDelayMilliseconds,
                onReceiptResolved: async () => {
                    await refreshSimulationState();
                    emitState();
                },
            });
            return await writeClient.waitForTransactionReceipt({ hash });
        },
        waitUntilReady: async () => {
            await bootstrap();
        },
    };
}
//# sourceMappingURL=tevmEngine.js.map
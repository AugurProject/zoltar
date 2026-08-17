import { useSignal } from '@preact/signals';
import { executeOracleManagerStagedOperation, loadCoordinatorInitialReportFundingRequirement, loadOracleManagerDetails, requestOraclePrice } from '../../../protocol/index.js';
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js';
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js';
import { getErrorMessage } from '@zoltar/ui-core-shared/lib/errors.js';
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js';
import { getOracleRequestEthGuardMessage } from '../lib/oracleRequestEth.js';
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js';
import { createPoolOracleSuccessPresentation, createPoolOracleTransactionIntent, createPoolOracleWarningPresentation } from '../../transactionPresentations.js';
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js';
import { runWriteAction } from '@zoltar/ui-core-shared/lib/writeAction.js';
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js';
const defaultUsePriceOracleManagerDependencies = {
    createConnectedReadClient,
    createWalletWriteClient,
    executeOracleManagerStagedOperation: async (client, managerAddress, operationId) => await executeOracleManagerStagedOperation(client, managerAddress, operationId),
    loadCoordinatorInitialReportFundingRequirement: async (client, managerAddress, walletAddress) => await loadCoordinatorInitialReportFundingRequirement(client, managerAddress, walletAddress),
    loadOracleManagerDetails: async (managerAddress) => await loadOracleManagerDetails(createConnectedReadClient(), managerAddress),
    requestOraclePrice: async (client, managerAddress, proposedRepPerEthPrice, requestedInitialAttoWeth, reviewedRequestValueAttoEth) => await requestOraclePrice(client, managerAddress, proposedRepPerEthPrice, requestedInitialAttoWeth, reviewedRequestValueAttoEth),
};
function usePriceOracleManagerWithDependencies({ accountAddress, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }, dependencies) {
    const poolOracleManagerLoad = useLoadController();
    const poolOracleActiveAction = useSignal(undefined);
    const poolOracleFeedback = useSignal(undefined);
    const poolOracleManagerDetails = useSignal(undefined);
    const poolOracleManagerError = useSignal(undefined);
    const poolOracleManagerErrorAddress = useSignal(undefined);
    const poolPriceOracleResult = useSignal(undefined);
    const nextPoolOracleManagerLoad = useRequestGuard();
    const getPendingTitle = (actionName) => {
        if (actionName === 'requestPrice')
            return 'Requesting price';
        return 'Executing staged operation';
    };
    const getSuccessTitle = (actionName) => {
        if (actionName === 'requestPrice')
            return 'Price requested';
        return 'Staged operation executed';
    };
    const getFailureTitle = (actionName) => {
        if (actionName === 'requestPrice')
            return 'Price request failed';
        return 'Staged operation failed';
    };
    const loadPoolOracleManager = async (managerAddress) => {
        const isCurrent = nextPoolOracleManagerLoad();
        await poolOracleManagerLoad.run({
            isCurrent,
            onStart: () => {
                poolOracleManagerError.value = undefined;
                poolOracleManagerErrorAddress.value = undefined;
            },
            load: async () => await dependencies.loadOracleManagerDetails(managerAddress),
            onSuccess: details => {
                poolOracleManagerDetails.value = details;
            },
            onError: error => {
                poolOracleManagerError.value = getErrorMessage(error, 'Failed to load price oracle details');
                poolOracleManagerErrorAddress.value = managerAddress;
            },
        });
    };
    const requestPoolPrice = async (managerAddress, securityPoolAddress, reviewedRequestValueAttoEth) => {
        const transactionContext = { managerAddress, securityPoolAddress };
        poolPriceOracleResult.value = undefined;
        try {
            poolOracleActiveAction.value = 'requestPrice';
            poolOracleFeedback.value = createPendingActionFeedback('requestPrice', getPendingTitle('requestPrice'));
            await runWriteAction({
                accountAddress,
                missingWalletMessage: 'Connect a wallet before requesting a price',
                onRefreshError: (message, hash) => {
                    poolOracleFeedback.value = createWarningActionFeedback('requestPrice', getSuccessTitle('requestPrice'), message, hash);
                    const result = poolPriceOracleResult.value;
                    if (result !== undefined)
                        onTransactionPresented(createPoolOracleWarningPresentation(result, message, transactionContext));
                },
                onTransactionFailed,
                onTransactionFinished,
                onTransactionRequested: () => onTransactionRequested(createPoolOracleTransactionIntent('requestPrice', transactionContext)),
                onWriteError: message => {
                    poolOracleFeedback.value = createErrorActionFeedback('requestPrice', getFailureTitle('requestPrice'), message);
                },
                refreshErrorFallback: 'Price request succeeded, but refreshing price oracle details failed',
                refreshState: async () => {
                    await refreshWalletStateOnly(refreshState);
                    await loadPoolOracleManager(managerAddress);
                },
                setErrorMessage: message => {
                    poolOracleManagerError.value = message;
                    poolOracleManagerErrorAddress.value = managerAddress;
                },
            }, async (walletAddress) => {
                const refreshedManagerDetails = await dependencies.loadOracleManagerDetails(managerAddress);
                poolOracleManagerDetails.value = refreshedManagerDetails;
                if (refreshedManagerDetails?.isPriceValid)
                    throw new Error('A fresh oracle price is already available');
                if ((refreshedManagerDetails?.pendingReportId ?? 0n) > 0n)
                    throw new Error('Oracle price request is already pending');
                const writeClient = dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted });
                const initialReportFunding = await dependencies.loadCoordinatorInitialReportFundingRequirement(writeClient, managerAddress, walletAddress);
                if (initialReportFunding.currentRepBalanceAttoRep < initialReportFunding.initialReportAmount2) {
                    throw new Error(`Need ${formatCurrencyBalance(initialReportFunding.initialReportAmount2 - initialReportFunding.currentRepBalanceAttoRep)} more REP in this wallet to fund the initial report.`);
                }
                const walletBalanceAttoEth = await dependencies.createConnectedReadClient().getBalance({ address: walletAddress });
                const totalRequiredEth = reviewedRequestValueAttoEth + initialReportFunding.wethShortfallAttoEth;
                if (walletBalanceAttoEth < totalRequiredEth) {
                    throw new Error(`Need ${formatCurrencyBalance(totalRequiredEth - walletBalanceAttoEth)} more ETH in this wallet to fund the initial report and request a new price.`);
                }
                const requestPriceGuardMessage = getOracleRequestEthGuardMessage({
                    actionLabel: 'request a new price',
                    requiredCostAttoEth: reviewedRequestValueAttoEth,
                    walletBalanceAttoEth,
                });
                if (requestPriceGuardMessage !== undefined)
                    throw new Error(requestPriceGuardMessage);
                return await dependencies.requestOraclePrice(writeClient, managerAddress, initialReportFunding.proposedRepPerEthPrice, 0n, reviewedRequestValueAttoEth);
            }, 'Failed to request price', result => {
                poolPriceOracleResult.value = result;
                poolOracleFeedback.value = createSuccessActionFeedback('requestPrice', getSuccessTitle('requestPrice'), result.hash);
                onTransactionPresented(createPoolOracleSuccessPresentation(result, transactionContext));
            });
        }
        finally {
            poolOracleActiveAction.value = undefined;
        }
    };
    const executePendingPoolOperation = async (managerAddress, operationId, securityPoolAddress) => {
        const transactionContext = { managerAddress, securityPoolAddress };
        poolPriceOracleResult.value = undefined;
        try {
            poolOracleActiveAction.value = 'executeStagedOperation';
            poolOracleFeedback.value = createPendingActionFeedback('executeStagedOperation', getPendingTitle('executeStagedOperation'));
            await runWriteAction({
                accountAddress,
                missingWalletMessage: 'Connect a wallet before executing a staged operation',
                onRefreshError: (message, hash) => {
                    poolOracleFeedback.value = createWarningActionFeedback('executeStagedOperation', getSuccessTitle('executeStagedOperation'), message, hash);
                    const result = poolPriceOracleResult.value;
                    if (result !== undefined)
                        onTransactionPresented(createPoolOracleWarningPresentation(result, message, transactionContext));
                },
                onTransactionFailed,
                onTransactionFinished,
                onTransactionRequested: () => onTransactionRequested(createPoolOracleTransactionIntent('executeStagedOperation', transactionContext)),
                onWriteError: message => {
                    poolOracleFeedback.value = createErrorActionFeedback('executeStagedOperation', getFailureTitle('executeStagedOperation'), message);
                },
                refreshErrorFallback: 'Staged operation execution succeeded, but refreshing price oracle details failed',
                refreshState: async () => {
                    await refreshWalletStateOnly(refreshState);
                    await loadPoolOracleManager(managerAddress);
                },
                setErrorMessage: message => {
                    poolOracleManagerError.value = message;
                    poolOracleManagerErrorAddress.value = managerAddress;
                },
            }, async (walletAddress) => await dependencies.executeOracleManagerStagedOperation(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), managerAddress, operationId), 'Failed to execute staged operation', result => {
                poolPriceOracleResult.value = result;
                poolOracleFeedback.value = createSuccessActionFeedback('executeStagedOperation', getSuccessTitle('executeStagedOperation'), result.hash);
                onTransactionPresented(createPoolOracleSuccessPresentation(result, transactionContext));
            });
        }
        finally {
            poolOracleActiveAction.value = undefined;
        }
    };
    return {
        executePendingPoolOperation,
        loadingPoolOracleManager: poolOracleManagerLoad.isLoading.value,
        loadPoolOracleManager,
        poolOracleActiveAction: poolOracleActiveAction.value,
        poolOracleFeedback: poolOracleFeedback.value,
        poolOracleManagerDetails: poolOracleManagerDetails.value,
        poolOracleManagerError: poolOracleManagerError.value,
        poolOracleManagerErrorAddress: poolOracleManagerErrorAddress.value,
        poolPriceOracleResult: poolPriceOracleResult.value,
        requestPoolPrice,
    };
}
export function usePriceOracleManager(parameters, dependencies) {
    if (dependencies === undefined)
        return usePriceOracleManagerWithDependencies(parameters, defaultUsePriceOracleManagerDependencies);
    return usePriceOracleManagerWithDependencies(parameters, dependencies);
}
//# sourceMappingURL=usePriceOracleManager.js.map
import { useSignal } from '@preact/signals';
import { bigintToSafeNumber, zeroAddress } from '@zoltar/shared/ethereum';
import { useEffect, useRef } from 'preact/hooks';
import { useFormState } from '@zoltar/ui-core-shared/hooks/useFormState.js';
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js';
import { ABIS } from '@zoltar/ui-core-shared/abis.js';
import { approveErc20, createOpenOracleReportInstance, disputeOracleReport, getOpenOracleAddress, isOpenOracleReportMissingError, loadOpenOracleReportDetails, loadOpenOracleWithdrawableBalances, readOptionalMulticall, settleOracleReport, withdrawOpenOracleBalance } from '../../../protocol/index.js';
import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js';
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js';
import { getErrorMessage, isRecoverableContractReadError } from '@zoltar/ui-core-shared/lib/errors.js';
import { deriveOpenOracleDisputeSubmissionDetails, formatOpenOracleDisputeWriteErrorMessage, formatOpenOracleSettleWriteErrorMessage, getOpenOracleCreateGuardMessage, getOpenOracleCreateValidationMessage, getOpenOracleSelectedReportActionMode, getOpenOracleSettleAvailability, parseOpenOracleCreateFormSubmission, } from '../lib/openOracle.js';
import { parseAddressInput, parseReportIdInput } from '@zoltar/ui-core-shared/lib/inputs.js';
import { getDefaultOpenOracleCreateFormState, getDefaultOpenOracleFormState } from '../../../lib/formDefaults.js';
import { requireDefined } from '@zoltar/ui-core-shared/lib/required.js';
import { formatTokenApprovalUnavailableMessage } from '@zoltar/ui-core-shared/lib/tokenApproval.js';
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js';
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js';
import { createOpenOracleSuccessPresentation, createOpenOracleTransactionIntent, createOpenOracleWarningPresentation } from '../../transactionPresentations.js';
import { buildWriteActionConfig, runWriteAction } from '@zoltar/ui-core-shared/lib/writeAction.js';
import { refreshWalletStateOnly } from '@zoltar/ui-core-shared/lib/refreshState.js';
import * as openOracleCopy from '../../../copy/openOracle.js';
const defaultUseOpenOracleOperationsDependencies = {
    approveErc20: async (client, tokenAddress, spenderAddress, amount, action) => await approveErc20(client, tokenAddress, spenderAddress, amount, action),
    createConnectedReadClient: () => {
        const client = createConnectedReadClient();
        return {
            getBalance: async (parameters) => await client.getBalance(parameters),
            readContract: async (parameters) => await client.readContract(parameters),
        };
    },
    createOpenOracleReportInstance: async (client, parameters) => await createOpenOracleReportInstance(client, parameters),
    createWalletWriteClient,
    disputeOracleReport: async (client, openOracleAddress, reportId, tokenToSwap, newAmount1, newAmount2, currentAmount2, stateHash) => await disputeOracleReport(client, openOracleAddress, reportId, tokenToSwap, newAmount1, newAmount2, currentAmount2, stateHash),
    loadOpenOracleReportDetails: async (openOracleAddress, reportId) => await loadOpenOracleReportDetails(createConnectedReadClient(), openOracleAddress, reportId),
    loadOpenOracleWithdrawableBalances: async (openOracleAddress, holder, token1, token2) => await loadOpenOracleWithdrawableBalances(createConnectedReadClient(), openOracleAddress, holder, token1, token2),
    readOptionalMulticall: async (contracts) => await readOptionalMulticall(createConnectedReadClient(), contracts),
    settleOracleReport: async (client, openOracleAddress, reportId) => await settleOracleReport(client, openOracleAddress, reportId),
    withdrawOpenOracleBalance: async (client, openOracleAddress, token, amount, recipient) => await withdrawOpenOracleBalance(client, openOracleAddress, token, amount, recipient),
};
function parseTokenDecimals(value) {
    let decimals;
    if (typeof value === 'bigint')
        decimals = bigintToSafeNumber(value, 'Token decimals');
    if (typeof value === 'number')
        decimals = value;
    return decimals !== undefined && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : undefined;
}
async function readCreateTokenDecimals(readClient, address, label) {
    try {
        const value = await readClient.readContract({ abi: ABIS.mainnet.erc20, address, args: [], functionName: 'decimals' });
        const decimals = parseTokenDecimals(value);
        return decimals === undefined ? { message: `${label} token address is not a readable ERC-20 contract.`, status: 'failure' } : { decimals, status: 'success' };
    }
    catch (error) {
        if (!isRecoverableContractReadError(error))
            throw error;
        return { message: `${label} token address is not a readable ERC-20 contract.`, status: 'failure' };
    }
}
function getRefreshedOpenOracleApprovalAmount({ approvalError, explicitAmount, requirement, tokenLabel }) {
    if (requirement.requiredAmount === undefined || requirement.requiredAmount <= 0n)
        throw new Error(`No ${tokenLabel} approval is required for the refreshed report`);
    if (requirement.approvedAmount === undefined) {
        throw new Error(formatTokenApprovalUnavailableMessage({
            actionLabel: 'submitting this approval',
            reason: approvalError,
            tokenLabel,
        }));
    }
    if (requirement.hasSufficientApproval)
        throw new Error(`The ${tokenLabel} approval is already sufficient for the refreshed report`);
    const approvalAmount = explicitAmount ?? requirement.targetAmount;
    if (approvalAmount === undefined)
        throw new Error(`No ${tokenLabel} approval amount is required for the refreshed report`);
    if (approvalAmount <= requirement.approvedAmount)
        throw new Error(`The ${tokenLabel} approval must increase the current allowance`);
    if (approvalAmount < requirement.requiredAmount)
        throw new Error(`The ${tokenLabel} approval must cover the refreshed dispute requirement`);
    return approvalAmount;
}
function toReadError(error) {
    return error instanceof Error ? error : new Error('Unknown read error');
}
function toBigIntReadResult(result) {
    if (result.status === 'success') {
        if (typeof result.result !== 'bigint') {
            return {
                error: new Error('Unexpected non-bigint OpenOracle token access value'),
                status: 'failure',
            };
        }
        return {
            result: result.result,
            status: 'success',
        };
    }
    return {
        error: toReadError(result.error),
        status: 'failure',
    };
}
function useOpenOracleOperationsWithDependencies({ accountAddress, enabled, onReportSettled, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState }, dependencies) {
    const loadingOpenOracleCreate = useSignal(false);
    const oracleReportLoad = useLoadController();
    const openOracleTokenAccessLoad = useLoadController();
    const openOracleWithdrawableBalanceLoad = useLoadController();
    const { state: openOracleCreateForm, setState: setOpenOracleCreateFormState } = useFormState(getDefaultOpenOracleCreateFormState());
    const openOracleCreateFieldErrors = useSignal({});
    const openOracleError = useSignal(undefined);
    const openOracleActiveAction = useSignal(undefined);
    const openOracleActiveWithdrawalBalance = useSignal(undefined);
    const openOracleFeedback = useSignal(undefined);
    const { state: openOracleForm, setState: setOpenOracleFormState } = useFormState(getDefaultOpenOracleFormState());
    const openOracleResult = useSignal(undefined);
    const openOracleReportDetails = useSignal(undefined);
    const openOracleReportLookupState = useSignal('unknown');
    const openOracleWithdrawalBalanceChecking = useSignal(false);
    const openOracleWithdrawalReviewMessage = useSignal(undefined);
    const openOracleWithdrawableBalances = useSignal(undefined);
    const openOracleWithdrawableBalancesError = useSignal(undefined);
    const loadedOpenOracleReportId = useSignal(undefined);
    const openOracleToken1Approval = useSignal({
        error: undefined,
        loading: false,
        value: undefined,
    });
    const openOracleToken2Approval = useSignal({
        error: undefined,
        loading: false,
        value: undefined,
    });
    const openOracleToken1Balance = useSignal(undefined);
    const openOracleToken1BalanceError = useSignal(undefined);
    const openOracleToken2Balance = useSignal(undefined);
    const openOracleToken2BalanceError = useSignal(undefined);
    const openOracleTokenAccessLoadingInitial = useSignal(false);
    const openOracleTokenAccessRefreshing = useSignal(false);
    const nextOpenOracleTokenAccessLoad = useRequestGuard();
    const nextOpenOracleWithdrawableBalanceLoad = useRequestGuard();
    const nextOpenOracleWithdrawalAttempt = useRequestGuard();
    const nextOracleReportLoad = useRequestGuard();
    const setOpenOracleCreateForm = (updater) => {
        setOpenOracleCreateFormState(current => {
            const next = updater(current);
            const currentErrors = openOracleCreateFieldErrors.value;
            openOracleCreateFieldErrors.value = {
                ...(next.token1Address === current.token1Address && currentErrors.token1Address !== undefined ? { token1Address: currentErrors.token1Address } : {}),
                ...(next.token2Address === current.token2Address && currentErrors.token2Address !== undefined ? { token2Address: currentErrors.token2Address } : {}),
            };
            return next;
        });
    };
    const currentSelectedReportIdInput = openOracleForm.value.reportId.trim();
    const accountAddressRef = useRef(accountAddress);
    accountAddressRef.current = accountAddress;
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;
    const currentSelectedReportIdRef = useRef(currentSelectedReportIdInput);
    currentSelectedReportIdRef.current = currentSelectedReportIdInput;
    const getPendingTitle = (actionName) => {
        switch (actionName) {
            case 'approveToken1':
                return 'Approving base token';
            case 'approveToken2':
                return 'Approving quote token';
            case 'createReportInstance':
                return 'Creating standalone oracle report';
            case 'dispute':
                return 'Submitting dispute';
            case 'executeStagedOperation':
                return 'Executing staged operation';
            case 'queueOperation':
                return 'Queueing operation';
            case 'requestPrice':
                return 'Requesting price';
            case 'settle':
                return 'Settling report';
            case 'withdrawBalance':
                return 'Withdrawing Oracle balance';
            case 'wrapWeth':
                return 'Wrapping ETH to WETH';
            default:
                return assertNever(actionName);
        }
    };
    const getSuccessTitle = (actionName) => {
        switch (actionName) {
            case 'approveToken1':
                return 'Base token approved';
            case 'approveToken2':
                return 'Quote token approved';
            case 'createReportInstance':
                return 'Standalone oracle report created';
            case 'dispute':
                return 'Dispute submitted';
            case 'executeStagedOperation':
                return 'Staged operation executed';
            case 'queueOperation':
                return 'Operation queued';
            case 'requestPrice':
                return 'Price requested';
            case 'settle':
                return 'Report settled';
            case 'withdrawBalance':
                return 'Oracle balance withdrawn';
            case 'wrapWeth':
                return 'ETH wrapped to WETH';
            default:
                return assertNever(actionName);
        }
    };
    const getFailureTitle = (actionName) => {
        switch (actionName) {
            case 'approveToken1':
                return 'Base token approval failed';
            case 'approveToken2':
                return 'Quote token approval failed';
            case 'createReportInstance':
                return 'Report creation failed';
            case 'dispute':
                return 'Dispute failed';
            case 'executeStagedOperation':
                return 'Staged operation failed';
            case 'queueOperation':
                return 'Queue operation failed';
            case 'requestPrice':
                return 'Price request failed';
            case 'settle':
                return 'Settlement failed';
            case 'withdrawBalance':
                return 'Oracle balance withdrawal failed';
            case 'wrapWeth':
                return 'ETH wrap failed';
            default:
                return assertNever(actionName);
        }
    };
    const setOpenOracleTokenAccessMode = (mode) => {
        openOracleTokenAccessLoadingInitial.value = mode === 'initial';
        openOracleTokenAccessRefreshing.value = mode === 'background';
    };
    const isSelectedReportCurrent = (reportIdInput) => currentSelectedReportIdRef.current === reportIdInput.trim();
    const resetOpenOracleTokenApprovalState = (loading) => {
        openOracleToken1Approval.value = {
            error: undefined,
            loading,
            value: undefined,
        };
        openOracleToken2Approval.value = {
            error: undefined,
            loading,
            value: undefined,
        };
    };
    const resetOpenOracleTokenBalanceState = () => {
        openOracleToken1Balance.value = undefined;
        openOracleToken1BalanceError.value = undefined;
        openOracleToken2Balance.value = undefined;
        openOracleToken2BalanceError.value = undefined;
    };
    const resetOpenOracleTokenAccessState = (approvalLoading) => {
        resetOpenOracleTokenApprovalState(approvalLoading);
        resetOpenOracleTokenBalanceState();
        setOpenOracleTokenAccessMode('idle');
    };
    const getTokenApprovalState = (result) => {
        if (result.status === 'success')
            return {
                error: undefined,
                loading: false,
                value: result.result,
            };
        return {
            error: getErrorMessage(result.error, 'Failed to load token approval'),
            loading: false,
            value: undefined,
        };
    };
    const getTokenBalanceState = (result) => {
        if (result.status === 'success')
            return {
                amount: result.result,
                error: undefined,
            };
        return {
            amount: undefined,
            error: getErrorMessage(result.error, 'Failed to load token balance'),
        };
    };
    const refreshOpenOracleWithdrawableBalances = async (details) => {
        const isCurrent = nextOpenOracleWithdrawableBalanceLoad();
        const holder = accountAddress;
        if (details === undefined || holder === undefined) {
            openOracleWithdrawableBalances.value = undefined;
            openOracleWithdrawableBalancesError.value = undefined;
            return;
        }
        const currentReportIdInput = details.reportId.toString();
        await openOracleWithdrawableBalanceLoad.run({
            isCurrent: () => isCurrent() && isSelectedReportCurrent(currentReportIdInput),
            onStart: () => {
                openOracleWithdrawableBalancesError.value = undefined;
            },
            load: async () => await dependencies.loadOpenOracleWithdrawableBalances(getOpenOracleAddress(), holder, details.token1, details.token2),
            onSuccess: balances => {
                openOracleWithdrawableBalances.value = balances;
            },
            onError: error => {
                openOracleWithdrawableBalancesError.value = getErrorMessage(error, 'Failed to load Open Oracle balances');
            },
        });
    };
    const applyLoadedOracleReport = (details) => {
        openOracleReportDetails.value = details;
        loadedOpenOracleReportId.value = details.reportId;
        openOracleForm.value = {
            ...openOracleForm.value,
            reportId: details.reportId.toString(),
            stateHash: details.stateHash,
        };
    };
    const refreshOpenOracleTokenAccess = async (details, { preserveExisting = false } = {}) => {
        const currentDetails = details;
        const isCurrent = nextOpenOracleTokenAccessLoad();
        if (currentDetails === undefined) {
            resetOpenOracleTokenAccessState(false);
            return;
        }
        const currentReportIdInput = currentDetails.reportId.toString();
        const isCurrentSelectedReport = () => isSelectedReportCurrent(currentReportIdInput);
        try {
            await openOracleTokenAccessLoad.run({
                isCurrent: () => isCurrent() && isCurrentSelectedReport(),
                onStart: () => {
                    setOpenOracleTokenAccessMode(preserveExisting ? 'background' : 'initial');
                    if (!preserveExisting) {
                        resetOpenOracleTokenAccessState(accountAddress !== undefined);
                        setOpenOracleTokenAccessMode('initial');
                    }
                    else {
                        openOracleToken1Approval.value = {
                            ...openOracleToken1Approval.value,
                            loading: false,
                        };
                        openOracleToken2Approval.value = {
                            ...openOracleToken2Approval.value,
                            loading: false,
                        };
                    }
                },
                load: async () => {
                    if (accountAddress === undefined)
                        return {
                            token1ApprovalResult: { error: undefined, loading: false, value: undefined },
                            token2ApprovalResult: { error: undefined, loading: false, value: undefined },
                            token1BalanceResult: { amount: undefined, error: undefined },
                            token2BalanceResult: { amount: undefined, error: undefined },
                        };
                    const tokenAccessReadResults = await dependencies
                        .readOptionalMulticall([
                        {
                            abi: ABIS.mainnet.erc20,
                            functionName: 'allowance',
                            address: currentDetails.token1,
                            args: [accountAddress, getOpenOracleAddress()],
                        },
                        {
                            abi: ABIS.mainnet.erc20,
                            functionName: 'allowance',
                            address: currentDetails.token2,
                            args: [accountAddress, getOpenOracleAddress()],
                        },
                        {
                            abi: ABIS.mainnet.erc20,
                            functionName: 'balanceOf',
                            address: currentDetails.token1,
                            args: [accountAddress],
                        },
                        {
                            abi: ABIS.mainnet.erc20,
                            functionName: 'balanceOf',
                            address: currentDetails.token2,
                            args: [accountAddress],
                        },
                    ])
                        .catch(error => {
                        const failureResult = {
                            error: toReadError(error),
                            status: 'failure',
                        };
                        return [failureResult, failureResult, failureResult, failureResult];
                    });
                    const [token1ApprovalReadResult, token2ApprovalReadResult, token1BalanceReadResult, token2BalanceReadResult] = tokenAccessReadResults.map(toBigIntReadResult);
                    if (token1ApprovalReadResult === undefined || token2ApprovalReadResult === undefined || token1BalanceReadResult === undefined || token2BalanceReadResult === undefined)
                        throw new Error('Unexpected token access response');
                    return {
                        token1ApprovalResult: getTokenApprovalState(token1ApprovalReadResult),
                        token2ApprovalResult: getTokenApprovalState(token2ApprovalReadResult),
                        token1BalanceResult: getTokenBalanceState(token1BalanceReadResult),
                        token2BalanceResult: getTokenBalanceState(token2BalanceReadResult),
                    };
                },
                onSuccess: ({ token1ApprovalResult, token2ApprovalResult, token1BalanceResult, token2BalanceResult }) => {
                    openOracleToken1Approval.value = token1ApprovalResult;
                    openOracleToken2Approval.value = token2ApprovalResult;
                    openOracleToken1Balance.value = token1BalanceResult.amount;
                    openOracleToken1BalanceError.value = token1BalanceResult.error;
                    openOracleToken2Balance.value = token2BalanceResult.amount;
                    openOracleToken2BalanceError.value = token2BalanceResult.error;
                },
                onError: () => undefined,
            });
        }
        finally {
            if (isCurrent() && isCurrentSelectedReport())
                setOpenOracleTokenAccessMode('idle');
        }
    };
    const loadOracleReportById = async (reportId) => await dependencies.loadOpenOracleReportDetails(getOpenOracleAddress(), reportId);
    const setOpenOracleForm = (updater) => {
        setOpenOracleFormState(current => {
            const next = updater(current);
            const nextReportId = next.reportId.trim();
            if (nextReportId === current.reportId.trim())
                return next;
            currentSelectedReportIdRef.current = nextReportId;
            openOracleReportLookupState.value = 'unknown';
            openOracleReportDetails.value = undefined;
            loadedOpenOracleReportId.value = undefined;
            openOracleError.value = undefined;
            resetOpenOracleTokenAccessState(false);
            return { ...getDefaultOpenOracleFormState(), reportId: next.reportId };
        });
    };
    const loadOracleReport = async (reportIdInput) => {
        const requestedReportIdInput = reportIdInput?.trim() ?? currentSelectedReportIdInput;
        if (reportIdInput !== undefined)
            setOpenOracleForm(current => ({ ...current, reportId: requestedReportIdInput }));
        const isCurrentLoad = nextOracleReportLoad();
        await oracleReportLoad.run({
            onStart: () => {
                openOracleError.value = undefined;
                openOracleReportLookupState.value = 'loading';
            },
            load: async () => {
                const reportIdValue = reportIdInput?.trim() ?? openOracleForm.value.reportId;
                const reportId = parseReportIdInput(reportIdValue);
                const details = await loadOracleReportById(reportId);
                if (!isCurrentLoad() || !isSelectedReportCurrent(requestedReportIdInput))
                    throw new Error('Stale oracle report load');
                return { details, reportId };
            },
            onSuccess: ({ details }) => {
                if (!isCurrentLoad() || !isSelectedReportCurrent(requestedReportIdInput))
                    return;
                applyLoadedOracleReport(details);
                openOracleReportLookupState.value = 'ready';
            },
            onError: (error) => {
                if (!isCurrentLoad() || !isSelectedReportCurrent(requestedReportIdInput))
                    return;
                openOracleReportDetails.value = undefined;
                loadedOpenOracleReportId.value = undefined;
                resetOpenOracleTokenAccessState(false);
                const reportMissing = isOpenOracleReportMissingError(error);
                openOracleReportLookupState.value = reportMissing ? 'missing' : 'load-failed';
                openOracleError.value = reportMissing ? undefined : getErrorMessage(error, 'Failed to load oracle report');
            },
        });
    };
    const ensureLoadedSelectedReport = async ({ forceReload = false, reportIdInput, requireCurrentSelection = false } = {}) => {
        const selectedReportIdInput = reportIdInput?.trim() ?? currentSelectedReportIdInput;
        const reportId = parseReportIdInput(selectedReportIdInput);
        if (!forceReload && openOracleReportDetails.value !== undefined && loadedOpenOracleReportId.value === reportId)
            return { reportId, details: openOracleReportDetails.value };
        const details = await loadOracleReportById(reportId);
        if (requireCurrentSelection && !isSelectedReportCurrent(selectedReportIdInput))
            throw new Error('Selected report changed. Review the current report and try again.');
        applyLoadedOracleReport(details);
        return {
            details,
            reportId,
        };
    };
    const assertSelectedReportCurrent = (reportIdInput) => {
        if (!isSelectedReportCurrent(reportIdInput))
            throw new Error('Selected report changed. Review the current report and try again.');
    };
    const requireLoadedCurrentSelectedReport = () => {
        const reportDetails = requireDefined(openOracleReportDetails.value, 'Select an oracle report first');
        assertSelectedReportCurrent(reportDetails.reportId.toString());
        return reportDetails;
    };
    const getDisputeSubmission = (reportDetails, form = openOracleForm.value) => deriveOpenOracleDisputeSubmissionDetails({
        accountAddress,
        approvedToken1Amount: openOracleToken1Approval.value.value,
        approvedToken2Amount: openOracleToken2Approval.value.value,
        disputeNewAmount1Input: form.disputeNewAmount1,
        disputeNewAmount2Input: form.disputeNewAmount2,
        disputeTokenToSwap: form.disputeTokenToSwap,
        reportDetails,
        token1AllowanceError: openOracleToken1Approval.value.error,
        token1Balance: openOracleToken1Balance.value,
        token1BalanceError: openOracleToken1BalanceError.value,
        token1Decimals: reportDetails.token1Decimals,
        token2AllowanceError: openOracleToken2Approval.value.error,
        token2Balance: openOracleToken2Balance.value,
        token2BalanceError: openOracleToken2BalanceError.value,
        token2Decimals: reportDetails.token2Decimals,
    });
    const runOracleAction = async (actionName, action, errorFallback, options) => {
        if (openOracleActiveAction.value !== undefined || openOracleWithdrawalBalanceChecking.value)
            return;
        openOracleActiveAction.value = actionName;
        openOracleResult.value = undefined;
        const actionReportIdInput = currentSelectedReportIdInput;
        const reportDetailsSnapshot = openOracleReportDetails.value;
        const withdrawalTokenSymbol = (() => {
            if (actionName !== 'withdrawBalance' || reportDetailsSnapshot === undefined)
                return undefined;
            if (openOracleActiveWithdrawalBalance.value === 'ethAttoEth')
                return 'ETH';
            if (openOracleActiveWithdrawalBalance.value === 'token1')
                return reportDetailsSnapshot.token1Symbol;
            if (openOracleActiveWithdrawalBalance.value === 'token2')
                return reportDetailsSnapshot.token2Symbol;
            return undefined;
        })();
        const transactionContext = actionName === 'createReportInstance'
            ? { tokenPair: `${openOracleCreateForm.value.token1Address} / ${openOracleCreateForm.value.token2Address}` }
            : {
                openOracleAddress: reportDetailsSnapshot?.openOracleAddress,
                reportId: actionReportIdInput,
                token1Symbol: reportDetailsSnapshot?.token1Symbol,
                token2Symbol: reportDetailsSnapshot?.token2Symbol,
                tokenPair: reportDetailsSnapshot === undefined ? undefined : `${reportDetailsSnapshot.token1Symbol} / ${reportDetailsSnapshot.token2Symbol}`,
                withdrawalTokenSymbol,
            };
        try {
            openOracleFeedback.value = createPendingActionFeedback(actionName, getPendingTitle(actionName));
            await runWriteAction({
                ...buildWriteActionConfig({ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, refreshState }, openOracleError, 'Connect a wallet before operating Open Oracle', createOpenOracleTransactionIntent(actionName, transactionContext)),
                formatErrorMessage: options?.formatErrorMessage,
                onRefreshError: (message, hash) => {
                    openOracleFeedback.value = createWarningActionFeedback(actionName, getSuccessTitle(actionName), message, hash);
                    const result = openOracleResult.value;
                    if (result !== undefined)
                        onTransactionPresented(createOpenOracleWarningPresentation(result, message, transactionContext));
                },
                onWriteError: message => {
                    openOracleFeedback.value = createErrorActionFeedback(actionName, getFailureTitle(actionName), message);
                },
                refreshErrorFallback: 'Oracle transaction succeeded, but refreshing the selected report failed',
                refreshState: async () => {
                    await refreshWalletStateOnly(refreshState);
                },
            }, async (walletAddress) => {
                return await action(walletAddress);
            }, errorFallback, async (result) => {
                openOracleResult.value = result;
                openOracleFeedback.value = createSuccessActionFeedback(actionName, getSuccessTitle(actionName), result.hash);
                onTransactionPresented(createOpenOracleSuccessPresentation(result, transactionContext));
                if (result.action === 'createReportInstance') {
                    openOracleCreateForm.value = getDefaultOpenOracleCreateFormState();
                    openOracleCreateFieldErrors.value = {};
                }
                if (result.action === 'settle')
                    await onReportSettled?.();
                if (result.action !== 'createReportInstance' && actionReportIdInput !== '' && isSelectedReportCurrent(actionReportIdInput)) {
                    await ensureLoadedSelectedReport({ forceReload: true, reportIdInput: actionReportIdInput, requireCurrentSelection: true });
                }
                if ((result.action === 'settle' || result.action === 'withdrawBalance') && actionReportIdInput !== '' && isSelectedReportCurrent(actionReportIdInput)) {
                    await refreshOpenOracleWithdrawableBalances(openOracleReportDetails.value);
                }
                if (options?.refreshTokenAccessOnSuccess === true && actionReportIdInput !== '' && isSelectedReportCurrent(actionReportIdInput)) {
                    await refreshOpenOracleTokenAccess(openOracleReportDetails.value, { preserveExisting: true });
                }
            });
        }
        finally {
            openOracleActiveAction.value = undefined;
        }
    };
    const approveToken1 = async (amount) => await (() => {
        const submittedOpenOracleForm = openOracleForm.value;
        return runOracleAction('approveToken1', async (walletAddress) => {
            const cachedReportDetails = requireLoadedCurrentSelectedReport();
            const cachedDisputeSubmission = getDisputeSubmission(cachedReportDetails, submittedOpenOracleForm);
            const { details: reportDetails } = await ensureLoadedSelectedReport({
                forceReload: true,
                reportIdInput: submittedOpenOracleForm.reportId,
                requireCurrentSelection: true,
            });
            if (getOpenOracleSelectedReportActionMode(reportDetails) !== 'dispute')
                throw new Error('Token approvals are only available while disputing a report');
            const refreshedDisputeSubmission = getDisputeSubmission(reportDetails, submittedOpenOracleForm);
            if (refreshedDisputeSubmission.inputBlockMessage !== undefined)
                throw new Error(refreshedDisputeSubmission.inputBlockMessage.message);
            if (amount !== undefined && refreshedDisputeSubmission.token1ContributionAmount !== cachedDisputeSubmission.token1ContributionAmount) {
                throw new Error('The required base token approval changed. Review the refreshed report and try again.');
            }
            await refreshOpenOracleTokenAccess(reportDetails, { preserveExisting: true });
            assertSelectedReportCurrent(reportDetails.reportId.toString());
            const disputeSubmission = getDisputeSubmission(reportDetails, submittedOpenOracleForm);
            if (disputeSubmission.inputBlockMessage !== undefined)
                throw new Error(disputeSubmission.inputBlockMessage.message);
            const approvalAmount = getRefreshedOpenOracleApprovalAmount({
                approvalError: openOracleToken1Approval.value.error,
                explicitAmount: amount,
                requirement: disputeSubmission.token1Approval,
                tokenLabel: 'base token',
            });
            return await dependencies.approveErc20(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), reportDetails.token1, getOpenOracleAddress(), approvalAmount, 'approveToken1');
        }, 'Failed to approve base token', { refreshTokenAccessOnSuccess: true });
    })();
    const approveToken2 = async (amount) => await (() => {
        const submittedOpenOracleForm = openOracleForm.value;
        return runOracleAction('approveToken2', async (walletAddress) => {
            const cachedReportDetails = requireLoadedCurrentSelectedReport();
            const cachedDisputeSubmission = getDisputeSubmission(cachedReportDetails, submittedOpenOracleForm);
            const { details: reportDetails } = await ensureLoadedSelectedReport({
                forceReload: true,
                reportIdInput: submittedOpenOracleForm.reportId,
                requireCurrentSelection: true,
            });
            if (getOpenOracleSelectedReportActionMode(reportDetails) !== 'dispute')
                throw new Error('Token approvals are only available while disputing a report');
            const refreshedDisputeSubmission = getDisputeSubmission(reportDetails, submittedOpenOracleForm);
            if (refreshedDisputeSubmission.inputBlockMessage !== undefined)
                throw new Error(refreshedDisputeSubmission.inputBlockMessage.message);
            if (amount !== undefined && refreshedDisputeSubmission.token2ContributionAmount !== cachedDisputeSubmission.token2ContributionAmount) {
                throw new Error('The required quote token approval changed. Review the refreshed report and try again.');
            }
            await refreshOpenOracleTokenAccess(reportDetails, { preserveExisting: true });
            assertSelectedReportCurrent(reportDetails.reportId.toString());
            const disputeSubmission = getDisputeSubmission(reportDetails, submittedOpenOracleForm);
            if (disputeSubmission.inputBlockMessage !== undefined)
                throw new Error(disputeSubmission.inputBlockMessage.message);
            const approvalAmount = getRefreshedOpenOracleApprovalAmount({
                approvalError: openOracleToken2Approval.value.error,
                explicitAmount: amount,
                requirement: disputeSubmission.token2Approval,
                tokenLabel: 'quote token',
            });
            return await dependencies.approveErc20(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), reportDetails.token2, getOpenOracleAddress(), approvalAmount, 'approveToken2');
        }, 'Failed to approve quote token', { refreshTokenAccessOnSuccess: true });
    })();
    const createOpenOracleGame = async () => {
        const submittedOpenOracleCreateForm = openOracleCreateForm.value;
        loadingOpenOracleCreate.value = true;
        try {
            openOracleCreateFieldErrors.value = {};
            openOracleFeedback.value = undefined;
            openOracleError.value = undefined;
            const initialValidationMessage = getOpenOracleCreateValidationMessage({ form: submittedOpenOracleCreateForm });
            if (initialValidationMessage !== undefined) {
                openOracleError.value = initialValidationMessage;
                return;
            }
            const token1Address = parseAddressInput(submittedOpenOracleCreateForm.token1Address, 'Base token address');
            const token2Address = parseAddressInput(submittedOpenOracleCreateForm.token2Address, 'Quote token address');
            const readClient = dependencies.createConnectedReadClient();
            const [token1DecimalsResult, token2DecimalsResult] = await Promise.all([readCreateTokenDecimals(readClient, token1Address, 'Base'), readCreateTokenDecimals(readClient, token2Address, 'Quote')]);
            const currentOpenOracleCreateForm = openOracleCreateForm.value;
            const token1AddressIsCurrent = currentOpenOracleCreateForm.token1Address === submittedOpenOracleCreateForm.token1Address;
            const token2AddressIsCurrent = currentOpenOracleCreateForm.token2Address === submittedOpenOracleCreateForm.token2Address;
            const contractFieldErrors = {
                ...(token1AddressIsCurrent && token1DecimalsResult.status === 'failure' ? { token1Address: token1DecimalsResult.message } : {}),
                ...(token2AddressIsCurrent && token2DecimalsResult.status === 'failure' ? { token2Address: token2DecimalsResult.message } : {}),
            };
            if (!token1AddressIsCurrent || !token2AddressIsCurrent || token1DecimalsResult.status === 'failure' || token2DecimalsResult.status === 'failure') {
                openOracleCreateFieldErrors.value = contractFieldErrors;
                return;
            }
            const token1Decimals = token1DecimalsResult.decimals;
            const token2Decimals = token2DecimalsResult.decimals;
            await runOracleAction('createReportInstance', async (walletAddress) => {
                const walletBalanceAttoEth = await readClient.getBalance({ address: walletAddress });
                const createGuardMessage = getOpenOracleCreateGuardMessage({
                    ethValueInput: submittedOpenOracleCreateForm.ethValue,
                    isOnActiveAppChain: true,
                    settlerRewardInput: submittedOpenOracleCreateForm.settlerRewardEthAmount,
                    walletConnected: true,
                    walletBalanceAttoEth,
                });
                if (createGuardMessage !== undefined)
                    throw new Error(createGuardMessage);
                const preciseCreateValidationMessage = getOpenOracleCreateValidationMessage({ form: submittedOpenOracleCreateForm, token1Decimals, token2Decimals });
                if (preciseCreateValidationMessage !== undefined)
                    throw new Error(preciseCreateValidationMessage);
                return await dependencies.createOpenOracleReportInstance(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), parseOpenOracleCreateFormSubmission({ form: submittedOpenOracleCreateForm, token1Decimals, token2Decimals }));
            }, 'Failed to create standalone Open Oracle report');
        }
        finally {
            loadingOpenOracleCreate.value = false;
        }
    };
    const settleReport = async () => await runOracleAction('settle', async (walletAddress) => {
        const { details } = await ensureLoadedSelectedReport({ forceReload: true, requireCurrentSelection: true });
        const settleAvailability = getOpenOracleSettleAvailability(details);
        if (!settleAvailability.canAct)
            throw new Error(settleAvailability.message ?? 'This report is not ready to settle.');
        return await dependencies.settleOracleReport(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), getOpenOracleAddress(), details.reportId);
    }, 'Failed to settle report', { formatErrorMessage: formatOpenOracleSettleWriteErrorMessage });
    const cancelWithdrawalBalanceCheck = () => {
        if (!openOracleWithdrawalBalanceChecking.value)
            return;
        nextOpenOracleWithdrawalAttempt();
        openOracleWithdrawalBalanceChecking.value = false;
        openOracleActiveWithdrawalBalance.value = undefined;
    };
    const withdrawBalance = async (balance, reviewedAmount) => {
        if (openOracleWithdrawalBalanceChecking.value || openOracleActiveAction.value !== undefined)
            return;
        const isCurrentWithdrawalAttempt = nextOpenOracleWithdrawalAttempt();
        const attemptAccountAddress = accountAddress;
        const attemptEnabled = enabled;
        const attemptReportIdInput = currentSelectedReportIdRef.current;
        const attemptReportDetails = openOracleReportDetails.value;
        const attemptOpenOracleAddress = getOpenOracleAddress();
        const isWithdrawalContextCurrent = () => {
            if (!attemptEnabled || !enabledRef.current || accountAddressRef.current !== attemptAccountAddress || currentSelectedReportIdRef.current !== attemptReportIdInput)
                return false;
            const currentReportDetails = openOracleReportDetails.value;
            if (attemptReportDetails === undefined || currentReportDetails === undefined)
                return attemptReportDetails === currentReportDetails;
            return currentReportDetails.openOracleAddress === attemptReportDetails.openOracleAddress && currentReportDetails.reportId === attemptReportDetails.reportId && currentReportDetails.token1 === attemptReportDetails.token1 && currentReportDetails.token2 === attemptReportDetails.token2;
        };
        openOracleActiveWithdrawalBalance.value = balance;
        openOracleWithdrawalBalanceChecking.value = true;
        let currentAmount;
        let token = zeroAddress;
        let preflightCanSubmit = false;
        try {
            const holder = requireDefined(accountAddress, 'Connect a wallet before withdrawing an Open Oracle balance');
            const details = requireLoadedCurrentSelectedReport();
            const currentReportIdInput = details.reportId.toString();
            const balances = await dependencies.loadOpenOracleWithdrawableBalances(attemptOpenOracleAddress, holder, details.token1, details.token2);
            if (!isCurrentWithdrawalAttempt() || !isWithdrawalContextCurrent())
                return;
            assertSelectedReportCurrent(currentReportIdInput);
            openOracleWithdrawableBalances.value = balances;
            currentAmount = balances[balance];
            let tokenSymbol = 'ETH';
            if (balance === 'token1') {
                token = details.token1;
                tokenSymbol = details.token1Symbol;
            }
            else if (balance === 'token2') {
                token = details.token2;
                tokenSymbol = details.token2Symbol;
            }
            if (currentAmount !== reviewedAmount) {
                openOracleWithdrawalReviewMessage.value = { balance, message: openOracleCopy.formatWithdrawalBalanceChanged(tokenSymbol) };
                return;
            }
            if (currentAmount <= 0n) {
                openOracleWithdrawalReviewMessage.value = { balance, message: openOracleCopy.noWithdrawableBalanceForAsset };
                return;
            }
            preflightCanSubmit = true;
        }
        catch (error) {
            if (!isCurrentWithdrawalAttempt() || !isWithdrawalContextCurrent())
                return;
            openOracleWithdrawalReviewMessage.value = { balance, message: getErrorMessage(error, openOracleCopy.withdrawalBalanceRefreshFailed) };
            return;
        }
        finally {
            if (isCurrentWithdrawalAttempt()) {
                openOracleWithdrawalBalanceChecking.value = false;
                if (!preflightCanSubmit)
                    openOracleActiveWithdrawalBalance.value = undefined;
            }
        }
        if (!isCurrentWithdrawalAttempt() || !isWithdrawalContextCurrent()) {
            if (isCurrentWithdrawalAttempt())
                openOracleActiveWithdrawalBalance.value = undefined;
            return;
        }
        openOracleWithdrawalReviewMessage.value = undefined;
        try {
            await runOracleAction('withdrawBalance', async (walletAddress) => await dependencies.withdrawOpenOracleBalance(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), attemptOpenOracleAddress, token, currentAmount, walletAddress), 'Failed to withdraw Open Oracle balance');
        }
        finally {
            openOracleActiveWithdrawalBalance.value = undefined;
        }
    };
    const disputeReport = async () => await (() => {
        const submittedOpenOracleForm = openOracleForm.value;
        return runOracleAction('dispute', async (walletAddress) => {
            const submittedReportIdInput = submittedOpenOracleForm.reportId.trim();
            const { details } = await ensureLoadedSelectedReport({ forceReload: true, reportIdInput: submittedReportIdInput, requireCurrentSelection: true });
            const disputeInputPreflight = getDisputeSubmission(details, submittedOpenOracleForm);
            if (disputeInputPreflight.inputBlockMessage !== undefined)
                throw new Error(disputeInputPreflight.inputBlockMessage.message);
            await refreshOpenOracleTokenAccess(details, { preserveExisting: true });
            assertSelectedReportCurrent(details.reportId.toString());
            const disputeSubmission = getDisputeSubmission(details, submittedOpenOracleForm);
            if (!disputeSubmission.canSubmit || disputeSubmission.newAmount1 === undefined || disputeSubmission.newAmount2 === undefined)
                throw new Error(disputeSubmission.blockMessage?.message ?? 'Invalid dispute submission details.');
            const tokenToSwap = submittedOpenOracleForm.disputeTokenToSwap === 'token1' ? details.token1 : details.token2;
            return await dependencies.disputeOracleReport(dependencies.createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), getOpenOracleAddress(), details.reportId, tokenToSwap, disputeSubmission.newAmount1, disputeSubmission.newAmount2, details.currentAmount2, details.stateHash);
        }, 'Failed to dispute report', {
            formatErrorMessage: formatOpenOracleDisputeWriteErrorMessage,
            refreshTokenAccessOnSuccess: true,
        });
    })();
    useEffect(() => {
        cancelWithdrawalBalanceCheck();
        openOracleWithdrawalReviewMessage.value = undefined;
        if (!enabled)
            return;
        if (openOracleReportDetails.value === undefined) {
            resetOpenOracleTokenAccessState(false);
            void refreshOpenOracleWithdrawableBalances(undefined);
            return;
        }
        void refreshOpenOracleTokenAccess(openOracleReportDetails.value);
        void refreshOpenOracleWithdrawableBalances(openOracleReportDetails.value);
    }, [accountAddress, enabled, openOracleReportDetails.value?.reportId, openOracleReportDetails.value?.token1, openOracleReportDetails.value?.token2, openOracleReportDetails.value?.exactToken1Report, openOracleReportDetails.value?.isDistributed, openOracleReportDetails.value?.settlementTimestamp]);
    const openOracleDisputeSubmission = openOracleReportDetails.value === undefined ? undefined : getDisputeSubmission(openOracleReportDetails.value);
    return {
        approveToken1,
        approveToken2,
        cancelWithdrawalBalanceCheck,
        createOpenOracleGame,
        disputeReport,
        loadOracleReport,
        openOracleActiveAction: openOracleActiveAction.value,
        openOracleActiveWithdrawalBalance: openOracleActiveWithdrawalBalance.value,
        loadingOpenOracleCreate: loadingOpenOracleCreate.value,
        openOracleCreateForm: openOracleCreateForm.value,
        openOracleCreateFieldErrors: openOracleCreateFieldErrors.value,
        openOracleDisputeSubmission,
        openOracleError: openOracleError.value,
        openOracleFeedback: openOracleFeedback.value,
        openOracleForm: openOracleForm.value,
        openOracleTokenAccessState: {
            token1Approval: openOracleToken1Approval.value,
            token1Balance: openOracleToken1Balance.value,
            token1BalanceError: openOracleToken1BalanceError.value,
            token1Decimals: openOracleReportDetails.value?.token1Decimals,
            token2Approval: openOracleToken2Approval.value,
            token2Balance: openOracleToken2Balance.value,
            token2BalanceError: openOracleToken2BalanceError.value,
            token2Decimals: openOracleReportDetails.value?.token2Decimals,
            tokenAccessLoadingInitial: openOracleTokenAccessLoadingInitial.value && openOracleTokenAccessLoad.isLoading.value,
            tokenAccessRefreshing: openOracleTokenAccessRefreshing.value && openOracleTokenAccessLoad.isLoading.value,
        },
        openOracleReportLookupState: openOracleReportLookupState.value,
        openOracleReportDetails: openOracleReportDetails.value,
        openOracleResult: openOracleResult.value,
        openOracleWithdrawalBalanceChecking: openOracleWithdrawalBalanceChecking.value,
        openOracleWithdrawalReviewMessage: openOracleWithdrawalReviewMessage.value,
        openOracleWithdrawableBalances: openOracleWithdrawableBalances.value,
        openOracleWithdrawableBalancesError: openOracleWithdrawableBalancesError.value,
        openOracleWithdrawableBalancesLoading: openOracleWithdrawableBalanceLoad.isLoading.value,
        resetOpenOracleCreateForm: () => {
            openOracleCreateForm.value = getDefaultOpenOracleCreateFormState();
            openOracleCreateFieldErrors.value = {};
        },
        setOpenOracleCreateForm,
        setOpenOracleForm,
        settleReport,
        withdrawBalance,
    };
}
export function useOpenOracleOperations(parameters, dependencies) {
    if (dependencies === undefined)
        return useOpenOracleOperationsWithDependencies(parameters, defaultUseOpenOracleOperationsDependencies);
    return useOpenOracleOperationsWithDependencies(parameters, dependencies);
}
//# sourceMappingURL=useOpenOracleOperations.js.map
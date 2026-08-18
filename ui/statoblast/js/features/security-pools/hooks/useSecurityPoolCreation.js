import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { createSecurityPool, loadMarketDetails, originSecurityPoolExists } from '../../../protocol/index.js';
import { useLoadController } from '@zoltar/ui-core-shared/hooks/useLoadController.js';
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js';
import { useRequestGuard } from '@zoltar/ui-core-shared/lib/requestGuard.js';
import { getErrorMessage, isRecoverableContractReadError } from '@zoltar/ui-core-shared/lib/errors.js';
import { createErrorActionFeedback, createPendingActionFeedback, createSuccessActionFeedback, createWarningActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js';
import { createSecurityPoolCreationSuccessPresentation, createSecurityPoolCreationTransactionIntent, createSecurityPoolCreationWarningPresentation } from '../../transactionPresentations.js';
import { runWriteAction } from '@zoltar/ui-core-shared/lib/writeAction.js';
import { createSecurityPoolParameters } from '../../markets/lib/marketCreation.js';
import { hasDeployedStep } from '@zoltar/ui-core-shared/lib/deploymentStatus.js';
import { tryParseBigIntInput } from '@zoltar/ui-core-shared/lib/integerInput.js';
import { getDefaultSecurityPoolFormState, tryParseStatoblastSecurityMultiplierBpsInput } from '../../markets/lib/marketForm.js';
import { tryParseDecimalInput } from '@zoltar/ui-core-shared/lib/decimal.js';
export function resolveSecurityPoolQuestionLookupInput(marketIdInput) {
    const marketId = marketIdInput.trim();
    if (marketId === '')
        return undefined;
    return tryParseBigIntInput(marketId) === undefined ? undefined : marketId;
}
function parseQuestionIdInput(marketId) {
    const trimmedMarketId = marketId.trim();
    if (trimmedMarketId === '')
        throw new Error('Question ID is required');
    return BigInt(trimmedMarketId);
}
export function useSecurityPoolCreation({ accountAddress, deploymentStatuses, enabled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, zoltarUniverseHasForked }) {
    const marketDetailsLoad = useLoadController();
    const duplicateOriginPoolCheckLoad = useLoadController();
    const marketDetails = useSignal(undefined);
    const poolCreationMarketDetails = useSignal(undefined);
    const securityPoolCreating = useSignal(false);
    const securityPoolSubmissionInProgress = useSignal(false);
    const securityPoolError = useSignal(undefined);
    const securityPoolForm = useSignal(getDefaultSecurityPoolFormState());
    const securityPoolCreationFeedback = useSignal(undefined);
    const securityPoolResult = useSignal(undefined);
    const duplicateOriginPoolExists = useSignal(false);
    const nextMarketDetailsLoad = useRequestGuard();
    const nextDuplicateCheck = useRequestGuard();
    const isCurrentSubmittedQuestion = (questionId) => tryParseBigIntInput(securityPoolForm.value.marketId) === questionId;
    const loadDuplicateOriginPoolState = async () => {
        const isCurrent = nextDuplicateCheck();
        const marketId = securityPoolForm.value.marketId.trim();
        const statoblastSecurityMultiplierBpsInput = securityPoolForm.value.statoblastSecurityMultiplierBps.trim();
        const initialReportPriorityFeeInput = securityPoolForm.value.initialReportPriorityFeeGwei.trim();
        if (marketId === '' || statoblastSecurityMultiplierBpsInput === '' || initialReportPriorityFeeInput === '') {
            duplicateOriginPoolExists.value = false;
            return;
        }
        const questionId = tryParseBigIntInput(marketId);
        const statoblastSecurityMultiplierBps = tryParseStatoblastSecurityMultiplierBpsInput(statoblastSecurityMultiplierBpsInput);
        const initialReportPriorityFeeAttoEthPerGas = tryParseDecimalInput(initialReportPriorityFeeInput, 9);
        if (questionId === undefined || statoblastSecurityMultiplierBps === undefined || initialReportPriorityFeeAttoEthPerGas === undefined || initialReportPriorityFeeAttoEthPerGas <= 0n) {
            duplicateOriginPoolExists.value = false;
            return;
        }
        await duplicateOriginPoolCheckLoad.track(async () => {
            try {
                const exists = await originSecurityPoolExists(createConnectedReadClient(), questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas);
                if (!isCurrent())
                    return;
                duplicateOriginPoolExists.value = exists;
            }
            catch (error) {
                if (!isRecoverableContractReadError(error))
                    throw error;
                if (!isCurrent())
                    return;
                duplicateOriginPoolExists.value = false;
            }
        });
    };
    const loadMarketById = async (marketId, options) => {
        if (!hasDeployedStep(deploymentStatuses, 'zoltarQuestionData')) {
            securityPoolError.value = 'Deploy ZoltarQuestionData before selecting a question';
            return;
        }
        const isCurrent = options?.isCurrent ?? nextMarketDetailsLoad();
        await marketDetailsLoad.run({
            isCurrent,
            onStart: () => {
                securityPoolError.value = undefined;
                if (options?.clearExisting === true)
                    marketDetails.value = undefined;
            },
            load: async () => {
                const questionId = parseQuestionIdInput(marketId);
                const details = await loadMarketDetails(createConnectedReadClient(), questionId);
                return details;
            },
            onSuccess: details => {
                if (!details.exists) {
                    marketDetails.value = undefined;
                    securityPoolError.value = 'No market found for that ID';
                    return;
                }
                marketDetails.value = details;
            },
            onError: error => {
                marketDetails.value = undefined;
                securityPoolError.value = getErrorMessage(error, 'Failed to load market');
            },
        });
    };
    const createPool = async () => {
        if (securityPoolSubmissionInProgress.value) {
            securityPoolError.value = 'Security pool creation already in progress';
            return;
        }
        const submittedSecurityPoolForm = securityPoolForm.value;
        const transactionContext = {
            initialReportPriorityFeeGwei: submittedSecurityPoolForm.initialReportPriorityFeeGwei,
            questionId: submittedSecurityPoolForm.marketId,
            statoblastSecurityMultiplierBps: tryParseStatoblastSecurityMultiplierBpsInput(submittedSecurityPoolForm.statoblastSecurityMultiplierBps),
        };
        securityPoolSubmissionInProgress.value = true;
        securityPoolResult.value = undefined;
        poolCreationMarketDetails.value = undefined;
        securityPoolCreationFeedback.value = createPendingActionFeedback('createSecurityPool', 'Creating security pool');
        let capturedDetails;
        let capturedQuestionId;
        try {
            await runWriteAction({
                accountAddress,
                missingWalletMessage: 'Connect a wallet before creating a security pool',
                onRefreshError: (message, hash) => {
                    securityPoolCreationFeedback.value = createWarningActionFeedback('createSecurityPool', 'Security pool created', message, hash);
                    const result = securityPoolResult.value;
                    if (result !== undefined)
                        onTransactionPresented(createSecurityPoolCreationWarningPresentation(result, message));
                },
                onTransactionRequested: () => {
                    securityPoolCreating.value = true;
                    onTransactionRequested(createSecurityPoolCreationTransactionIntent(transactionContext));
                },
                onTransactionFinished: () => {
                    securityPoolCreating.value = false;
                    onTransactionFinished();
                },
                onTransactionFailed,
                onWriteError: message => {
                    securityPoolCreationFeedback.value = createErrorActionFeedback('createSecurityPool', 'Security pool creation failed', message);
                },
                refreshState,
                setErrorMessage: message => {
                    securityPoolError.value = message;
                },
            }, async (walletAddress) => {
                if (!hasDeployedStep(deploymentStatuses, 'securityPoolFactory'))
                    throw new Error('Deploy SecurityPoolFactory before creating a security pool');
                if (zoltarUniverseHasForked)
                    throw new Error('Security pools cannot be created after the universe has forked');
                const parameters = createSecurityPoolParameters(submittedSecurityPoolForm);
                capturedQuestionId = parameters.questionId;
                const details = marketDetails.value?.questionId === parameters.questionId.toString() ? marketDetails.value : await loadMarketDetails(createConnectedReadClient(), parameters.questionId);
                if (!details.exists)
                    throw new Error('No market found for that ID');
                if (details.marketType !== 'binary') {
                    if (isCurrentSubmittedQuestion(parameters.questionId)) {
                        marketDetails.value = details;
                    }
                    throw new Error('Security pools can only be deployed for binary markets');
                }
                if (await originSecurityPoolExists(createConnectedReadClient(), parameters.questionId, parameters.statoblastSecurityMultiplierBps, parameters.initialReportPriorityFeeAttoEthPerGas)) {
                    if (isCurrentSubmittedQuestion(parameters.questionId)) {
                        marketDetails.value = details;
                    }
                    throw new Error('A security pool for this question, Statoblast security multiplier, and priority fee already exists.');
                }
                capturedDetails = details;
                const result = await createSecurityPool(createWalletWriteClient(walletAddress, { onTransactionPrepared, onTransactionSubmitted }), parameters);
                return { ...result, hash: result.deployPoolHash };
            }, 'Failed to create security pool', result => {
                if (capturedDetails !== undefined) {
                    poolCreationMarketDetails.value = capturedDetails;
                    if (capturedQuestionId !== undefined && isCurrentSubmittedQuestion(capturedQuestionId)) {
                        marketDetails.value = capturedDetails;
                    }
                }
                securityPoolResult.value = result;
                securityPoolCreationFeedback.value = createSuccessActionFeedback('createSecurityPool', 'Security pool created', result.hash);
                onTransactionPresented(createSecurityPoolCreationSuccessPresentation(result));
            });
        }
        finally {
            securityPoolSubmissionInProgress.value = false;
        }
    };
    const resetSecurityPoolCreation = () => {
        securityPoolError.value = undefined;
        securityPoolResult.value = undefined;
    };
    useEffect(() => {
        if (!enabled)
            return;
        void loadDuplicateOriginPoolState();
    }, [enabled, securityPoolForm.value.initialReportPriorityFeeGwei, securityPoolForm.value.marketId, securityPoolForm.value.statoblastSecurityMultiplierBps]);
    useEffect(() => {
        if (!enabled)
            return;
        const marketId = resolveSecurityPoolQuestionLookupInput(securityPoolForm.value.marketId);
        const isCurrent = nextMarketDetailsLoad();
        if (marketId === undefined) {
            marketDetails.value = undefined;
            securityPoolError.value = undefined;
            return;
        }
        void loadMarketById(marketId, { clearExisting: true, isCurrent });
    }, [deploymentStatuses, enabled, securityPoolForm.value.marketId]);
    return {
        checkingDuplicateOriginPool: duplicateOriginPoolCheckLoad.isLoading.value,
        duplicateOriginPoolExists: duplicateOriginPoolExists.value,
        loadMarketById,
        loadingMarketDetails: marketDetailsLoad.isLoading.value,
        marketDetails: marketDetails.value,
        securityPoolCreationFeedback: securityPoolCreationFeedback.value,
        securityPoolCreating: securityPoolCreating.value,
        securityPoolError: securityPoolError.value,
        securityPoolForm: securityPoolForm.value,
        securityPoolResult: securityPoolResult.value,
        poolCreationMarketDetails: poolCreationMarketDetails.value,
        resetSecurityPoolCreation,
        setSecurityPoolForm: (updater) => {
            securityPoolForm.value = updater(securityPoolForm.value);
        },
        createPool,
    };
}
//# sourceMappingURL=useSecurityPoolCreation.js.map
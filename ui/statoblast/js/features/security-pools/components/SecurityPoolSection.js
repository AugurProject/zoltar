import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as securityPoolCopy from '@zoltar/ui-zoltar/copy/securityPool.js';
import { useEffect, useRef, useState } from 'preact/hooks';
import { AddressValue } from '@zoltar/ui-core-shared/components/AddressValue.js';
import { EntityCard } from '@zoltar/ui-core-shared/components/EntityCard.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js';
import { LookupFieldRow } from '@zoltar/ui-core-shared/components/LookupFieldRow.js';
import { LoadingText } from '@zoltar/ui-core-shared/components/LoadingText.js';
import { Question, getQuestionTitle } from '@zoltar/ui-core-shared/components/Question.js';
import { RouteWorkflowPanel } from '@zoltar/ui-core-shared/components/RouteWorkflowPanel.js';
import { SectionBlock } from '@zoltar/ui-core-shared/components/SectionBlock.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { TransactionHashLink } from '@zoltar/ui-core-shared/components/TransactionHashLink.js';
import { UniverseLink } from '@zoltar/ui-zoltar/features/universes/components/UniverseLink.js';
import { isActiveAppChain } from '@zoltar/ui-core-shared/lib/network.js';
import { formatOpenInterestFeePerYearPercent, ORIGIN_POOL_INITIAL_RETENTION_RATE } from '../lib/retentionRate.js';
import { formatCurrencyBalance } from '@zoltar/ui-core-shared/lib/formatters.js';
import { getInitialReportPriorityFeeValidationMessage, getSecurityPoolCreateDisabledReason, getStatoblastSecurityMultiplierValidationMessage } from '../lib/securityPoolCreationGuards.js';
import { formatStatoblastSecurityMultiplier } from '../../markets/lib/trading.js';
export function SecurityPoolSection({ accountState, availableQuestionsContextKey, availableQuestions, checkingDuplicateOriginPool, duplicateOriginPoolExists, hasLoadedAvailableQuestions, loadingMarketDetails, loadingAvailableQuestions, marketDetails, onCreateSecurityPool, onLoadAvailableQuestions, onOpenCreatedPool, onReturnToBrowse, onSecurityPoolFormChange, onResetSecurityPoolCreation, securityPoolCreating, securityPoolError, securityPoolForm, securityPoolResult, showHeader = true, poolCreationMarketDetails: carriedPoolCreationMarketDetails, zoltarUniverseHasForked, }) {
    const isOnActiveAppChain = isActiveAppChain(accountState.chainId);
    const eligibleQuestions = availableQuestions.filter(question => question.marketType === 'binary');
    const [availableQuestionsLoadError, setAvailableQuestionsLoadError] = useState(undefined);
    const requestedAvailableQuestionsContextRef = useRef(undefined);
    let availableQuestionsHelp = undefined;
    if (loadingAvailableQuestions) {
        availableQuestionsHelp = _jsx(LoadingText, { children: securityPoolCopy.loadingAvailableQuestions });
    }
    else if (availableQuestionsLoadError === undefined && eligibleQuestions.length === 0) {
        availableQuestionsHelp = securityPoolCopy.noAvailableQuestions;
    }
    useEffect(() => {
        if (requestedAvailableQuestionsContextRef.current !== availableQuestionsContextKey) {
            requestedAvailableQuestionsContextRef.current = undefined;
            setAvailableQuestionsLoadError(undefined);
        }
        if (hasLoadedAvailableQuestions) {
            requestedAvailableQuestionsContextRef.current = undefined;
            setAvailableQuestionsLoadError(undefined);
            return;
        }
        if (loadingAvailableQuestions || requestedAvailableQuestionsContextRef.current === availableQuestionsContextKey)
            return;
        requestedAvailableQuestionsContextRef.current = availableQuestionsContextKey;
        void onLoadAvailableQuestions().catch(() => setAvailableQuestionsLoadError(securityPoolCopy.availableQuestionsLoadError));
    }, [availableQuestionsContextKey, hasLoadedAvailableQuestions, loadingAvailableQuestions, onLoadAvailableQuestions]);
    const retryAvailableQuestions = () => {
        setAvailableQuestionsLoadError(undefined);
        requestedAvailableQuestionsContextRef.current = availableQuestionsContextKey;
        void onLoadAvailableQuestions().catch(() => setAvailableQuestionsLoadError(securityPoolCopy.availableQuestionsLoadError));
    };
    const hasSecurityPoolResult = securityPoolResult !== undefined;
    const statoblastSecurityMultiplierValidationMessage = getStatoblastSecurityMultiplierValidationMessage(securityPoolForm.statoblastSecurityMultiplierBps);
    const initialReportPriorityFeeValidationMessage = getInitialReportPriorityFeeValidationMessage(securityPoolForm.initialReportPriorityFeeGwei);
    const guardedCreateDisabledReason = getSecurityPoolCreateDisabledReason({
        accountAddress: accountState.address,
        checkingDuplicateOriginPool,
        duplicateOriginPoolExists,
        initialReportPriorityFeeGwei: securityPoolForm.initialReportPriorityFeeGwei,
        isOnActiveAppChain,
        marketDetails,
        securityPoolCreating,
        statoblastSecurityMultiplier: securityPoolForm.statoblastSecurityMultiplierBps,
        zoltarUniverseHasForked,
    });
    const createDisabledReason = loadingAvailableQuestions && securityPoolForm.marketId.trim() === '' ? securityPoolCopy.loadingAvailableQuestionsReason : guardedCreateDisabledReason;
    const isCreateDisabled = !isOnActiveAppChain || createDisabledReason !== undefined;
    let visibleFieldErrorId = undefined;
    if (createDisabledReason === statoblastSecurityMultiplierValidationMessage) {
        visibleFieldErrorId = 'security-pool-security-multiplier-error';
    }
    else if (createDisabledReason === initialReportPriorityFeeValidationMessage) {
        visibleFieldErrorId = 'security-pool-initial-report-priority-fee-error';
    }
    let createdQuestionDetails = undefined;
    if (securityPoolResult !== undefined)
        if (marketDetails?.questionId === securityPoolResult.questionId) {
            createdQuestionDetails = marketDetails;
        }
        else {
            createdQuestionDetails = carriedPoolCreationMarketDetails;
        }
    let createButtonLabel = commonCopy.createPoolAction;
    if (securityPoolCreating) {
        createButtonLabel = _jsx(LoadingText, { children: securityPoolCopy.creatingPool });
    }
    else if (checkingDuplicateOriginPool) {
        createButtonLabel = _jsx(LoadingText, { children: securityPoolCopy.checkingDuplicate });
    }
    else if (duplicateOriginPoolExists) {
        createButtonLabel = securityPoolCopy.poolAlreadyExists;
    }
    else if (zoltarUniverseHasForked)
        createButtonLabel = securityPoolCopy.poolCreationLocked;
    const createdPoolResult = securityPoolResult === undefined ? undefined : (_jsxs(EntityCard, { surface: 'flat', title: securityPoolCopy.poolCreated, variant: 'record', actions: _jsxs("div", { className: 'actions', children: [_jsx("button", { "aria-label": securityPoolCopy.formatOpenPoolLabel(createdQuestionDetails === undefined ? securityPoolResult.securityPoolAddress : getQuestionTitle(createdQuestionDetails), securityPoolResult.securityPoolAddress), className: 'primary', onClick: () => onOpenCreatedPool?.(securityPoolResult.securityPoolAddress, securityPoolResult.universeId), children: securityPoolCopy.openPool }), onReturnToBrowse === undefined ? undefined : (_jsx("button", { className: 'secondary', onClick: onReturnToBrowse, children: commonCopy.returnToBrowse })), _jsx("button", { className: 'secondary', onClick: onResetSecurityPoolCreation, children: securityPoolCopy.createAnotherPool })] }), children: [_jsx(Question, { question: createdQuestionDetails, loading: createdQuestionDetails === undefined }), _jsxs("ul", { className: 'status-list hashes', children: [_jsxs("li", { children: [_jsx("span", { children: securityPoolCopy.poolAddressLabel }), _jsx("strong", { children: _jsx(AddressValue, { address: securityPoolResult.securityPoolAddress }) })] }), _jsxs("li", { children: [_jsx("span", { children: commonCopy.statoblastSecurityMultiplierBps }), _jsxs("strong", { children: [formatStatoblastSecurityMultiplier(securityPoolResult.statoblastSecurityMultiplierBps), "x"] })] }), _jsxs("li", { children: [_jsx("span", { children: commonCopy.initialReportPriorityFee }), _jsxs("strong", { children: [formatCurrencyBalance(securityPoolResult.initialReportPriorityFeeAttoEthPerGas, 9), " ", commonCopy.gwei] })] }), _jsxs("li", { children: [_jsx("span", { children: commonCopy.universe }), _jsx("strong", { children: _jsx(UniverseLink, { universeId: securityPoolResult.universeId }) })] }), _jsxs("li", { children: [_jsx("span", { children: securityPoolCopy.deploymentTransactionHash }), _jsx("strong", { children: _jsx(TransactionHashLink, { hash: securityPoolResult.deployPoolHash }) })] })] })] }));
    return (_jsx(RouteWorkflowPanel, { showHeader: showHeader, title: commonCopy.createPool, children: hasSecurityPoolResult ? (_jsxs(_Fragment, { children: [createdPoolResult, _jsx(ErrorNotice, { message: securityPoolError })] })) : (_jsxs(_Fragment, { children: [_jsxs(SectionBlock, { description: securityPoolCopy.marketHierarchyDetail, title: showHeader ? undefined : commonCopy.createPool, variant: 'plain', children: [_jsxs("div", { className: 'form-grid', children: [_jsxs("div", { className: 'field', children: [_jsx("label", { htmlFor: 'security-pool-question-picker', children: _jsx("span", { children: securityPoolCopy.chooseAvailableQuestion }) }), _jsxs("select", { id: 'security-pool-question-picker', disabled: loadingAvailableQuestions, value: eligibleQuestions.some(question => question.questionId === securityPoolForm.marketId) ? securityPoolForm.marketId : '', onChange: event => onSecurityPoolFormChange({ marketId: event.currentTarget.value }), children: [_jsx("option", { value: '', children: securityPoolCopy.chooseQuestionPlaceholder }), eligibleQuestions.map(question => (_jsx("option", { value: question.questionId, children: getQuestionTitle(question) }, question.questionId)))] }), availableQuestionsHelp === undefined ? undefined : _jsx("p", { className: 'field-help', children: availableQuestionsHelp }), _jsx(ErrorNotice, { message: availableQuestionsLoadError }), availableQuestionsLoadError === undefined ? undefined : (_jsx("div", { className: 'actions', children: _jsx("button", { className: 'secondary', type: 'button', onClick: retryAvailableQuestions, children: securityPoolCopy.retryAvailableQuestions }) }))] }), _jsxs("div", { className: 'field', children: [_jsx(LookupFieldRow, { label: commonCopy.questionId, value: securityPoolForm.marketId, onInput: marketId => onSecurityPoolFormChange({ marketId }), placeholder: commonCopy.hexValuePlaceholder }), _jsx("p", { className: 'field-help', children: securityPoolCopy.questionIdFallbackHint })] }), loadingMarketDetails ? (_jsx("p", { className: 'detail', children: _jsx(LoadingText, { children: securityPoolCopy.loadingQuestion }) })) : undefined, marketDetails === undefined ? undefined : (_jsx("div", { className: 'loaded-question-preview', children: _jsx(Question, { question: marketDetails, variant: 'preview' }) })), _jsxs("div", { className: 'field', children: [_jsx("label", { htmlFor: 'security-pool-security-multiplier', children: _jsx("span", { children: commonCopy.statoblastSecurityMultiplierBps }) }), _jsx(FormInput, { id: 'security-pool-security-multiplier', "aria-describedby": `security-pool-security-multiplier-help${statoblastSecurityMultiplierValidationMessage === undefined ? '' : ' security-pool-security-multiplier-error'}`, invalid: statoblastSecurityMultiplierValidationMessage !== undefined, value: securityPoolForm.statoblastSecurityMultiplierBps, onInput: event => onSecurityPoolFormChange({ statoblastSecurityMultiplierBps: event.currentTarget.value }) }), _jsx("p", { className: 'field-help', id: 'security-pool-security-multiplier-help', children: securityPoolCopy.statoblastSecurityMultiplierBpsHelpText }), statoblastSecurityMultiplierValidationMessage === undefined ? undefined : (_jsx("p", { className: 'field-error', id: 'security-pool-security-multiplier-error', children: statoblastSecurityMultiplierValidationMessage }))] }), _jsxs("div", { className: 'field', children: [_jsx("label", { htmlFor: 'security-pool-initial-report-priority-fee', children: _jsx("span", { children: commonCopy.initialReportPriorityFee }) }), _jsx(FormInput, { id: 'security-pool-initial-report-priority-fee', "aria-describedby": `security-pool-initial-report-priority-fee-help${initialReportPriorityFeeValidationMessage === undefined ? '' : ' security-pool-initial-report-priority-fee-error'}`, invalid: initialReportPriorityFeeValidationMessage !== undefined, value: securityPoolForm.initialReportPriorityFeeGwei, onInput: event => onSecurityPoolFormChange({
                                                initialReportPriorityFeeGwei: event.currentTarget.value,
                                            }) }), _jsx("p", { className: 'field-help', id: 'security-pool-initial-report-priority-fee-help', children: securityPoolCopy.initialReportPriorityFeeHelpText }), initialReportPriorityFeeValidationMessage === undefined ? undefined : (_jsx("p", { className: 'field-error', id: 'security-pool-initial-report-priority-fee-error', children: initialReportPriorityFeeValidationMessage }))] }), _jsxs("div", { className: 'field', children: [_jsx("span", { children: securityPoolCopy.initialOpenInterestFeeYear }), _jsx("strong", { children: formatOpenInterestFeePerYearPercent(ORIGIN_POOL_INITIAL_RETENTION_RATE) })] }), _jsx("div", { className: 'actions', children: _jsx(TransactionActionButton, { idleLabel: createButtonLabel, pendingLabel: securityPoolCopy.creatingPool, onClick: onCreateSecurityPool, pending: securityPoolCreating, availability: { disabled: isCreateDisabled, reason: createDisabledReason }, disabledReasonElementId: visibleFieldErrorId, showDisabledReason: visibleFieldErrorId === undefined }) })] }), !duplicateOriginPoolExists ? undefined : _jsx("p", { className: 'detail', children: securityPoolCopy.duplicatePoolDetail }), marketDetails !== undefined && marketDetails.marketType !== 'binary' ? _jsx("p", { className: 'notice error', children: securityPoolCopy.ineligibleQuestionDetail }) : undefined, zoltarUniverseHasForked ? _jsx("p", { className: 'notice error', children: securityPoolCopy.poolCreationAfterForkReason }) : undefined] }), _jsx(ErrorNotice, { message: securityPoolError })] })) }));
}
//# sourceMappingURL=SecurityPoolSection.js.map
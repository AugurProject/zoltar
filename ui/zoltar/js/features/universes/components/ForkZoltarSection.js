import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '@zoltar/ui-core-shared/copy/common.js';
import * as zoltarCopy from '../../../copy/zoltar.js';
import { useState } from 'preact/hooks';
import { CurrencyValue } from '@zoltar/ui-core-shared/components/CurrencyValue.js';
import { DataGrid } from '@zoltar/ui-core-shared/components/DataGrid.js';
import { ErrorNotice } from '@zoltar/ui-core-shared/components/ErrorNotice.js';
import { FormInput } from '@zoltar/ui-core-shared/components/FormInput.js';
import { MetricField } from '@zoltar/ui-core-shared/components/MetricField.js';
import { Question } from '@zoltar/ui-core-shared/components/Question.js';
import { StateHint } from '@zoltar/ui-core-shared/components/StateHint.js';
import { TokenApprovalControl } from '@zoltar/ui-core-shared/components/TokenApprovalControl.js';
import { TransactionActionButton } from '@zoltar/ui-core-shared/components/TransactionActionButton.js';
import { TransactionReview } from '@zoltar/ui-core-shared/components/TransactionReview.js';
import { WorkflowSubsection } from '@zoltar/ui-core-shared/components/WorkflowSubsection.js';
import { normalizeQuestionId } from '@zoltar/ui-core-shared/lib/questionId.js';
import { useChainTimestamp } from '@zoltar/ui-core-shared/lib/chainTimestamp.js';
import { formatRelativeTimestamp, formatTimestamp } from '@zoltar/ui-core-shared/lib/formatters.js';
import { resolveLoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js';
import { deriveTokenApprovalRequirement } from '@zoltar/ui-core-shared/lib/tokenApproval.js';
import { getReportPresentation, getUniversePresentation, getWalletPresentation } from '@zoltar/ui-core-shared/lib/userCopy.js';
const FORK_CONFIRMATION = 'FORK';
const FORK_QUESTION_ERROR_ID = 'fork-zoltar-question-error';
const FORK_QUESTION_STATE_ID = 'fork-zoltar-question-state';
export function ForkZoltarSection({ accountAddress, currentTimestamp, hasLoadedZoltarQuestions, isOnActiveAppChain, loadingZoltarForkAccess, loadingZoltarQuestion = false, loadingZoltarQuestions, onApproveZoltarForkRep, onForkZoltar, onRetryZoltarQuestion, onZoltarForkQuestionIdChange, zoltarForkActiveAction, zoltarForkApproval, zoltarForkError, zoltarForkPending, zoltarForkQuestionId, zoltarForkRepBalanceAttoRep, zoltarQuestionLookupError, zoltarQuestionLookupId, zoltarQuestions, zoltarUniverse, zoltarUniverseState, }) {
    const [forkConfirmation, setForkConfirmation] = useState({ questionId: '', value: '' });
    const chainCurrentTimestamp = useChainTimestamp();
    const effectiveCurrentTimestamp = currentTimestamp ?? chainCurrentTimestamp;
    const rootUniverse = zoltarUniverse;
    const universeMissing = zoltarUniverseState === 'missing';
    const hasForked = rootUniverse?.hasForked === true;
    const hasEnoughRep = rootUniverse !== undefined && zoltarForkRepBalanceAttoRep !== undefined && zoltarForkRepBalanceAttoRep >= rootUniverse.forkThresholdAttoRep;
    const approvalRequirement = deriveTokenApprovalRequirement(rootUniverse?.forkThresholdAttoRep, zoltarForkApproval.value);
    const hasEnoughApproval = rootUniverse !== undefined && approvalRequirement.hasSufficientApproval;
    const hasForkEconomics = rootUniverse?.forkBurnDivisor !== undefined && rootUniverse.forkBurnDivisor > 1n && rootUniverse.zoltarAddress !== undefined;
    const selectedQuestionId = zoltarForkQuestionId.trim();
    const hasSelectedQuestionId = selectedQuestionId !== '';
    const normalizedSelectedQuestionId = normalizeQuestionId(selectedQuestionId);
    const hasValidSelectedQuestionId = normalizedSelectedQuestionId !== undefined;
    const confirmationValue = forkConfirmation.questionId === selectedQuestionId ? forkConfirmation.value : '';
    const hasConfirmedFork = confirmationValue.trim() === FORK_CONFIRMATION;
    const canonicalForkQuestion = rootUniverse?.forkQuestionDetails;
    const selectedQuestion = normalizedSelectedQuestionId === undefined
        ? undefined
        : (zoltarQuestions.find(question => normalizeQuestionId(question.questionId) === normalizedSelectedQuestionId) ?? (canonicalForkQuestion !== undefined && normalizeQuestionId(canonicalForkQuestion.questionId) === normalizedSelectedQuestionId ? canonicalForkQuestion : undefined));
    const selectedQuestionHasEnded = selectedQuestion === undefined || effectiveCurrentTimestamp === undefined ? undefined : effectiveCurrentTimestamp >= selectedQuestion.endTime;
    const isSelectedQuestionLookup = normalizedSelectedQuestionId !== undefined && zoltarQuestionLookupId === normalizedSelectedQuestionId;
    let selectedQuestionError;
    if (hasSelectedQuestionId && !hasValidSelectedQuestionId)
        selectedQuestionError = zoltarCopy.forkQuestionIdInvalid;
    else if (isSelectedQuestionLookup)
        selectedQuestionError = zoltarQuestionLookupError;
    const selectedQuestionLookupState = resolveLoadableValueState({
        isLoading: hasValidSelectedQuestionId && (loadingZoltarQuestions || loadingZoltarQuestion || (hasSelectedQuestionId && selectedQuestion === undefined && !hasLoadedZoltarQuestions && !isSelectedQuestionLookup)),
        isMissing: hasSelectedQuestionId && (hasLoadedZoltarQuestions || isSelectedQuestionLookup) && selectedQuestion === undefined && selectedQuestionError === undefined,
        value: selectedQuestion,
    });
    const selectedQuestionPresentation = hasSelectedQuestionId && selectedQuestionLookupState !== 'ready' ? getReportPresentation({ kind: 'question', state: selectedQuestionLookupState }) : undefined;
    let selectedQuestionDescriptionId;
    if (selectedQuestionError !== undefined)
        selectedQuestionDescriptionId = FORK_QUESTION_ERROR_ID;
    else if (selectedQuestionLookupState === 'missing')
        selectedQuestionDescriptionId = FORK_QUESTION_STATE_ID;
    const canFork = accountAddress !== undefined && isOnActiveAppChain && rootUniverse !== undefined && !hasForked && !zoltarForkPending && selectedQuestion !== undefined && selectedQuestionHasEnded === true && hasEnoughRep && hasEnoughApproval && hasForkEconomics && hasConfirmedFork;
    const permanentRepBurn = rootUniverse?.forkBurnDivisor === undefined || rootUniverse.forkBurnDivisor <= 1n ? undefined : rootUniverse.forkThresholdAttoRep / rootUniverse.forkBurnDivisor;
    const approvalGuardMessage = (() => {
        const walletPresentation = getWalletPresentation({ accountAddress, isOnActiveAppChain });
        if (walletPresentation !== undefined)
            return walletPresentation.detail;
        if (rootUniverse === undefined)
            return undefined;
        if (hasForked)
            return zoltarCopy.alreadyForkedReason;
        if (selectedQuestion === undefined)
            return zoltarCopy.forkQuestionRequiredReason;
        return undefined;
    })();
    const forkGuardMessage = (() => {
        const walletPresentation = getWalletPresentation({ accountAddress, isOnActiveAppChain });
        if (walletPresentation !== undefined)
            return walletPresentation.detail;
        if (rootUniverse === undefined)
            return getUniversePresentation(zoltarUniverseState)?.detail;
        if (hasForked)
            return zoltarCopy.alreadyForkedReason;
        if (selectedQuestion === undefined)
            return zoltarCopy.forkQuestionRequiredReason;
        if (effectiveCurrentTimestamp === undefined)
            return zoltarCopy.forkQuestionTimeLoadingReason;
        if (!selectedQuestionHasEnded)
            return zoltarCopy.formatForkQuestionActiveReason(formatTimestamp(selectedQuestion.endTime), formatRelativeTimestamp(selectedQuestion.endTime, effectiveCurrentTimestamp));
        if (!hasForkEconomics)
            return zoltarCopy.forkEconomicsUnavailableReason;
        if (!hasEnoughRep)
            return zoltarCopy.forkRepInsufficientReason;
        if (!hasEnoughApproval)
            return zoltarCopy.forkRepApprovalRequiredReason;
        if (!hasConfirmedFork)
            return zoltarCopy.forkConfirmationRequiredReason;
        return undefined;
    })();
    if (universeMissing) {
        const presentation = getUniversePresentation(zoltarUniverseState);
        return (_jsxs(_Fragment, { children: [presentation === undefined ? undefined : _jsx(StateHint, { presentation: presentation, title: zoltarCopy.forkZoltar }), _jsx(ErrorNotice, { message: zoltarForkError })] }));
    }
    return (_jsxs(_Fragment, { children: [hasForked ? undefined : (_jsx(DataGrid, { children: _jsx(MetricField, { label: commonCopy.forkThresholdAttoRep, children: _jsx(CurrencyValue, { loading: loadingZoltarForkAccess || rootUniverse === undefined, value: rootUniverse?.forkThresholdAttoRep, suffix: commonCopy.rep }) }) })), _jsxs("div", { className: 'form-grid', children: [hasForked ? undefined : (_jsx(TokenApprovalControl, { actionLabel: zoltarCopy.forkingActionLabel, allowanceError: zoltarForkApproval.error, allowanceLoading: zoltarForkApproval.loading, approvedAmount: zoltarForkApproval.value, disabled: !isOnActiveAppChain, guardMessage: approvalGuardMessage, onApprove: amount => onApproveZoltarForkRep(amount), pending: zoltarForkActiveAction === 'approve', pendingLabel: zoltarCopy.forkRepApprovalPending, requiredAmount: rootUniverse?.forkThresholdAttoRep, resetKey: `${rootUniverse?.reputationToken ?? ''}:${rootUniverse?.universeId.toString() ?? ''}:${rootUniverse?.forkThresholdAttoRep.toString() ?? ''}`, tokenSymbol: 'REP', tokenUnits: 18 })), _jsxs("label", { className: 'field', children: [_jsx("span", { children: zoltarCopy.forkQuestionId }), _jsx(FormInput, { "aria-describedby": selectedQuestionDescriptionId, disabled: hasForked || zoltarForkPending, invalid: selectedQuestionDescriptionId !== undefined, onInput: event => onZoltarForkQuestionIdChange(event.currentTarget.value), placeholder: commonCopy.hexValuePlaceholder, value: zoltarForkQuestionId })] }), selectedQuestion === undefined ? undefined : (_jsx(WorkflowSubsection, { title: commonCopy.question, children: _jsx(Question, { question: selectedQuestion }) })), selectedQuestionPresentation === undefined ? undefined : _jsx(StateHint, { id: selectedQuestionLookupState === 'missing' ? FORK_QUESTION_STATE_ID : undefined, presentation: selectedQuestionPresentation }), _jsx(ErrorNotice, { id: FORK_QUESTION_ERROR_ID, message: selectedQuestionError }), zoltarQuestionLookupError === undefined || !isSelectedQuestionLookup || onRetryZoltarQuestion === undefined ? undefined : (_jsx("div", { className: 'actions', children: _jsx("button", { type: 'button', className: 'secondary', disabled: loadingZoltarQuestion, onClick: onRetryZoltarQuestion, children: loadingZoltarQuestion ? commonCopy.retrying : commonCopy.retry }) })), hasForked ? undefined : (_jsxs(_Fragment, { children: [_jsx(TransactionReview, { primary: [
                                    { label: commonCopy.forkThresholdAttoRep, value: _jsx(CurrencyValue, { value: rootUniverse?.forkThresholdAttoRep, suffix: commonCopy.rep }) },
                                    { label: zoltarCopy.permanentRepBurn, value: _jsx(CurrencyValue, { value: permanentRepBurn, suffix: commonCopy.rep }) },
                                ], risks: [zoltarCopy.forkIrreversibleRisk, zoltarCopy.forkMigrationRisk] }), _jsxs("label", { className: 'field', children: [_jsx("span", { children: zoltarCopy.forkConfirmationLabel }), _jsx(FormInput, { "aria-label": zoltarCopy.forkConfirmationLabel, autoComplete: 'off', disabled: zoltarForkPending || selectedQuestion === undefined, onInput: event => setForkConfirmation({ questionId: selectedQuestionId, value: event.currentTarget.value }), value: confirmationValue }), _jsx("p", { className: 'field-help', children: zoltarCopy.forkConfirmationHelp })] }), _jsx("div", { className: 'actions', children: _jsx(TransactionActionButton, { idleLabel: zoltarCopy.forkZoltar, pendingLabel: zoltarCopy.forkSubmissionPending, onClick: () => {
                                        if (selectedQuestionId === '')
                                            return;
                                        onForkZoltar();
                                    }, pending: zoltarForkActiveAction === 'fork', availability: { disabled: !canFork, reason: forkGuardMessage } }) })] }))] }), _jsx(ErrorNotice, { message: zoltarForkError })] }));
}
//# sourceMappingURL=ForkZoltarSection.js.map
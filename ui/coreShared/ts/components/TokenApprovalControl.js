import { jsx as _jsx, jsxs as _jsxs } from "preact/jsx-runtime";
import * as commonCopy from '../copy/common.js';
import { useEffect, useId, useMemo, useState } from 'preact/hooks';
import { ApprovedAmountValue } from './ApprovedAmountValue.js';
import { CurrencyValue } from './CurrencyValue.js';
import { ErrorNotice } from './ErrorNotice.js';
import { FormInput } from './FormInput.js';
import { LoadingText } from './LoadingText.js';
import { MetricGrid } from './MetricGrid.js';
import { MetricField } from './MetricField.js';
import { TransactionActionButton } from './TransactionActionButton.js';
import { formatCurrencyBalance } from '../lib/formatters.js';
import { deriveTokenApprovalRequirement, formatTokenApprovalUnavailableMessage, parseTokenApprovalAmountInput, resolveTokenApprovalStatusMessage } from '../lib/tokenApproval.js';
function resolveApprovalButtonLabel({ guardMessage, isCustomAmount, isMaxAmount, nextApprovalAmount, pending, pendingLabel, requirementSatisfied, tokenSymbol, tokenUnits, }) {
    if (pending)
        return _jsx(LoadingText, { children: pendingLabel });
    if (guardMessage !== undefined || nextApprovalAmount === undefined)
        return commonCopy.formatApproveValue(tokenSymbol);
    if (requirementSatisfied && !isCustomAmount && !isMaxAmount)
        return commonCopy.approvalSatisfied;
    if (isMaxAmount)
        return commonCopy.formatApproveMaxValue(tokenSymbol);
    return commonCopy.formatApproveTokenAmount(formatCurrencyBalance(nextApprovalAmount, tokenUnits), tokenSymbol);
}
export function TokenApprovalControl({ actionLabel, allowanceError, allowanceLoading, approvedAmount, disabled = false, guardMessage, onApprove, pending, pendingLabel, requiredAmount, resetKey, tokenSymbol, tokenUnits }) {
    const [draftAmount, setDraftAmount] = useState('');
    const amountValidationMessageId = useId();
    const requirement = useMemo(() => deriveTokenApprovalRequirement(requiredAmount, approvedAmount), [approvedAmount, requiredAmount]);
    useEffect(() => {
        setDraftAmount('');
    }, [resetKey]);
    const parsedAmount = useMemo(() => {
        try {
            return parseTokenApprovalAmountInput(draftAmount, commonCopy.approvalAmount, tokenUnits);
        }
        catch (error) {
            return {
                error: error instanceof Error ? error.message : commonCopy.approvalAmountInvalidError,
                kind: 'invalid',
            };
        }
    }, [draftAmount, tokenUnits]);
    const nextApprovalAmount = (() => {
        if (parsedAmount.kind === 'default')
            return requirement.targetAmount;
        if (parsedAmount.kind === 'invalid')
            return undefined;
        return parsedAmount.amount;
    })();
    const hasNonIncreasingCustomApproval = parsedAmount.kind === 'custom' && approvedAmount !== undefined && parsedAmount.amount <= approvedAmount;
    const amountValidationMessage = parsedAmount.kind === 'invalid' ? parsedAmount.error : undefined;
    const statusMessage = resolveTokenApprovalStatusMessage({
        actionLabel,
        amountValidationMessage,
        draftAmount,
        guardMessage,
        nextApprovalAmount,
        requiredAmount,
        requirement,
        tokenLabel: tokenSymbol,
        tokenUnits,
    });
    const visibleStatusMessage = disabled || hasNonIncreasingCustomApproval ? undefined : statusMessage;
    const allowanceMessage = allowanceError === undefined ? undefined : formatTokenApprovalUnavailableMessage({ actionLabel, reason: allowanceError, tokenLabel: tokenSymbol });
    const controlsDisabled = pending || disabled;
    const canApprove = !pending &&
        !disabled &&
        guardMessage === undefined &&
        allowanceMessage === undefined &&
        !allowanceLoading &&
        requiredAmount !== undefined &&
        amountValidationMessage === undefined &&
        !hasNonIncreasingCustomApproval &&
        nextApprovalAmount !== undefined &&
        (parsedAmount.kind !== 'default' || !requirement.hasSufficientApproval);
    const buttonLabel = resolveApprovalButtonLabel({
        guardMessage,
        isCustomAmount: parsedAmount.kind === 'custom',
        isMaxAmount: parsedAmount.kind === 'max',
        nextApprovalAmount,
        pending,
        pendingLabel,
        requirementSatisfied: requirement.hasSufficientApproval,
        tokenSymbol,
        tokenUnits,
    });
    return (_jsxs("div", { className: 'form-grid', children: [_jsxs(MetricGrid, { children: [_jsx(MetricField, { label: commonCopy.formatRequiredValue(tokenSymbol), children: _jsx(CurrencyValue, { value: requiredAmount, units: tokenUnits, suffix: tokenSymbol, copyable: false }) }), _jsx(MetricField, { label: commonCopy.formatApprovedValue(tokenSymbol), children: _jsx(ApprovedAmountValue, { loading: allowanceLoading, value: approvedAmount, requiredAmount: requiredAmount, units: tokenUnits, suffix: tokenSymbol, copyable: false }) })] }), _jsxs("label", { className: 'field approval-amount-field', children: [_jsx("span", { className: 'approval-amount-label', children: commonCopy.formatValueApprovalAmount(tokenSymbol) }), _jsxs("div", { className: 'field-inline approval-amount-controls', children: [_jsx(FormInput, { "aria-describedby": amountValidationMessage === undefined ? undefined : amountValidationMessageId, className: 'field-inline-input', value: draftAmount, onInput: event => setDraftAmount(event.currentTarget.value), placeholder: commonCopy.leaveBlankForRequiredTotal, invalid: amountValidationMessage !== undefined, disabled: controlsDisabled }), _jsx("button", { className: 'quiet field-inline-action', type: 'button', onClick: () => setDraftAmount('max'), disabled: controlsDisabled, children: commonCopy.max })] })] }), amountValidationMessage === undefined ? undefined : (_jsx("p", { className: 'field-error', id: amountValidationMessageId, role: 'alert', children: amountValidationMessage })), _jsx("div", { className: 'actions', children: _jsx(TransactionActionButton, { idleLabel: buttonLabel, pendingLabel: pendingLabel, onClick: () => onApprove(nextApprovalAmount), pending: pending, tone: 'secondary', availability: { disabled: !canApprove, reason: allowanceMessage ?? visibleStatusMessage ?? guardMessage }, disabledReasonElementId: allowanceMessage === undefined && amountValidationMessage !== undefined ? amountValidationMessageId : undefined, showDisabledReason: allowanceMessage === undefined && amountValidationMessage === undefined }) }), allowanceMessage === undefined ? undefined : _jsx(ErrorNotice, { message: allowanceMessage }), allowanceMessage !== undefined || visibleStatusMessage === undefined || !canApprove ? undefined : _jsx("p", { className: 'detail', children: visibleStatusMessage })] }));
}
//# sourceMappingURL=TokenApprovalControl.js.map
import { maxUint256 } from '@zoltar/shared/ethereum';
import { parseDecimalInput } from './decimal.js';
import { sanitizeErrorDetail } from './errors.js';
import { formatCurrencyBalance } from './formatters.js';
export const maxUint200 = 2n ** 200n - 1n;
export function deriveTokenApprovalRequirement(requiredAmount, approvedAmount) {
    if (requiredAmount === undefined)
        return {
            approvedAmount,
            hasSufficientApproval: false,
            neededAmount: undefined,
            requiredAmount,
            targetAmount: undefined,
        };
    if (requiredAmount <= 0n)
        return {
            approvedAmount,
            hasSufficientApproval: true,
            neededAmount: 0n,
            requiredAmount,
            targetAmount: undefined,
        };
    const hasSufficientApproval = approvedAmount !== undefined && approvedAmount >= requiredAmount;
    const neededAmount = (() => {
        if (approvedAmount === undefined)
            return undefined;
        if (approvedAmount >= requiredAmount)
            return 0n;
        return requiredAmount - approvedAmount;
    })();
    return {
        approvedAmount,
        hasSufficientApproval,
        neededAmount,
        requiredAmount,
        targetAmount: hasSufficientApproval ? undefined : requiredAmount,
    };
}
export function parseTokenApprovalAmountInput(value, label, units) {
    const trimmed = value.trim();
    if (trimmed === '')
        return { kind: 'default' };
    if (trimmed.toLowerCase() === 'max')
        return { kind: 'max', amount: maxUint256 };
    return {
        kind: 'custom',
        amount: parseDecimalInput(trimmed, label, units),
    };
}
export function shouldDisplayMaxTokenApprovalAmount(amount) {
    return amount !== undefined && amount > maxUint200;
}
export function formatTokenApprovalUnavailableMessage({ actionLabel, reason, tokenLabel }) {
    const resolvedTokenLabel = tokenLabel?.trim() || 'token';
    const sanitizedReason = sanitizeErrorDetail(reason);
    const segments = [`Unable to verify ${resolvedTokenLabel} approval${actionLabel === undefined ? '' : ` before ${actionLabel}`}.`];
    if (sanitizedReason !== undefined)
        segments.push(`Reason: ${sanitizedReason}.`);
    segments.push('Retry loading the approval status before continuing.');
    return segments.join(' ');
}
export function resolveTokenApprovalStatusMessage({ actionLabel, amountValidationMessage, draftAmount, guardMessage, nextApprovalAmount, requiredAmount, requirement, tokenLabel, tokenUnits, }) {
    if (guardMessage !== undefined)
        return guardMessage;
    if (amountValidationMessage !== undefined)
        return amountValidationMessage;
    if (draftAmount.trim() === '')
        return formatTokenApprovalNeededMessage({
            actionLabel,
            requirement,
            tokenLabel,
            tokenUnits,
        });
    if (nextApprovalAmount === undefined || requiredAmount === undefined)
        return undefined;
    return formatTokenApprovalPartialMessage({
        actionLabel,
        nextApprovedAmount: nextApprovalAmount,
        requiredAmount,
        tokenLabel,
        tokenUnits,
    });
}
export function formatTokenApprovalNeededMessage({ actionLabel, requirement, tokenLabel, tokenUnits }) {
    if (requirement.neededAmount === undefined || requirement.neededAmount <= 0n)
        return undefined;
    const targetAmount = requirement.targetAmount ?? requirement.requiredAmount;
    if (targetAmount === undefined)
        return undefined;
    return `Need ${formatCurrencyBalance(requirement.neededAmount, tokenUnits)} more ${tokenLabel} approved before ${actionLabel}.`;
}
export function formatTokenApprovalPartialMessage({ actionLabel, nextApprovedAmount, requiredAmount, tokenLabel, tokenUnits }) {
    if (nextApprovedAmount >= requiredAmount)
        return undefined;
    return `Approving ${formatCurrencyBalance(nextApprovedAmount, tokenUnits)} ${tokenLabel} will still leave ${formatCurrencyBalance(requiredAmount - nextApprovedAmount, tokenUnits)} more ${tokenLabel} needed before ${actionLabel}.`;
}
//# sourceMappingURL=tokenApproval.js.map
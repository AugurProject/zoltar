import { maxUint256 } from '@zoltar/shared/ethereum';
export declare const maxUint200: bigint;
export type TokenApprovalState = {
    error: string | undefined;
    loading: boolean;
    value: bigint | undefined;
};
export type TokenApprovalRequirement = {
    approvedAmount: bigint | undefined;
    hasSufficientApproval: boolean;
    neededAmount: bigint | undefined;
    requiredAmount: bigint | undefined;
    targetAmount: bigint | undefined;
};
type ParsedTokenApprovalAmount = {
    kind: 'custom';
    amount: bigint;
} | {
    kind: 'default';
} | {
    kind: 'max';
    amount: typeof maxUint256;
};
export declare function deriveTokenApprovalRequirement(requiredAmount: bigint | undefined, approvedAmount: bigint | undefined): TokenApprovalRequirement;
export declare function parseTokenApprovalAmountInput(value: string, label: string, units: number): ParsedTokenApprovalAmount;
export declare function shouldDisplayMaxTokenApprovalAmount(amount: bigint | undefined): boolean;
export declare function formatTokenApprovalUnavailableMessage({ actionLabel, reason, tokenLabel }: {
    actionLabel?: string | undefined;
    reason: string | undefined;
    tokenLabel: string | undefined;
}): string;
export declare function resolveTokenApprovalStatusMessage({ actionLabel, amountValidationMessage, draftAmount, guardMessage, nextApprovalAmount, requiredAmount, requirement, tokenLabel, tokenUnits, }: {
    actionLabel: string;
    amountValidationMessage: string | undefined;
    draftAmount: string;
    guardMessage: string | undefined;
    nextApprovalAmount: bigint | undefined;
    requiredAmount: bigint | undefined;
    requirement: TokenApprovalRequirement;
    tokenLabel: string;
    tokenUnits: number;
}): string | undefined;
export declare function formatTokenApprovalNeededMessage({ actionLabel, requirement, tokenLabel, tokenUnits }: {
    actionLabel: string;
    requirement: TokenApprovalRequirement;
    tokenLabel: string;
    tokenUnits: number;
}): string | undefined;
export declare function formatTokenApprovalPartialMessage({ actionLabel, nextApprovedAmount, requiredAmount, tokenLabel, tokenUnits }: {
    actionLabel: string;
    nextApprovedAmount: bigint;
    requiredAmount: bigint;
    tokenLabel: string;
    tokenUnits: number;
}): string | undefined;
export {};
//# sourceMappingURL=tokenApproval.d.ts.map
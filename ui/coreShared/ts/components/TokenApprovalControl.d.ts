type TokenApprovalControlProps = {
    actionLabel: string;
    allowanceError: string | undefined;
    allowanceLoading: boolean;
    approvedAmount: bigint | undefined;
    disabled?: boolean | undefined;
    guardMessage: string | undefined;
    onApprove: (amount?: bigint) => void;
    pending: boolean;
    pendingLabel: string;
    requiredAmount: bigint | undefined;
    resetKey: string;
    tokenSymbol: string;
    tokenUnits: number;
};
export declare function TokenApprovalControl({ actionLabel, allowanceError, allowanceLoading, approvedAmount, disabled, guardMessage, onApprove, pending, pendingLabel, requiredAmount, resetKey, tokenSymbol, tokenUnits }: TokenApprovalControlProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=TokenApprovalControl.d.ts.map
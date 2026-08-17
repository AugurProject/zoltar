export declare const APPROVAL_MAX_DISPLAY_THRESHOLD: bigint;
type ApprovedAmountValueProps = {
    className?: string;
    copyable?: boolean;
    decimals?: number;
    loading?: boolean;
    requiredAmount?: bigint | undefined;
    suffix?: string;
    units?: number;
    value: bigint | undefined;
};
export declare function isApprovalAmountMaxDisplay(value: bigint | undefined): boolean;
export declare function getApprovedAmountTone(value: bigint | undefined, requiredAmount: bigint | undefined): "sufficient" | "insufficient" | undefined;
export declare function ApprovedAmountValue({ className, copyable, decimals, loading, requiredAmount, suffix, units, value }: ApprovedAmountValueProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=ApprovedAmountValue.d.ts.map
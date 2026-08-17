type CurrencyValueProps = {
    className?: string;
    compactWhenOverflow?: boolean;
    decimals?: number;
    loading?: boolean;
    copyable?: boolean;
    precision?: 'exact' | 'rounded';
    suffix?: string;
    units?: number;
    value: bigint | undefined;
};
export declare function CurrencyValue({ className, compactWhenOverflow, copyable, decimals, loading, precision, suffix, units, value }: CurrencyValueProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=CurrencyValue.d.ts.map
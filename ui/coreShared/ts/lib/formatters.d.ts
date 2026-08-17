export declare function formatTimestampDateTime(timestamp: bigint): string | undefined;
export declare function formatCurrencyBalance(value: bigint | undefined, units?: number): string;
export declare function formatCurrencyInputBalance(value: bigint, units?: number): string;
export declare function formatRoundedCurrencyBalance(value: bigint | undefined, units?: number, decimals?: number): string;
export declare function formatCompactCurrencyBalance(value: bigint | undefined, units?: number, decimals?: number): string;
export declare function formatTimestamp(timestamp: bigint): string;
export declare function formatRelativeTimestamp(timestamp: bigint, currentTimestamp: bigint): string;
export declare function formatDuration(seconds: bigint): string;
//# sourceMappingURL=formatters.d.ts.map
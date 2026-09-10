export type LogRange = Readonly<{
    fromBlock: bigint;
    toBlock: bigint;
}>;
export declare class LogScanError extends Error {
    readonly logRange: LogRange;
    constructor(logRange: LogRange, options: {
        cause?: unknown;
    });
}
export declare function logRangeLimitError(error: unknown): boolean;
export declare function fetchLogsWithAdaptiveRanges<Log>(fromBlock: bigint, toBlock: bigint, maximumRange: bigint, fetchRange: (logRange: LogRange) => Promise<readonly Log[]>): Promise<Log[]>;

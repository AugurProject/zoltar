import type { ComponentChildren } from 'preact';
type TimestampValueProps = {
    className?: string;
    currentTimestamp?: bigint;
    loading?: boolean;
    timestamp: bigint | undefined;
    undefinedText?: ComponentChildren;
    zeroText?: ComponentChildren;
};
export declare function TimestampValue({ className, currentTimestamp, loading, timestamp, undefinedText, zeroText }: TimestampValueProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=TimestampValue.d.ts.map
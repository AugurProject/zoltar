export declare function hasErrorCode(value: unknown): value is {
    code: number | string;
};
export declare function hasErrorMessage(value: unknown): value is {
    message: string;
};
export declare function isIgnorableLogDecodeError(error: unknown): boolean;
export declare function isRecoverableContractReadError(error: unknown): boolean;
export declare function isRecoverableQuoteError(error: unknown): boolean;
export declare function sanitizeErrorDetail(detail: string | undefined, fallbackMessage?: string): string | undefined;
export declare function getErrorDetail(error: unknown, fallbackMessage?: string): string | undefined;
export declare function formatWriteErrorMessage(error: unknown, fallbackMessage: string): string;
export declare function formatRefreshErrorMessage(error: unknown, fallbackMessage: string): string;
export declare function getErrorMessage(error: unknown, fallbackMessage: string): string;
export declare function isCloseableErrorMessage(message: string | undefined): boolean;
//# sourceMappingURL=errors.d.ts.map
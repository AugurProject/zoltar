export declare const QUESTION_PAGE_SIZE = 10;
export declare const SECURITY_POOL_PAGE_SIZE = 6;
export declare function getPaginationPageCount(itemCount: bigint | undefined, pageSize: number): bigint | undefined;
export declare function getHasNextPaginationPage(pageIndex: number, pageCount: bigint | undefined): boolean;
export declare function resolvePaginationPageIndex(pageIndex: number, pageCount: bigint | undefined): number;
export declare function formatPaginationSummary(pageIndex: number, pageCount: bigint | undefined): string | undefined;
//# sourceMappingURL=pagination.d.ts.map
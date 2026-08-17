export declare function clampVisualRatio(value: number | undefined): number;
export declare function getVisualRatio({ value, maxValue }: {
    value: bigint | undefined;
    maxValue: bigint | undefined;
}): number | undefined;
export declare function formatCollateralizationCompactPercentLabel(value: bigint | undefined, decimals?: number, unavailable?: string): string;
export declare function getToneRatioThreshold({ ratio, warningThreshold, successThreshold }: {
    ratio: number | undefined;
    warningThreshold?: number;
    successThreshold?: number;
}): "success" | "warning" | "danger" | "muted";
export declare function getCollateralizationVisualPercent({ collateralizationPercent, targetCollateralizationPercent }: {
    collateralizationPercent: bigint | undefined;
    targetCollateralizationPercent: bigint | undefined;
}): number | undefined;
export declare function takeTopRankedItems<TItem extends {
    value?: bigint;
}>({ items, limit }: {
    items: readonly TItem[];
    limit: number;
}): TItem[];
//# sourceMappingURL=visualMetrics.d.ts.map
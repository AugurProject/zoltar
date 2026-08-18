import type { ComponentChildren } from 'preact';
import type { MetricGridVariant } from '../../types.js';
import type { ListedSecurityPool } from '@zoltar/ui-core-shared/types/contracts.js';
type SecurityPoolSummaryMetricsProps = {
    children?: ComponentChildren;
    className?: string;
    currentTimestamp?: bigint | undefined;
    metricVariant?: MetricGridVariant;
    pool: ListedSecurityPool;
    showPoolAddress?: boolean;
    showTotalBacking?: boolean;
    showUniverse?: boolean;
    variant?: 'embedded' | 'hero';
};
export declare function SecurityPoolSummaryMetrics({ children, className, currentTimestamp, metricVariant, pool, showPoolAddress, showTotalBacking, showUniverse, variant }: SecurityPoolSummaryMetricsProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=SecurityPoolSummaryMetrics.d.ts.map
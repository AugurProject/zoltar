import type { ComponentChildren } from 'preact';
import { type RepPriceSource } from '@zoltar/ui-zoltar/features/open-oracle/lib/repPriceSource.js';
type CollateralizationMetricFieldProps = {
    className?: string | undefined;
    collateralizationPercent: bigint | undefined;
    label?: ComponentChildren;
    repPerEthSource: RepPriceSource | undefined;
    repPerEthSourceUrl: string | undefined;
    capacityOwnershipAttoRep: bigint | undefined;
    statoblastSecurityMultiplierBps: bigint | undefined;
    unavailableCopy?: string | undefined;
};
export declare function CollateralizationMetricField({ className, collateralizationPercent, label, repPerEthSource, repPerEthSourceUrl, capacityOwnershipAttoRep, statoblastSecurityMultiplierBps, unavailableCopy }: CollateralizationMetricFieldProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=CollateralizationMetricField.d.ts.map
import type { Address } from '@zoltar/shared/ethereum';
import type { ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js';
type ChildUniverseDetailsProps = {
    accountAddress: Address | undefined;
    child: ZoltarChildUniverseSummary;
    isSupportedChain: boolean;
    showOutcomeIndex?: boolean;
};
export declare function ChildUniverseDetails({ accountAddress, child, isSupportedChain, showOutcomeIndex }: ChildUniverseDetailsProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=ChildUniverseDetails.d.ts.map
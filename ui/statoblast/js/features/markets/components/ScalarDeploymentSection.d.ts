import type { Address } from '@zoltar/shared/ethereum';
import type { MarketDetails, ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js';
type ScalarDeploymentSectionProps = {
    accountAddress: Address | undefined;
    childUniverses: ZoltarChildUniverseSummary[];
    hasForked: boolean;
    isOnActiveAppChain: boolean;
    onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void;
    questionDetails: MarketDetails | undefined;
    zoltarChildUniverseError: string | undefined;
    zoltarChildUniversePendingOutcomeIndex: bigint | undefined;
};
export declare function ScalarDeploymentSection({ accountAddress, childUniverses, hasForked, isOnActiveAppChain, onCreateChildUniverseForOutcomeIndex, questionDetails, zoltarChildUniverseError, zoltarChildUniversePendingOutcomeIndex }: ScalarDeploymentSectionProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=ScalarDeploymentSection.d.ts.map
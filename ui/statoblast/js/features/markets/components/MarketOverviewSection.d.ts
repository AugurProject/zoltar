import type { Address } from '@zoltar/shared/ethereum';
import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js';
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js';
type MarketOverviewSectionProps = {
    accountAddress: Address | undefined;
    isOnActiveAppChain: boolean;
    loadingZoltarUniverse: boolean;
    onCreateChildUniverseForOutcomeIndex: (outcomeIndex: bigint) => void;
    zoltarChildUniverseError: string | undefined;
    zoltarChildUniversePendingOutcomeIndex: bigint | undefined;
    zoltarUniverse: ZoltarUniverseSummary | undefined;
    zoltarUniverseState: LoadableValueState;
};
export declare function MarketOverviewSection({ accountAddress, isOnActiveAppChain, loadingZoltarUniverse, onCreateChildUniverseForOutcomeIndex, zoltarChildUniverseError, zoltarChildUniversePendingOutcomeIndex, zoltarUniverse, zoltarUniverseState }: MarketOverviewSectionProps): import("preact").JSX.Element | undefined;
export {};
//# sourceMappingURL=MarketOverviewSection.d.ts.map
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js';
type ShareMigrationTargetsSectionProps = {
    disabled: boolean;
    forkUniverse: ZoltarUniverseSummary | undefined;
    onClearOutcomeIndexes: () => void;
    onSelectAllOutcomeIndexes: () => void;
    onToggleOutcomeIndex: (outcomeIndex: bigint) => void;
    selectedOutcomeIndexes: bigint[];
    selectedOutcomeIndexSet: Set<string>;
};
export declare function ShareMigrationTargetsSection({ disabled, forkUniverse, onClearOutcomeIndexes, onSelectAllOutcomeIndexes, onToggleOutcomeIndex, selectedOutcomeIndexes, selectedOutcomeIndexSet }: ShareMigrationTargetsSectionProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=ShareMigrationTargetsSection.d.ts.map
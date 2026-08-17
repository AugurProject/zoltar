import type { ZoltarChildUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js';
type MigrationOutcomeUniversesSectionProps = {
    childUniverses: ZoltarChildUniverseSummary[];
    disabled: boolean;
    migrationBalance: bigint | undefined;
    isScalarFork: boolean;
    onAddNextOutcome: () => void;
    onToggleOutcomeIndex: (outcomeIndex: bigint) => void;
    childUniverseRepBalances: Record<string, bigint | undefined>;
    selectedOutcomeIndexSet: Set<string>;
};
export declare function getMigrationOutcomeHeldBalance(child: ZoltarChildUniverseSummary, childUniverseRepBalances: Record<string, bigint | undefined>): bigint | undefined;
export declare function getMigrationOutcomeSplitLimit(childUniverses: ZoltarChildUniverseSummary[], childUniverseRepBalances: Record<string, bigint | undefined>, migrationBalance: bigint | undefined, selectedOutcomeIndexSet: Set<string>): bigint | undefined;
export declare function MigrationOutcomeUniversesSection({ childUniverses, childUniverseRepBalances, disabled, isScalarFork, migrationBalance, onAddNextOutcome, onToggleOutcomeIndex, selectedOutcomeIndexSet }: MigrationOutcomeUniversesSectionProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=MigrationOutcomeUniversesSection.d.ts.map
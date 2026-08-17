import type { Address, Hash } from '@zoltar/shared/ethereum';
import type { ActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js';
import type { WriteOperationsParameters, ZoltarMigrationFormState } from '../../../types/app.js';
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js';
type UseZoltarMigrationParameters = {
    accountAddress: Address | undefined;
    activeUniverseId: bigint;
    ensureZoltarUniverse: () => Promise<ZoltarUniverseSummary>;
    onTransactionFailed?: WriteOperationsParameters['onTransactionFailed'];
    onTransactionFinished: () => void;
    onTransactionPresented: WriteOperationsParameters['onTransactionPresented'];
    onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared'];
    onTransactionRequested: WriteOperationsParameters['onTransactionRequested'];
    onTransactionSubmitted: (hash: Hash) => void;
    refreshState: WriteOperationsParameters['refreshState'];
    refreshZoltarForkAccess: (universe?: ZoltarUniverseSummary) => Promise<void>;
    refreshZoltarUniverse: () => Promise<ZoltarUniverseSummary | undefined>;
    zoltarForkRepBalanceAttoRep: bigint | undefined;
    zoltarMigrationPreparedRepBalanceAttoRep: bigint | undefined;
};
export declare function useZoltarMigration({ accountAddress, activeUniverseId, ensureZoltarUniverse, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, refreshZoltarForkAccess, refreshZoltarUniverse, zoltarForkRepBalanceAttoRep, zoltarMigrationPreparedRepBalanceAttoRep, }: UseZoltarMigrationParameters): {
    migrateInternalRep: () => Promise<void>;
    prepareRepForMigration: () => Promise<void>;
    setZoltarMigrationForm: (updater: (current: ZoltarMigrationFormState) => ZoltarMigrationFormState) => void;
    zoltarMigrationActiveAction: "split" | "prepare" | undefined;
    zoltarMigrationError: string | undefined;
    zoltarMigrationFeedback: ActionFeedback<"addRepToMigrationBalance" | "splitMigrationRep"> | undefined;
    zoltarMigrationForm: ZoltarMigrationFormState;
    zoltarMigrationPending: boolean;
};
export {};
//# sourceMappingURL=useZoltarMigration.d.ts.map
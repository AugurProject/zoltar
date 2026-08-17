import type { Address } from '@zoltar/shared/ethereum';
import type { LoadableValueState } from '@zoltar/ui-core-shared/lib/loadState.js';
import { type TokenApprovalState } from '@zoltar/ui-core-shared/lib/tokenApproval.js';
import type { ZoltarMigrationFormState } from '../../../types/app.js';
import type { ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js';
type ZoltarMigrationSectionProps = {
    accountAddress: Address | undefined;
    isOnActiveAppChain: boolean;
    loadingZoltarForkAccess: boolean;
    loadingZoltarUniverse: boolean;
    onMigrateInternalRep: () => void;
    onPrepareRepForMigration: () => void;
    onZoltarMigrationFormChange: (update: Partial<ZoltarMigrationFormState>) => void;
    zoltarForkRepBalanceAttoRep: bigint | undefined;
    zoltarForkApproval: TokenApprovalState;
    zoltarForkActiveAction: 'approve' | 'fork' | undefined;
    zoltarMigrationChildRepBalancesAttoRep: Record<string, bigint | undefined>;
    zoltarMigrationActiveAction: 'prepare' | 'split' | undefined;
    zoltarMigrationError: string | undefined;
    zoltarMigrationForm: ZoltarMigrationFormState;
    zoltarMigrationPending: boolean;
    zoltarMigrationPreparedRepBalanceAttoRep: bigint | undefined;
    zoltarUniverse: ZoltarUniverseSummary | undefined;
    zoltarUniverseState: LoadableValueState;
    onApproveZoltarForkRep: (amount?: bigint) => void;
};
export declare function ZoltarMigrationSection({ accountAddress, isOnActiveAppChain, loadingZoltarForkAccess, loadingZoltarUniverse, onMigrateInternalRep, onPrepareRepForMigration, onZoltarMigrationFormChange, zoltarForkRepBalanceAttoRep, zoltarForkApproval, zoltarForkActiveAction, zoltarMigrationChildRepBalancesAttoRep, zoltarMigrationActiveAction, zoltarMigrationError, zoltarMigrationForm, zoltarMigrationPending, zoltarMigrationPreparedRepBalanceAttoRep, zoltarUniverse, zoltarUniverseState, onApproveZoltarForkRep, }: ZoltarMigrationSectionProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=ZoltarMigrationSection.d.ts.map
import { type Address, type Hash } from '@zoltar/shared/ethereum';
import type { WriteOperationsParameters } from '../../../types/app.js';
import type { ZoltarForkActionResult, ZoltarUniverseSummary } from '@zoltar/ui-core-shared/types/contracts.js';
type UseZoltarForkParameters = {
    accountAddress: Address | undefined;
    activeUniverseId: bigint;
    environmentRefreshKey: number;
    ensureZoltarUniverse: () => Promise<ZoltarUniverseSummary>;
    onTransactionFailed?: WriteOperationsParameters['onTransactionFailed'];
    onTransactionFinished: () => void;
    onTransactionPresented: WriteOperationsParameters['onTransactionPresented'];
    onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared'];
    onTransactionRequested: WriteOperationsParameters['onTransactionRequested'];
    onTransactionSubmitted: (hash: Hash) => void;
    refreshState: WriteOperationsParameters['refreshState'];
    refreshZoltarUniverse: () => Promise<ZoltarUniverseSummary | undefined>;
    shouldAutoLoadForkAccess: boolean;
    zoltarUniverse: ZoltarUniverseSummary | undefined;
};
type OptionalReadResult<TResult> = {
    result: TResult;
    status: 'success';
} | {
    error: Error;
    result?: undefined;
    status: 'failure';
};
type ZoltarForkAccessChildUniverse = ZoltarUniverseSummary['childUniverses'][number];
export type UseZoltarForkDependencies = {
    approveForkRep: (accountAddress: Address, callbacks: {
        onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared'];
        onTransactionSubmitted: (hash: Hash) => void;
    }, reputationToken: Address, amount: bigint, questionId: bigint, universeId: bigint) => Promise<ZoltarForkActionResult>;
    forkZoltarUniverse: (accountAddress: Address, callbacks: {
        onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared'];
        onTransactionSubmitted: (hash: Hash) => void;
    }, universeId: bigint, questionId: bigint) => Promise<ZoltarForkActionResult>;
    loadZoltarForkAccess: (accountAddress: Address, reputationToken: Address, universeId: bigint, childUniverses: ZoltarForkAccessChildUniverse[]) => Promise<readonly OptionalReadResult<bigint>[]>;
};
export declare function useZoltarFork({ accountAddress, activeUniverseId, environmentRefreshKey, ensureZoltarUniverse, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, refreshZoltarUniverse, shouldAutoLoadForkAccess, zoltarUniverse, }: UseZoltarForkParameters, dependencies?: UseZoltarForkDependencies): {
    approveZoltarForkRep: (amount?: bigint) => Promise<void>;
    forkZoltar: () => Promise<void>;
    loadZoltarForkAccess: (universe?: ZoltarUniverseSummary | undefined) => Promise<void>;
    loadingZoltarForkAccess: any;
    zoltarForkActiveAction: "fork" | "approve" | undefined;
    zoltarForkApproval: any;
    zoltarForkError: string | undefined;
    zoltarForkFeedback: any;
    zoltarForkPending: boolean;
    zoltarForkQuestionId: string;
    zoltarForkRepBalanceAttoRep: bigint | undefined;
    zoltarForkResult: any;
    zoltarMigrationChildRepBalancesAttoRep: Record<string, bigint | undefined>;
    zoltarMigrationPreparedRepBalanceAttoRep: bigint | undefined;
    setZoltarForkQuestionId: (questionId: string) => void;
};
export {};
//# sourceMappingURL=useZoltarFork.d.ts.map
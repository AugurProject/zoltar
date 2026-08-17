import type { Address } from '@zoltar/shared/ethereum';
import { loadReportingDetails, reportOutcomeInSecurityPool, withdrawEscalationFromSecurityPool } from '../../../protocol/index.js';
import { createWalletWriteClient } from '@zoltar/ui-core-shared/lib/clients.js';
import type { WriteOperationsParameters } from '../../../types/app.js';
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js';
type UseReportingOperationsParameters = WriteOperationsParameters;
type ResolvedReportingOperationsParameters = UseReportingOperationsParameters & {
    selectedSecurityPoolAddress?: string;
};
export type UseReportingOperationsDependencies = {
    loadReportingDetails: (securityPoolAddress: Address, accountAddress: Address | undefined) => ReturnType<typeof loadReportingDetails>;
    reportOutcomeInSecurityPool: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], securityPoolAddress: Address, outcome: Parameters<typeof reportOutcomeInSecurityPool>[2], amount: bigint) => ReturnType<typeof reportOutcomeInSecurityPool>;
    withdrawEscalationFromSecurityPool: (accountAddress: Address, callbacks: Parameters<typeof createWalletWriteClient>[1], securityPoolAddress: Address, outcome: Parameters<typeof withdrawEscalationFromSecurityPool>[2], depositIndexes: bigint[]) => ReturnType<typeof withdrawEscalationFromSecurityPool>;
};
export declare function useReportingOperations({ accountAddress, onTransactionCanceled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, selectedSecurityPoolAddress }: ResolvedReportingOperationsParameters, dependencies?: UseReportingOperationsDependencies): {
    loadingReportingDetails: any;
    loadReporting: () => Promise<void>;
    onReportOutcome: () => Promise<void>;
    reportingActiveAction: any;
    reportingDetails: any;
    reportingError: string | undefined;
    reportingFeedback: any;
    reportingForm: any;
    reportingResult: any;
    setReportingForm: any;
    withdrawEscalation: (outcome: ReportingOutcomeKey, depositIndexesOverride?: bigint[]) => Promise<void>;
};
export {};
//# sourceMappingURL=useReportingOperations.d.ts.map
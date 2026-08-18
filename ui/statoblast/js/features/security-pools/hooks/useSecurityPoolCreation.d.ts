import type { Address, Hash } from '@zoltar/shared/ethereum';
import type { ActionFeedback } from '@zoltar/ui-core-shared/lib/actionFeedback.js';
import type { SecurityPoolFormState, WriteOperationsParameters } from '../../../types/app.js';
import type { DeploymentStatus, MarketDetails, SecurityPoolCreationResult } from '@zoltar/ui-core-shared/types/contracts.js';
type UseSecurityPoolCreationParameters = {
    accountAddress: Address | undefined;
    deploymentStatuses: DeploymentStatus[];
    enabled: boolean;
    onTransactionFailed?: WriteOperationsParameters['onTransactionFailed'];
    onTransactionFinished: () => void;
    onTransactionPresented: WriteOperationsParameters['onTransactionPresented'];
    onTransactionPrepared?: WriteOperationsParameters['onTransactionPrepared'];
    onTransactionRequested: WriteOperationsParameters['onTransactionRequested'];
    onTransactionSubmitted: (hash: Hash) => void;
    refreshState: WriteOperationsParameters['refreshState'];
    zoltarUniverseHasForked: boolean;
};
export declare function resolveSecurityPoolQuestionLookupInput(marketIdInput: string): string | undefined;
export declare function useSecurityPoolCreation({ accountAddress, deploymentStatuses, enabled, onTransactionFailed, onTransactionFinished, onTransactionPresented, onTransactionPrepared, onTransactionRequested, onTransactionSubmitted, refreshState, zoltarUniverseHasForked }: UseSecurityPoolCreationParameters): {
    checkingDuplicateOriginPool: boolean;
    duplicateOriginPoolExists: boolean;
    loadMarketById: (marketId: string, options?: {
        clearExisting?: boolean;
        isCurrent?: () => boolean;
    }) => Promise<void>;
    loadingMarketDetails: boolean;
    marketDetails: MarketDetails | undefined;
    securityPoolCreationFeedback: ActionFeedback<"createSecurityPool"> | undefined;
    securityPoolCreating: boolean;
    securityPoolError: string | undefined;
    securityPoolForm: SecurityPoolFormState;
    securityPoolResult: SecurityPoolCreationResult | undefined;
    poolCreationMarketDetails: MarketDetails | undefined;
    resetSecurityPoolCreation: () => void;
    setSecurityPoolForm: (updater: (current: SecurityPoolFormState) => SecurityPoolFormState) => void;
    createPool: () => Promise<void>;
};
export {};
//# sourceMappingURL=useSecurityPoolCreation.d.ts.map
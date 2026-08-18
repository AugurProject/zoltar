import type { StagedOracleOperation } from '@zoltar/ui-core-shared/types/contracts.js';
import type { SecurityVaultSectionProps } from '../../types.js';
type SelectedVaultSummarySectionProps = Pick<SecurityVaultSectionProps, 'repPerEthPrice' | 'repPerEthSource' | 'repPerEthSourceUrl' | 'selectedPoolStatoblastSecurityMultiplierBps'> & {
    capacityOwnershipAttoRep: bigint;
    securityVaultDetails: NonNullable<SecurityVaultSectionProps['securityVaultDetails']>;
    selectedVaultIsOwnedByAccount: boolean;
    variant?: 'embedded' | 'record';
};
export declare function SelectedVaultSummarySection({ repPerEthPrice, repPerEthSource, repPerEthSourceUrl, capacityOwnershipAttoRep, securityVaultDetails, selectedPoolStatoblastSecurityMultiplierBps, selectedVaultIsOwnedByAccount, variant }: SelectedVaultSummarySectionProps): import("preact").JSX.Element;
export declare function getQueuedVaultOperation({ pendingOperation, selectedVaultOwner, securityVaultResult }: {
    pendingOperation: StagedOracleOperation | undefined;
    selectedVaultOwner: string;
    securityVaultResult: SecurityVaultSectionProps['securityVaultResult'];
}): {
    amount: bigint;
    isPendingSlot: true;
    operationId: bigint;
} | {
    amount: undefined;
    isPendingSlot: boolean;
    operationId: bigint;
} | undefined;
export declare function SecurityVaultSection({ accountState, compactLayout, autoLoadVault, extraReadinessActions, loadingSecurityVault, modalFirst, onApproveRep, onDepositRepToVault, onLoadSecurityVault, onRedeemFees, onRedeemRepFromVault, onSecurityVaultFormChange, oracleManagerDetails, onViewStagedOperations, onWithdrawRep, repPerEthPrice, repPerEthSource, repPerEthSourceUrl, securityVaultDetails, securityVaultError, securityVaultForm, securityVaultMissing, securityVaultActiveAction, securityVaultRepApproval, walletRepBalanceAttoRep, walletRepBalanceError, walletRepBalanceLoading, securityVaultResult, selectedPoolStatoblastSecurityMultiplierBps, selectedMarketTitle, selectedPoolTotalPoolHeldAttoRep, selectedPoolTotalCapacityOwnershipAttoRep, showHeader, showLookupSection, showSecurityPoolAddressInput, showSummarySection, poolState, }: SecurityVaultSectionProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=SecurityVaultSection.d.ts.map
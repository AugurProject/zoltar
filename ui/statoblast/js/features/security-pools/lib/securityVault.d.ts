import type { Address } from '@zoltar/shared/ethereum';
import type { OracleManagerDetails } from '@zoltar/ui-core-shared/types/contracts.js';
import type { SecurityVaultDetails } from '@zoltar/ui-core-shared/types/contracts.js';
import { getOracleManagerPriceValidUntilTimestamp, ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS } from '@zoltar/ui-zoltar/protocol/oracleTiming.js';
export { getOracleManagerPriceValidUntilTimestamp, ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS };
export declare const MIN_SECURITY_VAULT_REP_DEPOSIT_ATTO_REP: bigint;
export declare const DEFAULT_STAGED_OPERATION_TIMEOUT_MINUTES = 5n;
export declare const MIN_STAGED_OPERATION_TIMEOUT_MINUTES = 1n;
export declare const MAX_STAGED_OPERATION_TIMEOUT_MINUTES = 5n;
export declare function parseTargetHealthFactorBps(value: string): bigint;
export declare function getSelectedVaultOwner(selectedVaultOwner: string | undefined, accountAddress: Address | undefined): string | undefined;
export declare function isSelectedVaultOwnedByAccount(selectedVaultOwner: string | undefined, accountAddress: Address | undefined): boolean;
export declare function doesLoadedSecurityVaultMatchSelection({ accountAddress, securityPoolAddress, securityVaultDetails, selectedVaultOwner }: {
    accountAddress: Address | undefined;
    securityPoolAddress: string | undefined;
    securityVaultDetails: SecurityVaultDetails | undefined;
    selectedVaultOwner: string | undefined;
}): boolean;
export declare function isSecurityVaultDepositBelowMinimum(currentVaultRepBackingAttoRep: bigint | undefined, depositAmount: bigint | undefined, minimumVaultRepDepositAttoRep?: bigint): boolean;
export declare function doesSecurityVaultExistOnchain(securityVaultDetails: SecurityVaultDetails | undefined): boolean;
export declare function getSecurityVaultWithdrawableRepAmount({ disputeStakedAttoRep, vaultAttoRepBacking, repPerEthPrice, capacityOwnershipAttoRep, statoblastSecurityMultiplierBps, totalPoolHeldAttoRep, totalCapacityOwnershipAttoRep, }: {
    vaultAttoRepBacking: bigint | undefined;
    disputeStakedAttoRep?: bigint | undefined;
    repPerEthPrice: bigint | undefined;
    capacityOwnershipAttoRep: bigint | undefined;
    statoblastSecurityMultiplierBps: bigint | undefined;
    totalPoolHeldAttoRep?: bigint | undefined;
    totalCapacityOwnershipAttoRep?: bigint | undefined;
}): bigint | undefined;
export declare function getSecurityVaultMaxCapacityOwnershipAttoRepAmount({ currentCapacityOwnershipAttoRep, disputeStakedAttoRep, vaultAttoRepBacking, repPerEthPrice, statoblastSecurityMultiplierBps, totalPoolHeldAttoRep, totalCapacityOwnershipAttoRep, }: {
    currentCapacityOwnershipAttoRep?: bigint | undefined;
    disputeStakedAttoRep?: bigint | undefined;
    vaultAttoRepBacking: bigint | undefined;
    repPerEthPrice: bigint | undefined;
    statoblastSecurityMultiplierBps: bigint | undefined;
    totalPoolHeldAttoRep?: bigint | undefined;
    totalCapacityOwnershipAttoRep?: bigint | undefined;
}): bigint;
export declare function getStagedOperationTimeoutSeconds(timeoutMinutes: bigint | undefined): bigint | undefined;
export declare function hasValidSecurityVaultOraclePrice(managerAddress: Address | undefined, oracleManagerDetails: Pick<OracleManagerDetails, 'isPriceValid' | 'lastSettlementTimestamp' | 'managerAddress' | 'priceValidUntilTimestamp'> | undefined, currentTimestamp?: bigint): boolean;
export declare function isOracleManagerPriceUsable(oracleManagerDetails: Pick<OracleManagerDetails, 'isPriceValid' | 'lastSettlementTimestamp' | 'priceValidUntilTimestamp'> | undefined, currentTimestamp?: bigint | undefined): boolean;
//# sourceMappingURL=securityVault.d.ts.map
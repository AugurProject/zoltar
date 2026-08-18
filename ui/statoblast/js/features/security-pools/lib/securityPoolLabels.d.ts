import type { SecurityPoolLifecycleState } from './securityPoolState.js';
import type { ReportingOutcomeKey } from '@zoltar/ui-core-shared/types/contracts.js';
type VaultLauncherAction = 'claim-fees' | 'deposit-rep' | 'rep-exit';
type RepExitMode = 'redeem' | 'withdraw';
export declare function formatSecurityPoolPageSummary(matchingPoolCount: number, loadedPoolCount: number): string;
export declare function getVaultLauncherWalletReason(action: VaultLauncherAction, repExitMode: RepExitMode): "Connect a wallet before claiming fees." | "Connect a wallet before depositing REP." | "Connect a wallet before redeeming REP." | "Connect a wallet before withdrawing REP.";
export declare function getVaultLauncherVaultOwnerReason(action: VaultLauncherAction, repExitMode: RepExitMode): "Select your own vault to claim fees." | "Select your own vault to deposit REP." | "Select your own vault to redeem REP." | "Select your own vault to withdraw REP.";
export declare function getSecurityPoolLifecycleLabel(state: SecurityPoolLifecycleState | undefined): "Truth Auction" | "Operational" | "Unknown" | "Ended" | "Pool Forked" | "Fork Migration";
export declare function getSecurityPoolStatusBadgeLabel({ hasForkActivity, questionOutcome, lifecycleState }: {
    hasForkActivity: boolean;
    questionOutcome?: ReportingOutcomeKey | 'none';
    lifecycleState: SecurityPoolLifecycleState | undefined;
}): string;
export {};
//# sourceMappingURL=securityPoolLabels.d.ts.map
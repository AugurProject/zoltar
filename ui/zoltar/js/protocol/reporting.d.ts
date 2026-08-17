import { type Address } from '@zoltar/shared/ethereum';
import type { CarriedDepositProof, EscalationDeposit, ReadClient, ReportingDetails, ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function loadEscalationDeposits(client: Pick<ReadClient, 'readContract'>, escalationGameAddress: Address, outcome: ReportingOutcomeKey): Promise<EscalationDeposit[]>;
export declare function loadReportingDetails(client: ReadClient, securityPoolAddress: Address, accountAddress: Address | undefined): Promise<ReportingDetails>;
export declare function reportOutcomeInSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, amountAttoRep: bigint): Promise<{
    action: "reportOutcome";
    hash: `0x${string}`;
    outcome: ReportingOutcomeKey;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function withdrawEscalationFromSecurityPool(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]): Promise<{
    action: "withdrawEscalation";
    hash: `0x${string}`;
    outcome: ReportingOutcomeKey;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function buildForkCarriedEscalationProofs(client: ReadClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, parentDepositIndexes: readonly bigint[]): Promise<CarriedDepositProof[]>;
export declare function withdrawForkedEscalationDeposits(client: WriteClient, securityPoolAddress: Address, outcome: ReportingOutcomeKey, proofs: readonly CarriedDepositProof[]): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
//# sourceMappingURL=reporting.d.ts.map
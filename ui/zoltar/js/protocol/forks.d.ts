import { type Address } from '@zoltar/shared/ethereum';
import type { ForkAuctionDetails, ReadClient, ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function loadForkOutcomeMigrationSeedStatus(client: Pick<ReadClient, 'readContract'>, { childSecurityPoolAddress, outcome, securityPoolAddress, universeId, }: {
    childSecurityPoolAddress?: Address | undefined;
    outcome: ReportingOutcomeKey;
    securityPoolAddress: Address;
    universeId: bigint;
}): Promise<{
    childPoolRepBalanceAttoRep: any;
    childRepToken: any;
    childUniverseId: any;
    migrationProxyAddress: any;
    pendingProxyRepBalanceAttoRep: any;
    seeded: boolean;
}>;
export declare function loadForkAuctionDetails(client: ReadClient, securityPoolAddress: Address): Promise<ForkAuctionDetails>;
export declare function forkZoltarWithOwnEscalation(client: WriteClient, securityPoolAddress: Address, universeId: bigint): Promise<any>;
export declare function initiateSecurityPoolFork(client: WriteClient, securityPoolAddress: Address, universeId: bigint): Promise<any>;
export declare function createChildUniverseFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey): Promise<any>;
export declare function createZoltarChildUniverse(client: WriteClient, universeId: bigint, outcomeIndex: bigint): Promise<ZoltarChildUniverseActionResult>;
export declare function prepareRepForMigrationInZoltar(client: WriteClient, universeId: bigint, amountAttoRep: bigint): Promise<ZoltarMigrationActionResult>;
export declare function migrateInternalRepInZoltar(client: WriteClient, universeId: bigint, amountAttoRep: bigint, outcomeIndexes: bigint[]): Promise<ZoltarMigrationActionResult>;
export declare function migrateRepToZoltarFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcomes: ReportingOutcomeKey[]): Promise<any>;
export declare function migrateSecurityVault(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey): Promise<any>;
export declare function claimParentEscalationDeposits(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]): Promise<any>;
export declare function migrateVaultWithUnresolvedEscalation(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey): Promise<any>;
export declare function forkUniverseDirectly(client: WriteClient, universeId: bigint, questionId: bigint, securityPoolAddress: Address): Promise<ForkAuctionActionResult>;
export declare function forkZoltarUniverse(client: WriteClient, universeId: bigint, questionId: bigint): Promise<ZoltarForkActionResult>;
//# sourceMappingURL=forks.d.ts.map
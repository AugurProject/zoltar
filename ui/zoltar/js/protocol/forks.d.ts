import { type Address } from '@zoltar/shared/ethereum';
import type { ForkAuctionDetails, ReadClient, ReportingOutcomeKey, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function loadForkOutcomeMigrationSeedStatus(client: Pick<ReadClient, 'readContract'>, { childSecurityPoolAddress, outcome, securityPoolAddress, universeId, }: {
    childSecurityPoolAddress?: Address | undefined;
    outcome: ReportingOutcomeKey;
    securityPoolAddress: Address;
    universeId: bigint;
}): Promise<{
    childPoolRepBalanceAttoRep: bigint;
    childRepToken: undefined;
    childUniverseId: bigint;
    migrationProxyAddress: `0x${string}`;
    pendingProxyRepBalanceAttoRep: bigint;
    seeded: boolean;
} | {
    childPoolRepBalanceAttoRep: bigint;
    childRepToken: `0x${string}`;
    childUniverseId: bigint;
    migrationProxyAddress: `0x${string}`;
    pendingProxyRepBalanceAttoRep: bigint;
    seeded: boolean;
}>;
export declare function loadForkAuctionDetails(client: ReadClient, securityPoolAddress: Address): Promise<ForkAuctionDetails>;
export declare function forkZoltarWithOwnEscalation(client: WriteClient, securityPoolAddress: Address, universeId: bigint): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function initiateSecurityPoolFork(client: WriteClient, securityPoolAddress: Address, universeId: bigint): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function createChildUniverseFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function createZoltarChildUniverse(client: WriteClient, universeId: bigint, outcomeIndex: bigint): Promise<{
    action: "createChildUniverse";
    hash: `0x${string}`;
    outcomeIndex: bigint;
    universeId: bigint;
}>;
export declare function prepareRepForMigrationInZoltar(client: WriteClient, universeId: bigint, amountAttoRep: bigint): Promise<{
    action: "addRepToMigrationBalance" | "splitMigrationRep";
    amountAttoRep: bigint;
    hash: `0x${string}`;
    outcomeIndexes: bigint[];
    universeId: bigint;
}>;
export declare function migrateInternalRepInZoltar(client: WriteClient, universeId: bigint, amountAttoRep: bigint, outcomeIndexes: bigint[]): Promise<{
    action: "addRepToMigrationBalance" | "splitMigrationRep";
    amountAttoRep: bigint;
    hash: `0x${string}`;
    outcomeIndexes: bigint[];
    universeId: bigint;
}>;
export declare function migrateRepToZoltarFromSecurityPool(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcomes: ReportingOutcomeKey[]): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function migrateSecurityVault(client: WriteClient, securityPoolAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function claimParentEscalationDeposits(client: WriteClient, securityPoolAddress: Address, universeId: bigint, vaultAddress: Address, outcome: ReportingOutcomeKey, depositIndexes: bigint[]): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function migrateVaultWithUnresolvedEscalation(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address, universeId: bigint, outcome: ReportingOutcomeKey): Promise<{
    action: import("@zoltar/ui-core-shared/types/contracts.js").ForkAuctionAction;
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function forkUniverseDirectly(client: WriteClient, universeId: bigint, questionId: bigint, securityPoolAddress: Address): Promise<{
    action: "forkUniverse";
    hash: `0x${string}`;
    securityPoolAddress: `0x${string}`;
    universeId: bigint;
}>;
export declare function forkZoltarUniverse(client: WriteClient, universeId: bigint, questionId: bigint): Promise<{
    action: "forkZoltar";
    hash: `0x${string}`;
    questionId: string;
    universeId: bigint;
}>;
//# sourceMappingURL=forks.d.ts.map
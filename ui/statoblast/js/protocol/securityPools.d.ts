import { type Address } from '@zoltar/shared/ethereum';
import type { ListedSecurityPool, SecurityPoolPage, SecurityPoolVaultSummary, SecurityVaultDetails, WriteClient, ReadClient } from '@zoltar/ui-core-shared/types/contracts.js';
export type LoadAllSecurityPoolsOptions = {
    accountAddress?: Address;
    selectedSecurityPoolAddress?: Address | string;
    vaultDetailMode?: 'all' | 'selected';
};
export declare function loadSecurityPoolVaultSummary(client: ReadClient, securityPoolAddress: Address, vaultAddress: Address): Promise<SecurityPoolVaultSummary>;
export declare function loadAllSecurityPools(client: ReadClient, options?: LoadAllSecurityPoolsOptions): Promise<ListedSecurityPool[]>;
export declare function createSecurityPool(client: WriteClient, parameters: {
    initialReportPriorityFeeAttoEthPerGas: bigint;
    questionId: bigint;
    statoblastSecurityMultiplierBps: bigint;
}): Promise<{
    deployPoolHash: `0x${string}`;
    initialReportPriorityFeeAttoEthPerGas: bigint;
    questionId: string;
    securityPoolAddress: `0x${string}`;
    statoblastSecurityMultiplierBps: bigint;
    universeId: bigint;
}>;
export declare function originSecurityPoolExists(client: Pick<ReadClient, 'getCode'>, questionId: bigint, statoblastSecurityMultiplierBps: bigint, initialReportPriorityFeeAttoEthPerGas: bigint): Promise<boolean>;
export declare function loadSecurityPoolPage(client: ReadClient, pageIndex: number, pageSize: number, accountAddress?: Address): Promise<SecurityPoolPage>;
export declare function loadSecurityVaultDetails(client: ReadClient, securityPoolAddress: Address, vaultAddress: Address): Promise<SecurityVaultDetails | undefined>;
//# sourceMappingURL=securityPools.d.ts.map
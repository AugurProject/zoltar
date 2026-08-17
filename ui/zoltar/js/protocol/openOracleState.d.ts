import { type OpenOracleStatePreimage } from '@zoltar/shared/openOracle';
import type { Address } from '@zoltar/shared/ethereum';
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js';
export type OpenOracleEventState = {
    initial: OpenOracleStatePreimage;
    latest: OpenOracleStatePreimage;
    reportCount: bigint;
    settled: boolean;
};
export declare function loadOpenOracleEventStates(client: Pick<ReadClient, 'getBlock' | 'getLogs'>, openOracleAddress: Address, requestedReportIds?: ReadonlySet<bigint>): Promise<Map<bigint, OpenOracleEventState>>;
export declare function loadOpenOracleEventState(client: Pick<ReadClient, 'getBlock' | 'getLogs'>, openOracleAddress: Address, reportId: bigint): Promise<OpenOracleEventState>;
//# sourceMappingURL=openOracleState.d.ts.map
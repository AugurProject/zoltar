import type { OracleQueueOperation } from '@zoltar/ui-core-shared/types/contracts.js';
export declare const LIQUIDATION_OPERATION_TYPE = 0;
export declare const WITHDRAW_REP_OPERATION_TYPE = 1;
export declare function decodeOracleQueueOperation(operation: bigint | number): OracleQueueOperation;
export declare function encodeOracleQueueOperation(operation: OracleQueueOperation): number;
//# sourceMappingURL=oracleQueueOperation.d.ts.map
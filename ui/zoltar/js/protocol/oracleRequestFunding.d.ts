import type { OracleManagerDetails } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function resolveOracleOperationEthFunding({ managerDetails, priceUsable }: {
    managerDetails: OracleManagerDetails | undefined;
    priceUsable?: boolean | undefined;
}): {
    costAttoEth: any;
    includeBuffer: boolean;
} | undefined;
//# sourceMappingURL=oracleRequestFunding.d.ts.map
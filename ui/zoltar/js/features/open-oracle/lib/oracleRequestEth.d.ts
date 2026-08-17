import { resolveOracleOperationEthFunding } from '../../../protocol/oracleRequestFunding.js';
export { resolveOracleOperationEthFunding };
export declare function getOracleRequestEthGuardMessage({ actionLabel, includeBuffer, requiredCostAttoEth, walletBalanceAttoEth }: {
    actionLabel: string;
    includeBuffer?: boolean;
    requiredCostAttoEth: bigint | undefined;
    walletBalanceAttoEth: bigint | undefined;
}): string | undefined;
//# sourceMappingURL=oracleRequestEth.d.ts.map
import { type Address } from '@zoltar/shared/ethereum';
import type { WriteClient } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function depositRepToVaultToSecurityPool(client: WriteClient, securityPoolAddress: Address, amount: bigint, targetHealthFactorBps?: bigint): Promise<{
    action: "depositRepToVault";
    hash: `0x${string}`;
}>;
export declare function updateSecurityVaultFees(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address): Promise<{
    action: "updateVaultFees";
    hash: `0x${string}`;
}>;
export declare function redeemSecurityVaultFees(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address): Promise<{
    action: "redeemFees";
    hash: `0x${string}`;
}>;
export declare function redeemRepFromVaultFromSecurityPool(client: WriteClient, securityPoolAddress: Address, vaultAddress: Address): Promise<{
    action: "redeemRepFromVault";
    hash: `0x${string}`;
}>;
//# sourceMappingURL=securityVault.d.ts.map
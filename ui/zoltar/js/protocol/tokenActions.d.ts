import { type Address } from '@zoltar/shared/ethereum';
import type { OpenOracleActionResult, WriteClient, ZoltarForkActionResult } from '@zoltar/ui-core-shared/types/contracts.js';
export declare function approveErc20<Action extends OpenOracleActionResult['action'] | ZoltarForkActionResult['action']>(client: WriteClient, tokenAddress: Address, spenderAddress: Address, amount: bigint, action: Action): Promise<{
    action: Action;
    hash: `0x${string}`;
}>;
//# sourceMappingURL=tokenActions.d.ts.map
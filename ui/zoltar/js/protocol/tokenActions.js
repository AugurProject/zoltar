import { ABIS } from '@zoltar/ui-core-shared/abis.js';
import { writeContractAndWait } from './core.js';
export async function approveErc20(client, tokenAddress, spenderAddress, amount, action) {
    const hash = await writeContractAndWait(client, () => ({
        address: tokenAddress,
        abi: ABIS.mainnet.erc20,
        functionName: 'approve',
        args: [spenderAddress, amount],
    }));
    return { action, hash };
}
//# sourceMappingURL=tokenActions.js.map
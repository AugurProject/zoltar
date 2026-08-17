import type { TokenApprovalState } from '../lib/tokenApproval.js';
import type { ReadClient } from '../types/contracts.js';
export declare function useErc20BalanceLoader(loadErc20Balance: (client: ReadClient, tokenAddress: `0x${string}`, accountAddress: `0x${string}`) => Promise<bigint>): {
    invalidate: () => void;
    signal: import("@preact/signals-core").Signal<{
        error: string | undefined;
        loading: boolean;
        value: bigint | undefined;
    }>;
    reload: (tokenAddress: `0x${string}`, accountAddress: `0x${string}`) => Promise<void>;
};
export declare function useErc20AllowanceLoader(loadErc20Allowance: (client: ReadClient, tokenAddress: `0x${string}`, ownerAddress: `0x${string}`, spenderAddress: `0x${string}`) => Promise<bigint>): {
    invalidate: () => void;
    signal: import("@preact/signals-core").Signal<TokenApprovalState>;
    reload: (tokenAddress: `0x${string}`, ownerAddress: `0x${string}`, spenderAddress: `0x${string}`) => Promise<void>;
};
//# sourceMappingURL=useErc20Loader.d.ts.map
import type { Address } from '@zoltar/shared/ethereum';
export type ActiveWalletContext = {
    accountAddress: Address;
    chainId: string;
};
export declare function assertActiveWallet(accountAddress: Address): Promise<{
    accountAddress: `0x${string}`;
    chainId: string;
}>;
//# sourceMappingURL=assertActiveWallet.d.ts.map
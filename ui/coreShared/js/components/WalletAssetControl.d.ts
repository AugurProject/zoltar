import type { Address } from '@zoltar/shared/ethereum';
import { type WalletAssetWatchResult } from '../lib/walletAsset.js';
type WalletAssetControlProps = {
    accountAddress: Address | undefined;
    address: Address;
    isSupportedChain: boolean;
    onWatchAsset?: ((address: Address, accountAddress: Address, isCurrent: () => boolean) => Promise<WalletAssetWatchResult>) | undefined;
    tokenLabel: string;
};
export declare function WalletAssetControl({ accountAddress, address, isSupportedChain, onWatchAsset, tokenLabel }: WalletAssetControlProps): import("preact").JSX.Element;
export {};
//# sourceMappingURL=WalletAssetControl.d.ts.map
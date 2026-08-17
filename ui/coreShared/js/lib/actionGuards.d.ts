import type { Address } from '@zoltar/shared/ethereum';
import type { ActionAvailability } from '../types/components.js';
type WalletActiveAppChainGuardParameters = {
    accountAddress: Address | string | undefined;
    isOnActiveAppChain: boolean;
    walletRequiredReason?: string | undefined;
};
type WalletConnectionActiveAppChainGuardParameters = {
    isOnActiveAppChain: boolean;
    walletConnected: boolean;
    walletRequiredReason?: string | undefined;
};
type WalletActiveAppChainGuardState = {
    blocked: boolean;
    reason: string | undefined;
};
export declare function getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain, walletRequiredReason }: WalletActiveAppChainGuardParameters): WalletActiveAppChainGuardState;
export declare function getWalletActiveAppChainGuardMessage(parameters: WalletActiveAppChainGuardParameters): string | undefined;
export declare function getWalletConnectionActiveAppChainGuardState({ isOnActiveAppChain, walletConnected, walletRequiredReason }: WalletConnectionActiveAppChainGuardParameters): WalletActiveAppChainGuardState;
export declare function getWalletActiveAppChainActionAvailability({ accountAddress, isOnActiveAppChain, walletRequiredReason }: WalletActiveAppChainGuardParameters): ActionAvailability | undefined;
export {};
//# sourceMappingURL=actionGuards.d.ts.map
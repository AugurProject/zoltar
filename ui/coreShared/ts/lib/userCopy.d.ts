import type { Address } from '@zoltar/shared/ethereum';
import type { LoadableValueState } from './loadState.js';
export type UserMessageKey = 'not_checked' | 'loading' | 'not_found' | 'empty' | 'action_needed' | 'wrong_network' | 'wallet_disconnected' | 'unavailable' | 'load_failed';
type UserMessageTone = 'muted' | 'pending' | 'blocked' | 'error' | 'ok';
export type UserMessagePresentation = {
    actionHint?: string;
    badgeLabel?: string;
    badgeTone?: UserMessageTone;
    detail?: string;
    detailIsLoading?: boolean;
    key: UserMessageKey;
    placeholder?: string;
};
export declare function getMetricPlaceholderPresentation(value: unknown, options?: {
    loading?: boolean;
}): UserMessagePresentation | undefined;
export declare function getPoolRegistryPresentation(input: {
    hasLoaded: boolean;
    isLoading: boolean;
    mode: 'collection';
    poolCount: number;
} | {
    mode: 'selection';
    state: LoadableValueState;
}): UserMessagePresentation | undefined;
export declare function getUniversePresentation(state: LoadableValueState): UserMessagePresentation | undefined;
export declare function getWalletPresentation({ accountAddress, hasInjectedWallet, hasWallet, isOnActiveAppChain, isSupportedChain }: {
    accountAddress: Address | undefined;
    hasInjectedWallet?: boolean;
    hasWallet?: boolean;
    isOnActiveAppChain?: boolean;
    isSupportedChain?: boolean;
}): UserMessagePresentation | undefined;
export declare function getReportPresentation({ kind, state }: {
    kind: 'question' | 'report';
    state: LoadableValueState;
}): UserMessagePresentation | undefined;
export {};
//# sourceMappingURL=userCopy.d.ts.map
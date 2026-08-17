import { type Signal } from '@preact/signals';
export type LoadPhase = 'idle' | 'loading';
export type LoadableValueState = 'unknown' | 'loading' | 'ready' | 'missing';
type RunLoadOptions<TResult> = {
    isCurrent?: () => boolean;
    load: () => Promise<TResult>;
    onStart?: () => void;
    onSuccess?: (result: TResult) => Promise<void> | void;
    onError?: (error: unknown) => Promise<void> | void;
};
export type LoadController = {
    phase: Signal<LoadPhase>;
    isLoading: Signal<boolean>;
    invalidate(): void;
    run<TResult>(options: RunLoadOptions<TResult>): Promise<TResult | undefined>;
    track<TResult>(work: () => Promise<TResult>): Promise<TResult>;
};
type ResolveLoadableValueStateOptions<TValue> = {
    isLoading: boolean;
    isMissing: boolean;
    value: TValue | undefined;
};
export declare function resolveLoadableValueState<TValue>({ isLoading, isMissing, value }: ResolveLoadableValueStateOptions<TValue>): LoadableValueState;
type ResolveRequestedLoadableValueStateOptions<TValue, TKey> = {
    currentKey: TKey | undefined;
    isLoading: boolean;
    resolvedKey: TKey | undefined;
    value: TValue | undefined;
};
export declare function resolveRequestedLoadableValueState<TValue, TKey>({ currentKey, isLoading, resolvedKey, value }: ResolveRequestedLoadableValueStateOptions<TValue, TKey>): LoadableValueState;
export declare function createLoadController(): LoadController;
export {};
//# sourceMappingURL=loadState.d.ts.map
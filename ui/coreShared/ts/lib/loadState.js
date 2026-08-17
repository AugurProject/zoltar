import { signal } from '@preact/signals';
export function resolveLoadableValueState({ isLoading, isMissing, value }) {
    if (value !== undefined)
        return 'ready';
    if (isLoading)
        return 'loading';
    if (isMissing)
        return 'missing';
    return 'unknown';
}
export function resolveRequestedLoadableValueState({ currentKey, isLoading, resolvedKey, value }) {
    if (value !== undefined)
        return 'ready';
    if (isLoading)
        return 'loading';
    if (currentKey !== undefined && resolvedKey !== undefined && currentKey === resolvedKey)
        return 'missing';
    return 'unknown';
}
export function createLoadController() {
    const phase = signal('idle');
    const isLoading = signal(false);
    let generation = 0;
    let pendingCount = 0;
    const syncPhase = () => {
        const nextPhase = pendingCount > 0 ? 'loading' : 'idle';
        phase.value = nextPhase;
        isLoading.value = nextPhase === 'loading';
    };
    const track = async (work) => {
        const workGeneration = generation;
        pendingCount += 1;
        syncPhase();
        try {
            return await work();
        }
        finally {
            if (workGeneration === generation) {
                pendingCount = Math.max(0, pendingCount - 1);
                syncPhase();
            }
        }
    };
    const invalidate = () => {
        generation += 1;
        pendingCount = 0;
        syncPhase();
    };
    const run = async ({ isCurrent, load, onStart, onSuccess, onError }) => {
        const isCurrentRequest = isCurrent ?? (() => true);
        return await track(async () => {
            onStart?.();
            try {
                const result = await load();
                if (!isCurrentRequest())
                    return undefined;
                await onSuccess?.(result);
                return result;
            }
            catch (error) {
                if (!isCurrentRequest())
                    return undefined;
                await onError?.(error);
                return undefined;
            }
        });
    };
    return {
        invalidate,
        isLoading,
        phase,
        run,
        track,
    };
}
//# sourceMappingURL=loadState.js.map
import { useCallback, useEffect, useRef } from 'preact/hooks';
/**
 * Returns a function that, when called, marks a new request as current
 * and returns an `isCurrent` predicate. Use this to discard stale async results.
 *
 * const nextLoad = useRequestGuard()
 * const load = async () => {
 *   const isCurrent = nextLoad()
 *   const data = await fetch()
 *   if (!isCurrent()) return
 *   state.value = data
 * }
 */
export function useRequestGuard() {
    const requestId = useRef(0);
    useEffect(() => () => {
        requestId.current += 1;
    }, []);
    return useCallback(() => {
        const id = requestId.current + 1;
        requestId.current = id;
        return () => requestId.current === id;
    }, []);
}
//# sourceMappingURL=requestGuard.js.map
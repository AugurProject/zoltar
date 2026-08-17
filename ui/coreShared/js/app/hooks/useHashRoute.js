import { useSignal } from '@preact/signals';
import { useEffect } from 'preact/hooks';
import { buildRouteHref, ensureRouteHash, getCurrentRoute, getRouteHash, getTopLevelRouteSearch } from '../../lib/routing.js';
export function useHashRoute() {
    const route = useSignal(getCurrentRoute());
    const navigate = (nextRoute, preservedParameters = new Set()) => {
        window.location.hash = buildRouteHref(getRouteHash(nextRoute), getTopLevelRouteSearch(nextRoute, undefined, preservedParameters));
    };
    useEffect(() => {
        ensureRouteHash();
        route.value = getCurrentRoute();
        const onHashChange = () => {
            route.value = getCurrentRoute();
        };
        window.addEventListener('hashchange', onHashChange);
        return () => {
            window.removeEventListener('hashchange', onHashChange);
        };
    }, []);
    return {
        navigate,
        route: route.value,
    };
}
//# sourceMappingURL=useHashRoute.js.map
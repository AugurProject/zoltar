import { useRef } from 'preact/hooks';
import { createLoadController } from '../lib/loadState.js';
export function useLoadController() {
    const controllerRef = useRef(undefined);
    if (controllerRef.current === undefined)
        controllerRef.current = createLoadController();
    return controllerRef.current;
}
//# sourceMappingURL=useLoadController.js.map
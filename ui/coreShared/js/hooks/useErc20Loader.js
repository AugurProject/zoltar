import { useSignal } from '@preact/signals';
import { createConnectedReadClient } from '../lib/clients.js';
import { getErrorMessage, isRecoverableContractReadError } from '../lib/errors.js';
import { useRequestGuard } from '../lib/requestGuard.js';
function useErc20Loader(loadFn) {
    const signal = useSignal({ error: undefined, loading: false, value: undefined });
    const nextLoad = useRequestGuard();
    const invalidate = () => {
        void nextLoad();
    };
    const reload = async (...args) => {
        const isCurrent = nextLoad();
        signal.value = { ...signal.value, error: undefined, loading: true };
        try {
            const value = await loadFn(createConnectedReadClient(), ...args);
            if (!isCurrent())
                return;
            signal.value = { error: undefined, loading: false, value };
        }
        catch (error) {
            if (!isCurrent())
                return;
            if (!isRecoverableContractReadError(error)) {
                signal.value = { ...signal.value, loading: false };
                throw error;
            }
            signal.value = { error: getErrorMessage(error, 'Failed to load token balance'), loading: false, value: undefined };
        }
    };
    return { invalidate, signal, reload };
}
export function useErc20BalanceLoader(loadErc20Balance) {
    return useErc20Loader(loadErc20Balance);
}
export function useErc20AllowanceLoader(loadErc20Allowance) {
    const signal = useSignal({
        error: undefined,
        loading: false,
        value: undefined,
    });
    const nextLoad = useRequestGuard();
    const invalidate = () => {
        void nextLoad();
    };
    const reload = async (...args) => {
        const isCurrent = nextLoad();
        signal.value = {
            ...signal.value,
            error: undefined,
            loading: true,
        };
        try {
            const value = await loadErc20Allowance(createConnectedReadClient(), ...args);
            if (!isCurrent())
                return;
            signal.value = {
                error: undefined,
                loading: false,
                value,
            };
        }
        catch (error) {
            if (!isCurrent())
                return;
            signal.value = {
                error: getErrorMessage(error, 'Failed to load token approval'),
                loading: false,
                value: undefined,
            };
        }
    };
    return { invalidate, signal, reload };
}
//# sourceMappingURL=useErc20Loader.js.map
import { useSignal } from '@preact/signals';
import { useEffect, useId, useLayoutEffect, useRef } from 'preact/hooks';
import * as commonCopy from '../copy/common.js';
class ClipboardWriteError extends Error {
}
async function writeClipboardText(text) {
    const clipboard = navigator.clipboard;
    if (clipboard === undefined || typeof clipboard.writeText !== 'function')
        throw new ClipboardWriteError('Clipboard API is unavailable');
    try {
        await clipboard.writeText(text);
    }
    catch (error) {
        throw new ClipboardWriteError('Clipboard write failed', { cause: error });
    }
}
export function useCopyToClipboard(valueKey) {
    const copied = useSignal(false);
    const copyError = useSignal(undefined);
    const copyErrorId = useId();
    const copyRequestGeneration = useRef(0);
    const copyResetTimeout = useRef(undefined);
    const currentValueKey = useRef(valueKey);
    currentValueKey.current = valueKey;
    useLayoutEffect(() => {
        copyRequestGeneration.current += 1;
        copied.value = false;
        copyError.value = undefined;
        if (copyResetTimeout.current !== undefined) {
            window.clearTimeout(copyResetTimeout.current);
            copyResetTimeout.current = undefined;
        }
    }, [valueKey]);
    useEffect(() => () => {
        copyRequestGeneration.current += 1;
        if (copyResetTimeout.current !== undefined)
            window.clearTimeout(copyResetTimeout.current);
    }, []);
    const copyText = async (text) => {
        copyRequestGeneration.current += 1;
        const requestGeneration = copyRequestGeneration.current;
        const requestValueKey = valueKey;
        const isCurrentRequest = () => requestGeneration === copyRequestGeneration.current && requestValueKey === currentValueKey.current;
        copied.value = false;
        copyError.value = undefined;
        if (copyResetTimeout.current !== undefined) {
            window.clearTimeout(copyResetTimeout.current);
            copyResetTimeout.current = undefined;
        }
        try {
            await writeClipboardText(text);
        }
        catch (error) {
            if (!(error instanceof ClipboardWriteError))
                throw error;
            if (!isCurrentRequest())
                return;
            copied.value = false;
            copyError.value = commonCopy.copyFailed;
            if (copyResetTimeout.current !== undefined) {
                window.clearTimeout(copyResetTimeout.current);
                copyResetTimeout.current = undefined;
            }
            return;
        }
        if (!isCurrentRequest())
            return;
        copied.value = true;
        copyResetTimeout.current = window.setTimeout(() => {
            if (!isCurrentRequest())
                return;
            copied.value = false;
            copyResetTimeout.current = undefined;
        }, 1200);
    };
    return { copied, copyError, copyErrorId, copyText };
}
//# sourceMappingURL=useCopyToClipboard.js.map
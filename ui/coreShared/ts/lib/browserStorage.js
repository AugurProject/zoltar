export function getBrowserStorage(storageName) {
    if (typeof window === 'undefined')
        return undefined;
    try {
        return window[storageName];
    }
    catch (error) {
        if (!(error instanceof DOMException))
            throw error;
        return undefined;
    }
}
//# sourceMappingURL=browserStorage.js.map
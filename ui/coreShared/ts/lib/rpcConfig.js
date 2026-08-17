export const DEFAULT_RPC_URL = 'https://ethereum.dark.florist';
const RPC_URL_SEARCH_PARAM = 'rpcUrl';
const RPC_URL_STORAGE_KEY = 'zoltar.rpcUrl';
const LOCAL_HTTP_RPC_HOSTNAMES = new Set(['localhost', '::1', '[::1]']);
function resolveNonEmptyString(value) {
    if (typeof value !== 'string')
        return undefined;
    const normalizedValue = value.trim();
    return normalizedValue === '' ? undefined : normalizedValue;
}
function readLocationParams(location) {
    const params = new URLSearchParams(location?.search ?? '');
    const hash = location?.hash ?? '';
    const hashQueryIndex = hash.indexOf('?');
    if (hashQueryIndex === -1)
        return params;
    for (const [key, value] of new URLSearchParams(hash.slice(hashQueryIndex))) {
        params.set(key, value);
    }
    return params;
}
function readStoredRpcUrl(storage) {
    if (storage === undefined)
        return undefined;
    try {
        return storage.getItem(RPC_URL_STORAGE_KEY);
    }
    catch (error) {
        if (error instanceof Error)
            return undefined;
        return undefined;
    }
}
function getGlobalLocalStorage(globalWithRpcConfig) {
    try {
        return globalWithRpcConfig.localStorage;
    }
    catch (error) {
        if (!(error instanceof DOMException))
            throw error;
        return undefined;
    }
}
function parseIpv4Byte(value) {
    if (!/^\d{1,3}$/.test(value))
        return undefined;
    const byte = Number(value);
    if (!Number.isInteger(byte) || byte < 0 || byte > 255)
        return undefined;
    return byte;
}
function isIpv4LoopbackHostname(hostname) {
    const parts = hostname.split('.');
    if (parts.length !== 4)
        return false;
    const firstPart = parts[0];
    if (firstPart === undefined || parseIpv4Byte(firstPart) !== 127)
        return false;
    for (const part of parts.slice(1)) {
        if (parseIpv4Byte(part) === undefined)
            return false;
    }
    return true;
}
function isLocalHttpRpcHostname(hostname) {
    return LOCAL_HTTP_RPC_HOSTNAMES.has(hostname) || isIpv4LoopbackHostname(hostname);
}
function getRpcUrlValidationError(url) {
    let parsedUrl;
    try {
        parsedUrl = new URL(url);
    }
    catch (error) {
        if (error instanceof TypeError)
            return 'RPC URL must be an absolute https:// URL, or http:// for local loopback.';
        throw error;
    }
    if (parsedUrl.protocol === 'https:')
        return undefined;
    if (parsedUrl.protocol === 'http:' && isLocalHttpRpcHostname(parsedUrl.hostname))
        return undefined;
    if (parsedUrl.protocol === 'http:')
        return 'RPC URL must use https:// unless it points to local loopback.';
    return 'RPC URL must use https://, or http:// for local loopback.';
}
function resolveConfiguredRpcOverride(source, value, fallbackRpcUrl) {
    const url = resolveNonEmptyString(value);
    if (url === undefined)
        return undefined;
    const validationError = getRpcUrlValidationError(url);
    if (validationError === undefined)
        return { source, url };
    return {
        rejectedOverride: {
            reason: validationError,
            source,
            url,
        },
        source: 'default',
        url: fallbackRpcUrl,
    };
}
export function resolveConfiguredRpcConfig({ fallbackRpcUrl = DEFAULT_RPC_URL, location, overrideRpcUrl, storage } = {}) {
    const overrideConfig = resolveConfiguredRpcOverride('override', overrideRpcUrl, fallbackRpcUrl);
    if (overrideConfig !== undefined)
        return overrideConfig;
    const globalWithRpcConfig = globalThis;
    const urlConfig = resolveConfiguredRpcOverride('url', readLocationParams(location ?? globalWithRpcConfig.location).get(RPC_URL_SEARCH_PARAM), fallbackRpcUrl);
    if (urlConfig !== undefined)
        return urlConfig;
    const storedConfig = resolveConfiguredRpcOverride('localStorage', readStoredRpcUrl(storage ?? getGlobalLocalStorage(globalWithRpcConfig)), fallbackRpcUrl);
    if (storedConfig !== undefined)
        return storedConfig;
    const globalConfig = resolveConfiguredRpcOverride('global', globalWithRpcConfig.__ZOLTAR_RPC_URL__, fallbackRpcUrl);
    if (globalConfig !== undefined)
        return globalConfig;
    const environmentConfig = resolveConfiguredRpcOverride('environment', globalWithRpcConfig.process?.env?.['ZOLTAR_RPC_URL'], fallbackRpcUrl);
    if (environmentConfig !== undefined)
        return environmentConfig;
    return { source: 'default', url: fallbackRpcUrl };
}
export function resolveConfiguredRpcUrl(options = {}) {
    return resolveConfiguredRpcConfig(options).url;
}
//# sourceMappingURL=rpcConfig.js.map
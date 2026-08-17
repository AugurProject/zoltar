import { bigintToSafeNumber, getAddress } from '@zoltar/shared/ethereum';
import { ABIS } from '../abis.js';
import { getActiveBackend } from './activeEnvironment.js';
import { hasErrorCode } from './errors.js';
import { sameAddress } from './address.js';
import { sameChainId } from './chainId.js';
function normalizeTokenMetadata(metadata) {
    const symbol = metadata.symbol.trim();
    if (symbol === '' || symbol.length > 11)
        return undefined;
    if (!Number.isInteger(metadata.decimals) || metadata.decimals < 0 || metadata.decimals > 255)
        return undefined;
    return { decimals: metadata.decimals, symbol };
}
function getProviderErrorCode(error) {
    return hasErrorCode(error) ? String(error.code) : undefined;
}
function isUserDismissal(error) {
    return getProviderErrorCode(error) === '4001';
}
function isUnsupportedMethod(error) {
    const code = getProviderErrorCode(error);
    return code === '-32601' || code === '4200';
}
export function normalizeWalletAssetFailure(_reason) {
    return { status: 'failed' };
}
export async function requestWalletWatchAsset(address, dependencies) {
    let activeChainId;
    try {
        activeChainId = await dependencies.getActiveChainId();
    }
    catch (error) {
        return normalizeWalletAssetFailure(error);
    }
    if (!sameChainId(activeChainId, dependencies.expectedChainId))
        return { status: 'wrong-network' };
    let normalizedAddress;
    try {
        normalizedAddress = getAddress(address);
    }
    catch (error) {
        return normalizeWalletAssetFailure(error);
    }
    let metadata;
    try {
        metadata = await dependencies.readTokenMetadata(normalizedAddress);
    }
    catch (error) {
        return normalizeWalletAssetFailure(error);
    }
    const normalizedMetadata = normalizeTokenMetadata(metadata);
    if (normalizedMetadata === undefined)
        return { status: 'failed' };
    const request = {
        method: 'wallet_watchAsset',
        params: {
            options: {
                address: normalizedAddress,
                decimals: normalizedMetadata.decimals,
                symbol: normalizedMetadata.symbol,
            },
            type: 'ERC20',
        },
    };
    try {
        activeChainId = await dependencies.getActiveChainId();
    }
    catch (error) {
        return normalizeWalletAssetFailure(error);
    }
    if (!sameChainId(activeChainId, dependencies.expectedChainId))
        return { status: 'wrong-network' };
    if (!dependencies.isCurrent())
        return { status: 'stale' };
    let activeAccount;
    try {
        activeAccount = await dependencies.getActiveAccount();
    }
    catch (error) {
        return normalizeWalletAssetFailure(error);
    }
    if (!sameAddress(activeAccount, dependencies.expectedAccount) || !dependencies.isCurrent())
        return { status: 'stale' };
    try {
        activeChainId = await dependencies.getActiveChainId();
    }
    catch (error) {
        return normalizeWalletAssetFailure(error);
    }
    if (!sameChainId(activeChainId, dependencies.expectedChainId))
        return { status: 'wrong-network' };
    if (!dependencies.isCurrent())
        return { status: 'stale' };
    let result;
    try {
        result = await dependencies.request(request);
    }
    catch (error) {
        if (isUserDismissal(error))
            return { status: 'dismissed' };
        if (isUnsupportedMethod(error))
            return { status: 'unsupported' };
        return normalizeWalletAssetFailure(error);
    }
    if (result === true)
        return { status: 'accepted' };
    if (result === false)
        return { status: 'declined' };
    return { status: 'failed' };
}
async function readTokenMetadata(backend, address) {
    const client = backend.createReadClient();
    const [symbol, decimals] = await Promise.all([
        client.readContract({
            abi: ABIS.mainnet.erc20,
            address,
            functionName: 'symbol',
        }),
        client.readContract({
            abi: ABIS.mainnet.erc20,
            address,
            functionName: 'decimals',
        }),
    ]);
    return {
        decimals: bigintToSafeNumber(decimals, 'Token decimals'),
        symbol: String(symbol),
    };
}
export async function watchActiveWalletAsset(address, expectedAccount, isCurrent) {
    const backend = getActiveBackend();
    if (backend.id !== 'injected' || !backend.hasWallet())
        return { status: 'unavailable' };
    const provider = backend.getProvider();
    if (provider === undefined)
        return { status: 'unavailable' };
    return await requestWalletWatchAsset(address, {
        expectedChainId: backend.profile.chainIdHex,
        expectedAccount,
        getActiveAccount: async () => (await backend.getAccounts())[0],
        getActiveChainId: async () => await backend.getChainId(),
        isCurrent,
        readTokenMetadata: async (tokenAddress) => await readTokenMetadata(backend, tokenAddress),
        request: async (request) => await provider.request(request),
    });
}
//# sourceMappingURL=walletAsset.js.map
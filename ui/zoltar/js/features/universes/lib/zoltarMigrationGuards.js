import { getWalletActiveAppChainGuardState } from '@zoltar/ui-core-shared/lib/actionGuards.js';
export function getMigrationGuardMessage(accountAddress, isOnActiveAppChain, rootUniverse, loadingZoltarForkAccess, hasForked, loadingZoltarUniverse, notForkedAction) {
    const walletGuardState = getWalletActiveAppChainGuardState({ accountAddress, isOnActiveAppChain });
    if (walletGuardState.blocked)
        return walletGuardState.reason;
    if (rootUniverse === undefined)
        return loadingZoltarUniverse ? undefined : 'Refresh universe first.';
    if (loadingZoltarForkAccess)
        return undefined;
    if (!hasForked)
        return notForkedAction;
    return undefined;
}
//# sourceMappingURL=zoltarMigrationGuards.js.map
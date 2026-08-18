import { useEffect, useRef, useState } from 'preact/hooks';
import { normalizeAddress, sameAddress } from '@zoltar/ui-core-shared/lib/address.js';
import { isSelectedVaultOwnedByAccount as isSelectedVaultOwnedByAccountHelper } from '../lib/securityVault.js';
export function useSelectedVaultWorkflowState({ accountAddress, hasLoadedCurrentVault, initialVaultView, loadingSecurityVault, onLoadSecurityVault, onSecurityVaultFormChange, selectedPoolAddress, selectedVaultOwner, selectedVaultOwnerInput, selectedVaultSecurityPoolAddress, showSelectedPoolWorkflowDetails, view, }) {
    const [vaultView, setVaultView] = useState(initialVaultView ?? 'browse-vaults');
    const lastSelectedVaultAutoLoadKey = useRef(undefined);
    const selectedPoolVaultDefaultKey = `${normalizeAddress(selectedPoolAddress) ?? ''}:${normalizeAddress(accountAddress) ?? ''}`;
    const selectedVaultAutoLoadKey = `${normalizeAddress(selectedVaultOwner) ?? ''}:${normalizeAddress(selectedPoolAddress) ?? ''}`;
    useEffect(() => {
        const normalizedSelectedPoolAddress = normalizeAddress(selectedPoolAddress);
        if (normalizedSelectedPoolAddress === undefined)
            return;
        setVaultView('selected-vault');
        if (accountAddress === undefined)
            return;
        if (isSelectedVaultOwnedByAccountHelper(selectedVaultOwnerInput, accountAddress))
            return;
        onSecurityVaultFormChange({ selectedVaultOwner: accountAddress.toString() });
    }, [accountAddress, onSecurityVaultFormChange, selectedPoolAddress, selectedVaultOwnerInput, selectedPoolVaultDefaultKey]);
    useEffect(() => {
        if (!showSelectedPoolWorkflowDetails || view !== 'vaults')
            return;
        if (accountAddress === undefined)
            return;
        if (selectedPoolAddress === undefined || selectedVaultOwner === '')
            return;
        if (!sameAddress(selectedVaultSecurityPoolAddress, selectedPoolAddress))
            return;
        if (hasLoadedCurrentVault || loadingSecurityVault)
            return;
        if (lastSelectedVaultAutoLoadKey.current === selectedVaultAutoLoadKey)
            return;
        lastSelectedVaultAutoLoadKey.current = selectedVaultAutoLoadKey;
        void onLoadSecurityVault();
    }, [accountAddress, hasLoadedCurrentVault, loadingSecurityVault, onLoadSecurityVault, selectedPoolAddress, selectedVaultOwner, selectedVaultAutoLoadKey, selectedVaultSecurityPoolAddress, showSelectedPoolWorkflowDetails, view]);
    return {
        setVaultView,
        vaultView,
    };
}
//# sourceMappingURL=useSelectedVaultWorkflowState.js.map
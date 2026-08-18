import type { Address } from '@zoltar/shared/ethereum';
export type SelectedVaultView = 'browse-vaults' | 'selected-vault';
type UseSelectedVaultWorkflowStateParams = {
    accountAddress: Address | undefined;
    hasLoadedCurrentVault: boolean;
    initialVaultView: SelectedVaultView | undefined;
    loadingSecurityVault: boolean;
    onLoadSecurityVault: () => Promise<void> | void;
    onSecurityVaultFormChange: (partialForm: {
        selectedVaultOwner: string;
    }) => void;
    selectedPoolAddress: string | undefined;
    selectedVaultOwner: string;
    selectedVaultOwnerInput: string | undefined;
    selectedVaultSecurityPoolAddress: string;
    showSelectedPoolWorkflowDetails: boolean;
    view: string;
};
export declare function useSelectedVaultWorkflowState({ accountAddress, hasLoadedCurrentVault, initialVaultView, loadingSecurityVault, onLoadSecurityVault, onSecurityVaultFormChange, selectedPoolAddress, selectedVaultOwner, selectedVaultOwnerInput, selectedVaultSecurityPoolAddress, showSelectedPoolWorkflowDetails, view, }: UseSelectedVaultWorkflowStateParams): {
    setVaultView: import("preact/hooks").Dispatch<import("preact/hooks").StateUpdater<SelectedVaultView>>;
    vaultView: SelectedVaultView;
};
export {};
//# sourceMappingURL=useSelectedVaultWorkflowState.d.ts.map
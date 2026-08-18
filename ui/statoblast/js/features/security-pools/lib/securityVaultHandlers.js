export function createLoadSecurityVaultHandler(loadSecurityVault) {
    return (vaultAddress) => {
        void loadSecurityVault(vaultAddress);
    };
}
//# sourceMappingURL=securityVaultHandlers.js.map
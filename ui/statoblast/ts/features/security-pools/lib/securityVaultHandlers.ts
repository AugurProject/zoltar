export function createLoadSecurityVaultHandler(loadSecurityVault: (vaultAddress?: string) => Promise<void>) {
	return (vaultAddress?: string) => {
		void loadSecurityVault(vaultAddress)
	}
}

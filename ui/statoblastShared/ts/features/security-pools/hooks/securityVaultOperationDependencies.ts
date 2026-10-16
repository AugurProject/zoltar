import type { UseSecurityVaultOperationsDependencies } from './useSecurityVaultOperations.js'
import { createConnectedReadClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { loadSecurityVaultDetails } from '../../../protocol/securityPools.js'

export const defaultUseSecurityVaultOperationsDependencies: UseSecurityVaultOperationsDependencies = {
	loadSecurityVaultDetails: async (securityPoolAddress, vaultAddress) => await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress),
}

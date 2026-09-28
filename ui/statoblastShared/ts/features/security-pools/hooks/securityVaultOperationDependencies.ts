import type { UseSecurityVaultOperationsDependencies } from './useSecurityVaultOperations.js'
import { approveErc20 } from '@zoltar/ui-zoltar-shared/protocol/tokenActions.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { loadErc20Balance } from '@zoltar/ui-zoltar-shared/protocol/deployment.js'
import { loadCoordinatorInitialReportFundingRequirement, loadQueuedVaultOperationState, loadOracleManagerDetails, queueOracleManagerOperation } from '../../../protocol/oracleCoordinator.js'
import { isSecurityPoolVaultAdmissionClosed, loadSecurityVaultDetails } from '../../../protocol/securityPools.js'
import { certifyVaultCoverage, depositRepToVaultToSecurityPool, redeemRepFromVaultFromSecurityPool, redeemSecurityVaultFees, updateSecurityVaultFees } from '../../../protocol/securityVault.js'

export const defaultUseSecurityVaultOperationsDependencies: UseSecurityVaultOperationsDependencies = {
	approveErc20: async (client, tokenAddress, spenderAddress, amount, action) => await approveErc20(client, tokenAddress, spenderAddress, amount, action),
	createConnectedReadClient: () => createConnectedReadClient(),
	createWalletWriteClient,
	certifyVaultCoverage: async (client, pool, vault) => await certifyVaultCoverage(client, pool, vault),
	depositRepToVaultToSecurityPool: async (client, securityPoolAddress, amount, targetHealthFactorBps) => await depositRepToVaultToSecurityPool(client, securityPoolAddress, amount, targetHealthFactorBps),
	isSecurityPoolVaultAdmissionClosed: async securityPoolAddress => await isSecurityPoolVaultAdmissionClosed(createConnectedReadClient(), securityPoolAddress),
	loadCoordinatorInitialReportFundingRequirement,
	loadErc20Balance: async (tokenAddress, accountAddress) => await loadErc20Balance(createConnectedReadClient(), tokenAddress, accountAddress),
	loadQueuedVaultOperationState: async (managerAddress, result) => await loadQueuedVaultOperationState(createConnectedReadClient(), managerAddress, result),
	loadOracleManagerDetails: async managerAddress => await loadOracleManagerDetails(createConnectedReadClient(), managerAddress),
	loadSecurityVaultDetails: async (securityPoolAddress, vaultAddress) => await loadSecurityVaultDetails(createConnectedReadClient(), securityPoolAddress, vaultAddress),
	queueOracleManagerOperation,
	redeemRepFromVaultFromSecurityPool: async (client, securityPoolAddress, vaultAddress) => await redeemRepFromVaultFromSecurityPool(client, securityPoolAddress, vaultAddress),
	redeemSecurityVaultFees: async (client, securityPoolAddress, vaultAddress) => await redeemSecurityVaultFees(client, securityPoolAddress, vaultAddress),
	updateSecurityVaultFees: async (client, securityPoolAddress, vaultAddress) => await updateSecurityVaultFees(client, securityPoolAddress, vaultAddress),
}

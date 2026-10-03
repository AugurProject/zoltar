import type { Address } from '@zoltar/core-shared/evm/ethereum'
import type { VaultOperationsInput } from '@zoltar/statoblast-shared/statoblast/vaultOperations'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { ABIS } from '@zoltar/ui-core-shared/abis.js'
import { loadSecurityVaultDetails, loadSecurityPoolVaultSummary } from '../../../protocol/securityPools.js'
import { loadOracleManagerDetails, loadQueuedVaultOperationState, loadOracleManagerQueueOperationEthValue } from '../../../protocol/oracleCoordinator.js'
import { isSecurityPoolEscalationResolved, redeemSecurityVaultFees, redeemRepFromVaultFromSecurityPool } from '../../../protocol/securityVault.js'
import { hasPendingVaultCommitment, quoteVaultOperations, submitVaultOperations, type VaultOperationsResult } from '../../../protocol/vaultOperations.js'

export const vaultOperationsDependencies = {
	loadResolved: async (pool: Address) => await isSecurityPoolEscalationResolved(createConnectedReadClient(), pool),
	claim: async (owner: Address, pool: Address, action: 'fees' | 'redeem', callbacks: Parameters<typeof createWalletWriteClient>[1]): Promise<VaultOperationsResult> => {
		const client = createWalletWriteClient(owner, callbacks)
		const result = action === 'fees' ? await redeemSecurityVaultFees(client, pool, owner) : await redeemRepFromVaultFromSecurityPool(client, pool, owner)
		return { hash: result.hash, depositAttoRep: 0n, action } satisfies VaultOperationsResult
	},
	loadOwned: async (pool: Address, owner: Address) => await loadSecurityVaultDetails(createConnectedReadClient(), pool, owner),
	loadManager: async (manager: Address) => await loadOracleManagerDetails(createConnectedReadClient(), manager),
	loadBalance: async (token: Address, owner: Address) => await createConnectedReadClient().readContract({ address: token, abi: ABIS.mainnet.erc20, functionName: 'balanceOf', args: [owner] }),
	loadTarget: async (pool: Address, target: Address) => await loadSecurityPoolVaultSummary(createConnectedReadClient(), pool, target),
	loadStatus: async (manager: Address, result: VaultOperationsResult) => await loadQueuedVaultOperationState(createConnectedReadClient(), manager, result),
	loadCommitmentPending: async (manager: Address, owner: Address) => await hasPendingVaultCommitment(createConnectedReadClient(), manager, owner),
	quote: async (pool: Address, owner: Address, input: VaultOperationsInput, price: bigint) => await quoteVaultOperations(createConnectedReadClient(), pool, owner, input, price),
	queueCost: async (owner: Address, manager: Address) => await loadOracleManagerQueueOperationEthValue(createWalletWriteClient(owner), manager),
	submit: async (owner: Address, pool: Address, input: VaultOperationsInput, price: bigint, callbacks: Parameters<typeof createWalletWriteClient>[1]) => await submitVaultOperations(createWalletWriteClient(owner, callbacks), pool, input, price),
}

export type VaultOperationsDependencies = typeof vaultOperationsDependencies

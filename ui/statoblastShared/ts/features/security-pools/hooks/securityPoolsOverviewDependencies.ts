import type { TransactionCancellationParameters, TransactionLifecycleParameters, WriteOperationContext } from '../../../types/app.js'
import { readOperationClient, type ReadOperation } from '@zoltar/ui-core-shared/lib/readOperation.js'
import { createRegistryIndex } from '@zoltar/ui-core-shared/lib/incrementalRegistry.js'
import type { ChainBackend } from '@zoltar/ui-core-shared/wallet/chainBackend.js'
import type { SecurityPoolDeploymentTuple } from '../../../protocol/helpers.js'
import type { Address, Hash } from '@zoltar/core-shared/evm/ethereum'
import { loadLiquidationApproval as loadProtocolLiquidationApproval } from '../../../protocol/liquidationApprovals.js'
import { loadCoordinatorInitialReportFundingRequirement, loadOracleManagerDetails, loadOracleManagerQueueOperationEthValue, queueSecurityPoolLiquidation } from '../../../protocol/oracleCoordinator.js'
import { loadSecurityPoolLineage, loadSecurityPoolPage, loadSecurityPoolVaultSummary as loadProtocolSecurityPoolVaultSummary } from '../../../protocol/securityPools.js'
import { createConnectedReadClient, createWalletWriteClient } from '@zoltar/ui-core-shared/wallet/clients.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { LiquidationApprovalDetails, ListedSecurityPool, SecurityPoolPage, SecurityPoolVaultSummary } from '@zoltar/ui-core-shared/types/contracts.js'

export type UseSecurityPoolsOverviewParameters = TransactionLifecycleParameters &
	TransactionCancellationParameters &
	WriteOperationContext & {
		environmentRefreshKey: number
	}

/** The chain reads and writes the security-pools overview uses; tests replace them. */
type SecurityPoolsOverviewReadClient = {
	getBalance: (parameters: { address: Address }) => Promise<bigint>
}

export type SecurityPoolsOverviewProductionWriteClient = ReturnType<typeof createWalletWriteClient>
type SecurityPoolLiquidationQueueResult = Awaited<ReturnType<typeof queueSecurityPoolLiquidation>>

export type UseSecurityPoolsOverviewDependencies<TWriteClient = SecurityPoolsOverviewProductionWriteClient> = {
	createConnectedReadClient: () => SecurityPoolsOverviewReadClient
	createWalletWriteClient: (walletAddress: Address, callbacks?: Parameters<typeof createWalletWriteClient>[1]) => TWriteClient
	loadSecurityPoolLineage: (securityPoolAddress: Address, accountAddress?: Address, operation?: ReadOperation) => Promise<ListedSecurityPool[]>
	loadCoordinatorInitialReportFundingRequirement: (client: TWriteClient, managerAddress: Address, walletAddress: Address, proposedRepPerEthPrice?: bigint) => Promise<Awaited<ReturnType<typeof loadCoordinatorInitialReportFundingRequirement>>>
	loadLiquidationApproval: (managerAddress: Address, approvalId: Hash) => Promise<LiquidationApprovalDetails>
	loadSecurityPoolVaultSummary: (securityPoolAddress: Address, vaultAddress: Address) => Promise<SecurityPoolVaultSummary>
	loadOracleManagerDetails: (managerAddress: Address) => Promise<Awaited<ReturnType<typeof loadOracleManagerDetails>>>
	loadOracleManagerQueueOperationEthValue: (client: TWriteClient, managerAddress: Address) => Promise<bigint>
	loadSecurityPoolPage: (pageIndex: number, pageSize: number, accountAddress: Address | undefined, operation?: ReadOperation) => Promise<SecurityPoolPage>
	queueSecurityPoolLiquidation: (client: TWriteClient, managerAddress: Address, targetVault: Address, amount: bigint, validForSeconds: bigint, requestedInitialAttoWeth?: bigint, receiverVault?: Address, approvalId?: Hash, proposedRepPerEthPrice?: bigint) => Promise<SecurityPoolLiquidationQueueResult>
	waitForSecurityPoolReadBackend: () => Promise<void>
}

async function waitForSecurityPoolReadBackend() {
	await getActiveBackend().waitUntilReady?.()
}

const registryIndexes = new WeakMap<ChainBackend, ReturnType<typeof createRegistryIndex<SecurityPoolDeploymentTuple>>>()
function getRegistryIndex() {
	const backend = getActiveBackend()
	let index = registryIndexes.get(backend)
	if (index === undefined) {
		index = createRegistryIndex<SecurityPoolDeploymentTuple>()
		registryIndexes.set(backend, index)
	}
	return index
}

function createOperationClient(operation: ReadOperation | undefined) {
	const client = createConnectedReadClient()
	return operation === undefined ? client : readOperationClient(client, operation)
}

export const defaultUseSecurityPoolsOverviewDependencies: UseSecurityPoolsOverviewDependencies = {
	createConnectedReadClient: () => createConnectedReadClient(),
	createWalletWriteClient,
	loadSecurityPoolLineage: async (securityPoolAddress, accountAddress, operation) => await loadSecurityPoolLineage(createOperationClient(operation), securityPoolAddress, accountAddress, getRegistryIndex()),
	loadCoordinatorInitialReportFundingRequirement,
	loadLiquidationApproval: async (managerAddress, approvalId) => await loadProtocolLiquidationApproval(createConnectedReadClient(), managerAddress, approvalId),
	loadSecurityPoolVaultSummary: async (securityPoolAddress, vaultAddress) => await loadProtocolSecurityPoolVaultSummary(createConnectedReadClient(), securityPoolAddress, vaultAddress),
	loadOracleManagerDetails: async managerAddress => await loadOracleManagerDetails(createConnectedReadClient(), managerAddress),
	loadOracleManagerQueueOperationEthValue,
	loadSecurityPoolPage: async (pageIndex, pageSize, accountAddress, operation) => await loadSecurityPoolPage(createOperationClient(operation), pageIndex, pageSize, accountAddress),
	queueSecurityPoolLiquidation,
	waitForSecurityPoolReadBackend,
}

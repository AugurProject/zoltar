import type { Address, Hex } from '@zoltar/shared/ethereum'
import { statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '@zoltar/ui-core-shared/contractArtifact.js'
import type { LiquidationApprovalDetails, ReadClient, WriteClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { writeContractAndWait } from './core.js'

export type LiquidationApprovalParams = {
	securityPool: Address
	receiverVault: Address
	operator: Address
	targetVault: Address
	maxCumulativeDebtAttoEth: bigint
	maxDebtPerLiquidationAttoEth: bigint
	minPostLiquidationHealthFactorBps: bigint
	validAfter: bigint
	validUntil: bigint
	nonce: bigint
}

export async function loadLiquidationApprovalRegistry(client: ReadClient, managerAddress: Address) {
	return await client.readContract({
		address: managerAddress,
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'liquidationApprovalRegistry',
		args: [],
	})
}

export async function loadLiquidationApproval(client: ReadClient, managerAddress: Address, approvalId: Hex): Promise<LiquidationApprovalDetails> {
	const registryAddress = await loadLiquidationApprovalRegistry(client, managerAddress)
	const approval = await client.readContract({
		address: registryAddress,
		abi: statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
		functionName: 'getLiquidationApproval',
		args: [approvalId],
	})
	const minimumValidNonce = await client.readContract({
		address: registryAddress,
		abi: statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi,
		functionName: 'minimumLiquidationApprovalNonce',
		args: [approval.params.receiverVault],
	})
	return { registryAddress, ...approval, minimumValidNonce }
}

export async function setLiquidationApproval(client: WriteClient, registryAddress: Address, params: LiquidationApprovalParams) {
	return await writeContractAndWait(client, () => ({ address: registryAddress, abi: statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'setLiquidationApproval', args: [params] }))
}

export async function permitLiquidationApproval(client: WriteClient, registryAddress: Address, params: LiquidationApprovalParams, signature: Hex) {
	return await writeContractAndWait(client, () => ({ address: registryAddress, abi: statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'permitLiquidationApproval', args: [params, signature] }))
}

export async function revokeLiquidationApproval(client: WriteClient, registryAddress: Address, approvalId: Hex) {
	return await writeContractAndWait(client, () => ({ address: registryAddress, abi: statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'revokeLiquidationApproval', args: [approvalId] }))
}

export async function invalidateLiquidationApprovalNonce(client: WriteClient, registryAddress: Address, newNonce: bigint) {
	return await writeContractAndWait(client, () => ({ address: registryAddress, abi: statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry.abi, functionName: 'invalidateLiquidationApprovalNonce', args: [newNonce] }))
}

import type { Address, Hex } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_LiquidationApprovalRegistry_LiquidationApprovalRegistry, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '../contractArtifact.js'
import type { LiquidationApprovalDetails, ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'

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

async function loadLiquidationApprovalRegistry(client: ReadClient, managerAddress: Address) {
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

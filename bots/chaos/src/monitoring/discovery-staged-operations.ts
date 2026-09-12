import { escalationGameAbi } from '@zoltar/bot-shared/contracts/abi'
import { type VaultSnapshot } from '../operations/types.ts'

import { openOraclePriceCoordinatorAbi, liquidationApprovalRegistryAbi, securityPoolAbi } from '@zoltar/bot-shared/contracts/abi'
import { type PoolSnapshot, type StagedOperationSnapshot } from '../operations/types.ts'
import { type ChaosReadClient, DISCOVERY_RPC_CONCURRENCY, contractSimulationReverted, drainConcurrent, mapWithConcurrency, sameAddress } from './discovery-client.ts'
import { collectCountedPages } from './discovery-registry.ts'
import { type Address, type Hex, bigintToSafeNumber, encodeAbiParameters, getAddress, zeroAddress, zeroHash } from '@zoltar/bot-shared/ethereum'

const stagedRouteIneligibilityErrors = new WeakSet<Error>()

function stagedRouteIneligible(message: string) {
	const error = new Error(message)
	stagedRouteIneligibilityErrors.add(error)
	return error
}

function isStagedRouteIneligible(error: unknown) {
	return error instanceof Error && stagedRouteIneligibilityErrors.has(error)
}

export async function discoverVault(client: ChaosReadClient, pool: Address, escalationGame: Address, vault: Address, blockNumber: bigint): Promise<VaultSnapshot> {
	const [state, openInterest, badDebt] = await drainConcurrent([
		client.readContract({ abi: securityPoolAbi, address: pool, args: [vault], blockNumber, functionName: 'securityVaults' }),
		client.readContract({ abi: securityPoolAbi, address: pool, args: [vault], blockNumber, functionName: 'getVaultOpenInterestAttoEth' }),
		client.readContract({ abi: securityPoolAbi, address: pool, args: [vault], blockNumber, functionName: 'vaultBadDebtAttoEth' }),
	])
	const [repBackingUnits, capacityOwnershipAttoRep, claimableFeesAttoEth, feeIndex] = state
	const [repBackingAttoRep, disputeStakedAttoRep] = await drainConcurrent([
		client.readContract({ abi: securityPoolAbi, address: pool, args: [repBackingUnits], blockNumber, functionName: 'backingUnitsToAttoRep' }),
		escalationGame === zeroAddress ? Promise.resolve(0n) : client.readContract({ abi: escalationGameAbi, address: escalationGame, args: [vault], blockNumber, functionName: 'disputeStakedRepByVaultAttoRep' }),
	])
	return {
		address: vault,
		badDebtAttoEth: badDebt.toString(),
		capacityOwnershipAttoRep: capacityOwnershipAttoRep.toString(),
		claimableFeesAttoEth: claimableFeesAttoEth.toString(),
		feeIndex: feeIndex.toString(),
		disputeStakedAttoRep: disputeStakedAttoRep.toString(),
		openInterestAttoEth: openInterest.toString(),
		repBackingAttoRep: repBackingAttoRep.toString(),
		repBackingUnits: repBackingUnits.toString(),
	}
}

export async function discoverStagedOperations(client: ChaosReadClient, pool: PoolSnapshot, blockNumber: bigint, limit: number, warnings: string[]) {
	const count = await client.readContract({ abi: openOraclePriceCoordinatorAbi, address: pool.coordinator, blockNumber, functionName: 'getActiveStagedOperationCount' })
	if (count > BigInt(limit)) {
		warnings.push(`Staged-operation discovery truncated for ${pool.coordinator}: exact canonical total ${count.toString()} exceeds the configured ${limit.toString()}-entry resident limit`)
		return []
	}
	const pendingIds = await client.readContract({ abi: openOraclePriceCoordinatorAbi, address: pool.coordinator, blockNumber, functionName: 'getPendingSettlementOperationIds' })
	const collected = await collectCountedPages({
		count,
		label: `Staged-operation discovery for ${pool.coordinator}`,
		maximumItems: limit,
		pageSize: limit,
		readPage: async (start, pageCount) => {
			const [ids, operations] = await client.readContract({ abi: openOraclePriceCoordinatorAbi, address: pool.coordinator, args: [start, pageCount], blockNumber, functionName: 'getActiveStagedOperations' })
			if (ids.length !== operations.length) throw new Error(`Coordinator ${pool.coordinator} returned mismatched staged-operation arrays`)
			return ids.map((id, index) => {
				const operation = operations[index]
				if (operation === undefined) throw new Error(`Coordinator ${pool.coordinator} omitted staged operation ${id.toString()}`)
				return { id, operation }
			})
		},
		start: 0n,
	})
	const entries = collected.values
	if (entries.length === 0) return []
	const pending = new Set(pendingIds.map(id => id.toString()))
	let liquidationConfiguration: Promise<readonly [bigint, Address]> | undefined
	const getLiquidationConfiguration = () => {
		liquidationConfiguration ??= drainConcurrent([
			client.readContract({ abi: openOraclePriceCoordinatorAbi, address: pool.coordinator, blockNumber, functionName: 'minLiquidationPriceDistanceBps' }),
			client.readContract({ abi: openOraclePriceCoordinatorAbi, address: pool.coordinator, blockNumber, functionName: 'liquidationApprovalRegistry' }).then(getAddress),
		])
		return liquidationConfiguration
	}
	return await mapWithConcurrency(entries, DISCOVERY_RPC_CONCURRENCY, async ({ id, operation }): Promise<StagedOperationSnapshot> => {
		const operationType = bigintToSafeNumber(operation.operation)
		const targetVault = pool.vaults.find(vault => sameAddress(vault.address, operation.targetVault)) ?? (await discoverVault(client, pool.address, pool.escalationGame, getAddress(operation.targetVault), blockNumber))
		let executionExpectedSuccess = false
		let executionExpectedResult: Hex = '0x'
		let liquidationMinimumReceiverHealthFactorBps = 0n
		let liquidationMinPriceDistanceBps = 0n
		if (operationType === 0) {
			try {
				const [minLiquidationPriceDistanceBps, registry] = await getLiquidationConfiguration()
				const hasApproval = operation.liquidationApprovalId.toLowerCase() !== zeroHash
				let minimumReceiverHealthFactorBps = 10_000n
				if (hasApproval) {
					if (sameAddress(operation.receiverVault, operation.operator)) throw stagedRouteIneligible('Delegated liquidation receiver is its operator')
					const [registryCoordinator, reservation, approval] = await drainConcurrent([
						client.readContract({ abi: liquidationApprovalRegistryAbi, address: registry, blockNumber, functionName: 'coordinator' }).then(getAddress),
						client.readContract({ abi: liquidationApprovalRegistryAbi, address: registry, args: [id], blockNumber, functionName: 'liquidationReservations' }),
						client.readContract({ abi: liquidationApprovalRegistryAbi, address: registry, args: [operation.liquidationApprovalId], blockNumber, functionName: 'getLiquidationApproval' }),
					])
					if (!sameAddress(registryCoordinator, pool.coordinator)) throw stagedRouteIneligible('Liquidation registry coordinator does not match the staged coordinator')
					if (reservation.approvalId.toLowerCase() !== operation.liquidationApprovalId.toLowerCase()) throw stagedRouteIneligible('Liquidation reservation approval does not match the staged route')
					if (reservation.reservedDebtAttoEth !== operation.reservedLiquidationDebtAttoEth || reservation.reservedDebtAttoEth === 0n) throw stagedRouteIneligible('Liquidation reservation amount does not match the staged route')
					if (reservation.settled) throw stagedRouteIneligible('Liquidation reservation is already settled')
					const params = approval.params
					if (!sameAddress(params.securityPool, pool.address) || !sameAddress(params.receiverVault, operation.receiverVault) || !sameAddress(params.operator, operation.operator)) {
						throw stagedRouteIneligible('Liquidation approval roles do not match the staged route')
					}
					if (params.targetVault !== zeroAddress && !sameAddress(params.targetVault, operation.targetVault)) throw stagedRouteIneligible('Liquidation approval target does not match the staged route')
					if (params.minPostLiquidationHealthFactorBps < 10_000n) throw stagedRouteIneligible('Liquidation approval health factor is below the protocol minimum')
					if (approval.reservedDebtAttoEth < reservation.reservedDebtAttoEth) throw stagedRouteIneligible('Liquidation approval aggregate reservation is below the operation reservation')
					minimumReceiverHealthFactorBps = params.minPostLiquidationHealthFactorBps
				} else {
					if (operation.reservedLiquidationDebtAttoEth !== 0n) throw stagedRouteIneligible('Direct liquidation has a delegated reservation')
					if (!sameAddress(operation.receiverVault, operation.operator)) throw stagedRouteIneligible('Direct liquidation receiver is not its operator')
				}
				if (sameAddress(operation.receiverVault, operation.targetVault)) throw stagedRouteIneligible('Liquidation receiver is its target')
				liquidationMinimumReceiverHealthFactorBps = minimumReceiverHealthFactorBps
				liquidationMinPriceDistanceBps = minLiquidationPriceDistanceBps
				const simulation = await client.simulateContract({
					account: pool.coordinator,
					abi: securityPoolAbi,
					address: pool.address,
					args: [
						{
							minLiquidationPriceDistanceBps,
							minimumReceiverHealthFactorBps,
							operationId: id,
							operator: operation.operator,
							receiverVault: operation.receiverVault,
							requestedDebtAttoEth: hasApproval ? operation.reservedLiquidationDebtAttoEth : operation.operationAmountAttoRepOrAttoEth,
							snapshot: {
								targetBackingUnits: operation.snapshotTargetBackingUnits,
								targetCapacityOwnershipAttoRep: operation.snapshotTargetCapacityOwnershipAttoRep,
							},
							targetVault: operation.targetVault,
						},
					],
					blockNumber,
					functionName: 'performLiquidation',
				})
				executionExpectedResult = encodeAbiParameters([{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }], simulation.result)
				executionExpectedSuccess = true
			} catch (error) {
				if (!isStagedRouteIneligible(error) && !contractSimulationReverted(error)) throw error
				// The exact liquidation snapshot, registry reservation, or current
				// accounting no longer satisfies the pool. Execution must fail closed.
			}
		} else if (operationType === 1) {
			try {
				if (!sameAddress(operation.operator, operation.receiverVault) || !sameAddress(operation.operator, operation.targetVault)) throw stagedRouteIneligible('Staged withdrawal is not an exact self route')
				if (operation.liquidationApprovalId.toLowerCase() !== zeroHash || operation.reservedLiquidationDebtAttoEth !== 0n) throw stagedRouteIneligible('Staged withdrawal carries liquidation approval state')
				await client.simulateContract({
					account: pool.coordinator,
					abi: securityPoolAbi,
					address: pool.address,
					args: [operation.operator, operation.operationAmountAttoRepOrAttoEth],
					blockNumber,
					functionName: 'withdrawRepFromVault',
				})
				executionExpectedSuccess = true
			} catch (error) {
				if (!isStagedRouteIneligible(error) && !contractSimulationReverted(error)) throw error
				// The coordinator catches downstream reverts and emits success=false. A
				// direct anchored simulation is therefore required before execution.
			}
		}
		return {
			amount: operation.operationAmountAttoRepOrAttoEth.toString(),
			coordinator: pool.coordinator,
			executionExpectedResult,
			executionExpectedSuccess,
			id: id.toString(),
			isPendingSettlement: pending.has(id.toString()),
			liquidationApprovalId: operation.liquidationApprovalId,
			liquidationMinimumReceiverHealthFactorBps: liquidationMinimumReceiverHealthFactorBps.toString(),
			liquidationMinPriceDistanceBps: liquidationMinPriceDistanceBps.toString(),
			operation: operationType,
			operator: getAddress(operation.operator),
			queuedAt: operation.queuedAt.toString(),
			receiverVault: getAddress(operation.receiverVault),
			reservedLiquidationDebtAttoEth: operation.reservedLiquidationDebtAttoEth.toString(),
			snapshotTargetBackingUnits: operation.snapshotTargetBackingUnits.toString(),
			snapshotTargetCapacityOwnershipAttoRep: operation.snapshotTargetCapacityOwnershipAttoRep.toString(),
			snapshotTargetDisputeStakedAttoRep: targetVault.disputeStakedAttoRep,
			snapshotTargetOpenInterestAttoEth: targetVault.openInterestAttoEth,
			snapshotTotalPoolHeldAttoRep: pool.totalPoolHeldAttoRep,
			snapshotTotalRepBackingUnits: pool.totalRepBackingUnits,
			targetVault: getAddress(operation.targetVault),
			validForSeconds: operation.validForSeconds.toString(),
		}
	})
}

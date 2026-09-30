import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import { type WriteContractClient, writeContractAndWaitForReceipt } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator, statoblast_SecurityPool_SecurityPool } from '../contractArtifact.js'
import * as securityPoolCopy from '../copy/securityPool.js'
import { getOracleManagerPriceValidUntilTimestamp, hasOracleMintSubmissionWindow } from './oracleTiming.js'

export async function writeStagedOperationAndWaitForReceipt(client: WriteContractClient & Partial<Pick<ReadClient, 'readContract' | 'getBlock'>>, managerAddress: Address, operationId: bigint) {
	const callParams = {
		address: managerAddress,
		abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi,
		functionName: 'executeStagedOperation',
		args: [operationId],
		gas: 5_000_000n,
	}
	client.onTransactionPlan?.([
		{
			...callParams,
			contractAddress: managerAddress,
			validateBeforeSubmit: async () => {
				const { readContract, getBlock } = client
				if (readContract === undefined || getBlock === undefined) throw new Error('Staged operation execution requires a readable wallet client.')
				const operation = await readContract({ address: managerAddress, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'stagedOperations', args: [operationId] })
				if (operation.operator === zeroAddress) throw new Error('This staged operation is no longer available. Refresh its state.')
				const [settlementTime, priceValid, lastSettlementTimestamp, pool] = await Promise.all([
					readContract({ address: managerAddress, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'settlementTime' }),
					readContract({ address: managerAddress, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'isPriceValid' }),
					readContract({ address: managerAddress, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'lastSettlementTimestamp' }),
					readContract({ address: managerAddress, abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, functionName: 'securityPool' }),
				])
				if (!priceValid) throw new Error('A valid oracle price is required to execute this operation.')
				const [backingUnits, underwritingLimit] = await readContract({ address: pool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'securityVaults', args: [operation.operation === 0n ? operation.targetVault : operation.operator] })
				if (operation.operation === 0n && (backingUnits !== operation.snapshotTargetBackingUnits || underwritingLimit !== operation.snapshotTargetUnderwritingLimitAttoEth)) throw new Error('The liquidation target changed. Review a new liquidation instead.')
				if (operation.operation === 1n) {
					const minimum = await readContract({ address: pool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'minimumVaultRepDepositAttoRep' })
					const [withdrawUnits, minimumUnits] = await Promise.all([
						readContract({ address: pool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'attoRepToBackingUnits', args: [operation.operationValue] }),
						readContract({ address: pool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'attoRepToBackingUnits', args: [minimum] }),
					])
					const actualUnits = withdrawUnits + minimumUnits > backingUnits ? backingUnits : withdrawUnits
					const amount = await readContract({ address: pool, abi: statoblast_SecurityPool_SecurityPool.abi, functionName: 'backingUnitsToAttoRep', args: [actualUnits] })
					if (operation.operationValue === 0n || amount === 0n) throw new Error('This staged withdrawal no longer has any REP to withdraw.')
				}
				const block = await getBlock()
				if (block.timestamp > operation.queuedAt + settlementTime + operation.validForSeconds) throw new Error('This staged operation has expired. Review a new operation.')
				if (hasOracleMintSubmissionWindow(block.timestamp, getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp)) !== true) throw new Error(securityPoolCopy.oracleOperationPriceExpiresTooSoon)
			},
		},
	])
	return await writeContractAndWaitForReceipt(client, () => callParams)
}

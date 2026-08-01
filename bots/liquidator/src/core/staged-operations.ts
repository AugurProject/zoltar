import type { Address } from '@zoltar/bot-shared/ethereum'
import type { StagedOperationObservation } from '#state/operator-state'

export function hasStagedLiquidation(operations: readonly StagedOperationObservation[], initiator: Address, target: Address) {
	return operations.some(operation => operation.operation === 0n && operation.initiatorVault.toLowerCase() === initiator.toLowerCase() && operation.targetVault.toLowerCase() === target.toLowerCase())
}

import type { OracleManagerDetails } from '../../../types/contracts.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { getOracleOperationTimingGuard } from '../../open-oracle/lib/oracleRequestEth.js'

export function needsOracleInitialPrice(manager: OracleManagerDetails | undefined, priceUsable: boolean) {
	return !priceUsable && manager?.pendingReportId === 0n && manager.pendingSettlementOperationIds.length === 0
}

export function getOracleOperationExecutionMessage(manager: OracleManagerDetails | undefined, priceUsable: boolean, replacementVault?: string) {
	if (manager === undefined) return securityPoolCopy.oracleOperationExecutionLoading
	if (priceUsable) return securityPoolCopy.oracleOperationExecutesImmediately
	const knownOperations = [...(manager.stagedOperations ?? []), ...(manager.pendingOperation === undefined ? [] : [manager.pendingOperation])]
	const replacesPendingTarget = replacementVault !== undefined && knownOperations.some(operation => operation.operation === 'setVaultUnderwritingLimit' && sameAddress(operation.targetVault, replacementVault) && manager.pendingSettlementOperationIds.includes(operation.operationId))
	if (!replacesPendingTarget && BigInt(manager.pendingSettlementOperationIds.length) >= manager.pendingSettlementQueueCapacity) return securityPoolCopy.oracleOperationMayNeedManualExecution
	return securityPoolCopy.oracleOperationQueuesForSettlement
}

/** The oracle timing guard, with the time left on a price that expires too soon for a transaction to confirm. */
export function getOracleOperationTimingReason(manager: OracleManagerDetails | undefined, currentTimestamp: bigint | undefined, priceUsable: boolean) {
	const reason = getOracleOperationTimingGuard(manager, currentTimestamp, priceUsable)
	if (reason !== securityPoolCopy.oracleOperationPriceExpiresTooSoon || currentTimestamp === undefined) return reason
	const priceValidUntilTimestamp = manager?.priceValidUntilTimestamp
	if (priceValidUntilTimestamp === undefined || priceValidUntilTimestamp <= currentTimestamp) return reason
	return securityPoolCopy.formatOracleOperationPriceExpiresTooSoon(priceValidUntilTimestamp - currentTimestamp)
}

import type { OracleManagerDetails } from '../../../types/contracts.js'
import * as securityPoolCopy from '../../../copy/securityPool.js'
import { getOracleOperationTimingGuard } from '../../open-oracle/lib/oracleRequestEth.js'

export function needsOracleInitialPrice(manager: OracleManagerDetails | undefined, priceUsable: boolean) {
	return !priceUsable && manager?.pendingReportId === 0n && manager.pendingSettlementOperationIds.length === 0
}

/** The oracle timing guard, with the time left on a price that expires too soon for a transaction to confirm. */
export function getOracleOperationTimingReason(manager: OracleManagerDetails | undefined, currentTimestamp: bigint | undefined, priceUsable: boolean) {
	const reason = getOracleOperationTimingGuard(manager, currentTimestamp, priceUsable)
	if (reason !== securityPoolCopy.oracleOperationPriceExpiresTooSoon || currentTimestamp === undefined) return reason
	const priceValidUntilTimestamp = manager?.priceValidUntilTimestamp
	if (priceValidUntilTimestamp === undefined || priceValidUntilTimestamp <= currentTimestamp) return reason
	return securityPoolCopy.formatOracleOperationPriceExpiresTooSoon(priceValidUntilTimestamp - currentTimestamp)
}

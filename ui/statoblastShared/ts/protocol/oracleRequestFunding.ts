import { hasOraclePriceSubmissionWindow, supportsOraclePriceRenewal } from './oracleTiming.js'
import * as securityPoolCopy from '../copy/securityPool.js'
import type { OracleManagerDetails } from '../types/contracts.js'

export function resolveOracleOperationEthFunding({ managerDetails, priceUsable }: { managerDetails: OracleManagerDetails | undefined; priceUsable?: boolean | undefined }) {
	if (managerDetails === undefined) return undefined
	if (priceUsable ?? managerDetails.isPriceValid) {
		return {
			costAttoEth: 0n,
			includeBuffer: false,
		}
	}
	if (supportsOraclePriceRenewal(managerDetails)) return { costAttoEth: managerDetails.requestPriceCostAttoEth, includeBuffer: true }
	const pendingSettlementQueueCapacity = managerDetails.pendingSettlementQueueCapacity
	if (managerDetails.pendingReportId !== 0n && pendingSettlementQueueCapacity > 0n && BigInt(managerDetails.pendingSettlementOperationIds.length) < pendingSettlementQueueCapacity) {
		return {
			costAttoEth: 0n,
			includeBuffer: false,
		}
	}
	if (managerDetails.pendingReportId === 0n && managerDetails.pendingSettlementOperationIds.length === 0) {
		return {
			costAttoEth: managerDetails.requestPriceCostAttoEth,
			includeBuffer: true,
		}
	}
	return {
		costAttoEth: 0n,
		includeBuffer: false,
	}
}

// Only the free, fresh-price route depends on this price surviving inclusion.
export function getOracleOperationTimingGuard(managerDetails: OracleManagerDetails | undefined, currentTimestamp: bigint | undefined, priceUsable?: boolean) {
	if (managerDetails === undefined) return undefined
	if (!supportsOraclePriceRenewal(managerDetails) && !(priceUsable ?? managerDetails.isPriceValid) && managerDetails.pendingReportId !== 0n && managerDetails.pendingReportCoordinator !== undefined && managerDetails.pendingReportCoordinator.toLowerCase() !== managerDetails.managerAddress.toLowerCase())
		return securityPoolCopy.sharedPoolPricePending
	if ((priceUsable ?? managerDetails.isPriceValid) !== true) return undefined
	const hasWindow = hasOraclePriceSubmissionWindow(currentTimestamp, managerDetails.priceValidUntilTimestamp)
	if (hasWindow === undefined) return securityPoolCopy.oracleOperationTimingUnavailable
	if (hasWindow === false) return securityPoolCopy.oracleOperationPriceExpiresTooSoon
	return undefined
}

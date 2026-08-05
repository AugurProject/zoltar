import type { OracleManagerDetails } from '../types/contracts.js'

export function resolveOracleOperationEthFunding({ managerDetails, priceUsable }: { managerDetails: OracleManagerDetails | undefined; priceUsable?: boolean | undefined }) {
	if (managerDetails === undefined) return undefined
	if (priceUsable ?? managerDetails.isPriceValid) {
		return {
			costAttoEth: 0n,
			includeBuffer: false,
		}
	}
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

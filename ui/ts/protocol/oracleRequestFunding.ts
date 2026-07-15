import type { OracleManagerDetails } from '../types/contracts.js'

export function resolveOracleOperationEthFunding({ managerDetails }: { managerDetails: OracleManagerDetails | undefined }) {
	if (managerDetails === undefined) return undefined
	if (managerDetails.isPriceValid) {
		return {
			ethCost: 0n,
			includeBuffer: false,
		}
	}
	const pendingSettlementQueueCapacity = managerDetails.pendingSettlementQueueCapacity
	if (managerDetails.pendingReportId !== 0n && pendingSettlementQueueCapacity > 0n && BigInt(managerDetails.pendingSettlementOperationIds.length) < pendingSettlementQueueCapacity) {
		return {
			ethCost: 0n,
			includeBuffer: false,
		}
	}
	if (managerDetails.pendingReportId === 0n && managerDetails.pendingSettlementOperationIds.length === 0) {
		return {
			ethCost: managerDetails.requestPriceEthCost,
			includeBuffer: true,
		}
	}
	return {
		ethCost: 0n,
		includeBuffer: false,
	}
}

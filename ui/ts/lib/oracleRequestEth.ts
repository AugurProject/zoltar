import type { OracleManagerDetails } from '../types/contracts.js'
import { formatCurrencyBalance } from './formatters.js'
import { addOpenOracleBountyBuffer } from './openOracle.js'

function getBufferedOracleRequestEthValue(requestPriceEthCost: bigint | undefined) {
	if (requestPriceEthCost === undefined) return undefined
	return addOpenOracleBountyBuffer(requestPriceEthCost)
}

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

export function getOracleRequestEthGuardMessage({ actionLabel, includeBuffer = false, requiredEthCost, walletEthBalance }: { actionLabel: string; includeBuffer?: boolean; requiredEthCost: bigint | undefined; walletEthBalance: bigint | undefined }) {
	const requiredEthValue = includeBuffer ? getBufferedOracleRequestEthValue(requiredEthCost) : requiredEthCost
	if (requiredEthValue === undefined) return undefined
	if (requiredEthValue === 0n) return undefined
	if (walletEthBalance === undefined) return 'Loading wallet ETH balance.'
	if (walletEthBalance >= requiredEthValue) return undefined
	return `Need ${formatCurrencyBalance(requiredEthValue - walletEthBalance)} more ETH in this wallet to ${actionLabel}.`
}

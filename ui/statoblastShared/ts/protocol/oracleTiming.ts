import { hasSubmissionWindow } from '@zoltar/ui-core-shared/transactions/submissionTiming.js'
import { getRuntimeNetworkProfile, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

/** How long a settled pool price stays valid: 1 hour on Sepolia, 5 minutes elsewhere. */
export function getOraclePriceValidityWindowSeconds(chainId = getRuntimeNetworkProfile().chain.id) {
	return (chainId === SEPOLIA_NETWORK_PROFILE.chain.id ? 60n : 5n) * 60n
}

export function getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp: bigint | undefined, chainId = getRuntimeNetworkProfile().chain.id) {
	if (lastSettlementTimestamp === undefined || lastSettlementTimestamp === 0n) return undefined
	return lastSettlementTimestamp + getOraclePriceValidityWindowSeconds(chainId)
}

export function hasOraclePriceSubmissionWindow(currentTimestamp: bigint | undefined, priceValidUntilTimestamp: bigint | undefined) {
	if (currentTimestamp === undefined || priceValidUntilTimestamp === undefined) return undefined
	return hasSubmissionWindow(currentTimestamp, priceValidUntilTimestamp)
}

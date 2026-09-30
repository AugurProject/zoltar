import { hasSubmissionWindow } from '@zoltar/ui-core-shared/transactions/submissionTiming.js'
import { getRuntimeNetworkProfile, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

export function getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp: bigint | undefined, chainId = getRuntimeNetworkProfile().chain.id) {
	if (lastSettlementTimestamp === undefined || lastSettlementTimestamp === 0n) return undefined
	return lastSettlementTimestamp + (chainId === SEPOLIA_NETWORK_PROFILE.chain.id ? 60n : 5n) * 60n
}

export function hasOracleMintSubmissionWindow(currentTimestamp: bigint | undefined, priceValidUntilTimestamp: bigint | undefined) {
	if (currentTimestamp === undefined || priceValidUntilTimestamp === undefined) return undefined
	return hasSubmissionWindow(currentTimestamp, priceValidUntilTimestamp)
}

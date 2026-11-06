import { getRuntimeNetworkProfile, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

/** Standalone coordinator validity; shared portfolio feeds expose their own canonical expiry. */
function getOraclePriceValidityWindowSeconds(chainId = getRuntimeNetworkProfile().chain.id) {
	return (chainId === SEPOLIA_NETWORK_PROFILE.chain.id ? 60n : 5n) * 60n
}

export function getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp: bigint | undefined, chainId = getRuntimeNetworkProfile().chain.id) {
	if (lastSettlementTimestamp === undefined || lastSettlementTimestamp === 0n) return undefined
	return lastSettlementTimestamp + getOraclePriceValidityWindowSeconds(chainId)
}

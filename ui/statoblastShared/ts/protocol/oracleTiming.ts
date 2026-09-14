import { getRuntimeNetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

export function getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp: bigint | undefined) {
	if (lastSettlementTimestamp === undefined || lastSettlementTimestamp === 0n) return undefined
	return lastSettlementTimestamp + (getRuntimeNetworkProfile().id === 'sepolia' ? 60n : 5n) * 60n
}

import { getRuntimeNetworkProfile } from '@zoltar/ui-core-shared/wallet/networkProfile.js'

export function getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp: bigint | undefined) {
	if (lastSettlementTimestamp === undefined || lastSettlementTimestamp === 0n) return undefined
	return lastSettlementTimestamp + (getRuntimeNetworkProfile().id === 'sepolia' ? 60n : 5n) * 60n
}

// Reserve a minute for wallet confirmation and inclusion; this is a bounded UI policy.
const ORACLE_MINT_SUBMISSION_WINDOW_SECONDS = 60n

export function hasOracleMintSubmissionWindow(currentTimestamp: bigint | undefined, priceValidUntilTimestamp: bigint | undefined) {
	if (currentTimestamp === undefined || priceValidUntilTimestamp === undefined) return undefined
	return priceValidUntilTimestamp > currentTimestamp + ORACLE_MINT_SUBMISSION_WINDOW_SECONDS
}

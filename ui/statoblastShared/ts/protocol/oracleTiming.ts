import { hasSubmissionWindow } from '@zoltar/ui-core-shared/transactions/submissionTiming.js'
import { getRuntimeNetworkProfile, SEPOLIA_NETWORK_PROFILE } from '@zoltar/ui-core-shared/wallet/networkProfile.js'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { OracleManagerDetails } from '../types/contracts.js'

export function supportsOraclePriceRenewal(manager: Pick<OracleManagerDetails, 'managerAddress' | 'priceFeedAddress'> | undefined) {
	return manager?.priceFeedAddress !== undefined && !sameAddress(manager.priceFeedAddress, manager.managerAddress)
}

/** Standalone coordinator validity; shared portfolio feeds expose their own canonical expiry. */
function getOraclePriceValidityWindowSeconds(chainId = getRuntimeNetworkProfile().chain.id) {
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

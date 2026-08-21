export const ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS = 5n * 60n

export function getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp: bigint | undefined) {
	if (lastSettlementTimestamp === undefined || lastSettlementTimestamp === 0n) return undefined
	return lastSettlementTimestamp + ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS
}

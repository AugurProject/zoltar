export const ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS = 5n * 60n;
export function getOracleManagerPriceValidUntilTimestamp(lastSettlementTimestamp) {
    if (lastSettlementTimestamp === undefined || lastSettlementTimestamp === 0n)
        return undefined;
    return lastSettlementTimestamp + ORACLE_MANAGER_PRICE_VALID_FOR_SECONDS;
}
//# sourceMappingURL=oracleTiming.js.map
// Optional OpenOracle report flags that the repository's own consumers never set; tests use them to exercise contract paths.
export const OPEN_ORACLE_FLAG_STORE_SETTLEMENT_ELIGIBILITY = 1n << 4n
export const OPEN_ORACLE_FLAG_FEES_ONLY_AT_HALT = 1n << 5n
export const OPEN_ORACLE_FLAG_FLEXIBLE_ESCALATION = 1n << 6n

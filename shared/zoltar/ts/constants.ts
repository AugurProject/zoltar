// ReputationToken inherits ERC20 slots 0-4; totalTheoreticalSupplyAttoRep is slot 5.
export const REPUTATION_TOKEN_THEORETICAL_SUPPLY_SLOT = 5n

/** Mirrors Constants.MAX_ATTO_REP, the protocol's genesis theoretical supply ceiling. */
export const MAX_ATTO_REP = 11_000_000n * 10n ** 18n

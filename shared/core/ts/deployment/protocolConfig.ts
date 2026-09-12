export type ProtocolConfig = {
	forkBurnDivisor: bigint
	forkThresholdDivisor: bigint
	minimumSecurityBondDebtAttoEth: bigint
	minimumVaultRepDepositAttoRep: bigint
}

const DEFAULT_FORK_BURN_DIVISOR = 5n
const DEFAULT_FORK_THRESHOLD_DIVISOR = 20n
const DEFAULT_MINIMUM_SECURITY_BOND_DEBT_ATTO_ETH = 10n ** 18n
const DEFAULT_MINIMUM_VAULT_REP_DEPOSIT_ATTO_REP = 0n

export const DEFAULT_PROTOCOL_CONFIG: ProtocolConfig = {
	forkBurnDivisor: DEFAULT_FORK_BURN_DIVISOR,
	forkThresholdDivisor: DEFAULT_FORK_THRESHOLD_DIVISOR,
	minimumSecurityBondDebtAttoEth: DEFAULT_MINIMUM_SECURITY_BOND_DEBT_ATTO_ETH,
	minimumVaultRepDepositAttoRep: DEFAULT_MINIMUM_VAULT_REP_DEPOSIT_ATTO_REP,
}

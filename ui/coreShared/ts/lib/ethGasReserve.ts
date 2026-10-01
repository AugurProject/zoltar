/** ETH kept in the wallet for gas when an action is validated or filled against the full ETH balance. */
export const ETH_GAS_RESERVE_ATTO_ETH = 10n ** 16n

/** Returns the ETH an action may spend while leaving the gas reserve in the wallet; never negative. */
export const getSpendableEthBalance = (walletEthBalanceAttoEth: bigint) => (walletEthBalanceAttoEth > ETH_GAS_RESERVE_ATTO_ETH ? walletEthBalanceAttoEth - ETH_GAS_RESERVE_ATTO_ETH : 0n)

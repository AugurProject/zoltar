import { formatRoundedUnits, formatUnits } from './format.js'
import type { LiveMarket } from '../protocol/liveMarket.js'

/** The SecurityPool fields that define how many attoShares one attoETH of settlement collateral currently represents. */
export type ShareValueRate = Pick<LiveMarket, 'settlementCollateralAttoEth' | 'shareTokenSupplyAttoShares'>

// SecurityPool.attoEthToAttoShares mints attoEth * PRICE_PRECISION shares while no complete set exists, so the
// genesis rate is one attoETH per 10^18 attoShares. Share amounts are therefore only readable as collateral value.
const GENESIS_ATTO_SHARES_PER_ATTO_ETH = 10n ** 18n

/** Settlement-collateral value of a share amount at the pool's current rate; mirrors SecurityPool.attoSharesToAttoEth. */
export function attoSharesToCollateralAttoEth(amountAttoShares: bigint, rate: ShareValueRate) {
	if (amountAttoShares < 0n) throw new Error('Share amounts cannot be negative')
	if (rate.shareTokenSupplyAttoShares === 0n) return amountAttoShares / GENESIS_ATTO_SHARES_PER_ATTO_ETH
	return (amountAttoShares * rate.settlementCollateralAttoEth) / rate.shareTokenSupplyAttoShares
}

/** Share amount worth the given settlement-collateral value, rounded down; undefined while the pool has shares but no collateral. */
export function collateralAttoEthToAttoShares(amountAttoEth: bigint, rate: ShareValueRate) {
	if (amountAttoEth < 0n) throw new Error('Collateral amounts cannot be negative')
	if (rate.shareTokenSupplyAttoShares === 0n) return amountAttoEth * GENESIS_ATTO_SHARES_PER_ATTO_ETH
	if (rate.settlementCollateralAttoEth === 0n) return undefined
	return (amountAttoEth * rate.shareTokenSupplyAttoShares) / rate.settlementCollateralAttoEth
}

/**
 * Limits round down so a user can always enter the displayed amount; every other display rounds to the nearest
 * shown digit so exact amounts do not appear one digit short.
 */
export type ShareValueRounding = 'nearest' | 'down'

function formatCollateralValue(amountAttoShares: bigint, rate: ShareValueRate, maximumFractionDigits: number, rounding: ShareValueRounding) {
	const value = attoSharesToCollateralAttoEth(amountAttoShares, rate)
	return rounding === 'down' ? formatUnits(value, 18, maximumFractionDigits) : formatRoundedUnits(value, 18, maximumFractionDigits)
}

export function formatOutcomeValue(amountAttoShares: bigint, outcome: 'YES' | 'NO' | 'INVALID', rate: ShareValueRate, maximumFractionDigits = 4, rounding: ShareValueRounding = 'nearest') {
	return `${formatCollateralValue(amountAttoShares, rate, maximumFractionDigits, rounding)} ${outcome}`
}

/** LP tokens are minted one per attoShare of the smaller initial reserve, so they share the collateral-value scale of shares. */
export function formatLpValue(amountLp: bigint, rate: ShareValueRate, maximumFractionDigits = 4, rounding: ShareValueRounding = 'nearest') {
	return `${formatCollateralValue(amountLp, rate, maximumFractionDigits, rounding)} LP`
}

export function formatCompleteSetValue(amountAttoShares: bigint, rate: ShareValueRate, maximumFractionDigits = 4, rounding: ShareValueRounding = 'nearest') {
	const formatted = formatCollateralValue(amountAttoShares, rate, maximumFractionDigits, rounding)
	return `${formatted} complete ${formatted === '1' ? 'set' : 'sets'}`
}

/** Collateral value of a share amount as an ETH figure; limits round down so the displayed amount is always accepted. */
export function formatCollateralEth(amountAttoShares: bigint, rate: ShareValueRate, rounding: ShareValueRounding = 'nearest') {
	return `${formatCollateralValue(amountAttoShares, rate, 4, rounding)} ETH`
}

/** Average price paid per ETH of long-share payout, in basis points. */
export function averagePriceBps(amountAttoEth: bigint, longSharesAttoShares: bigint, rate: ShareValueRate) {
	const payoutAttoEth = attoSharesToCollateralAttoEth(longSharesAttoShares, rate)
	if (payoutAttoEth === 0n) return undefined
	return (amountAttoEth * 10_000n) / payoutAttoEth
}

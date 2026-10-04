import { formatTrimmedUnits } from '@zoltar/ui-core-shared/lib/formatters.js'
import { formatRoundedUnits } from './format.js'
import type { LiveMarket } from '../protocol/liveMarket.js'
import * as payoutCopy from '../copy/payout.js'
import { outcomeLabel } from '../copy/outcomes.js'

/** The SecurityPool fields that define how many attoShares one attoETH of settlement collateral currently represents. */
export type ShareValueRate = Pick<LiveMarket, 'settlementCollateralAttoEth' | 'shareTokenSupplyAttoShares'>

/** Settlement-collateral value of a share amount at the pool's current rate; mirrors SecurityPool.attoSharesToAttoEth. */
export function attoSharesToCollateralAttoEth(amountAttoShares: bigint, rate: ShareValueRate) {
	if (amountAttoShares < 0n) throw new Error('Share amounts cannot be negative')
	if (rate.shareTokenSupplyAttoShares === 0n) return amountAttoShares
	return (amountAttoShares * rate.settlementCollateralAttoEth) / rate.shareTokenSupplyAttoShares
}

/** Share amount worth the given settlement-collateral value, rounded down; undefined while the pool has shares but no collateral. */
export function collateralAttoEthToAttoShares(amountAttoEth: bigint, rate: ShareValueRate) {
	if (amountAttoEth < 0n) throw new Error('Collateral amounts cannot be negative')
	if (rate.shareTokenSupplyAttoShares === 0n) return amountAttoEth
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
	const formatted = rounding === 'down' ? formatTrimmedUnits(value, 18, maximumFractionDigits) : formatRoundedUnits(value, 18, maximumFractionDigits)
	return value > 0n && formatted === '0' ? `<${formatTrimmedUnits(1n, maximumFractionDigits, maximumFractionDigits)}` : formatted
}

/** Shares and LP tokens have 18 decimal places, independent of collateral backing. */
export const SHARE_QUANTITY_DECIMALS = 18

function formatShareQuantity(amount: bigint, maximumFractionDigits: number, rounding: ShareValueRounding) {
	if (amount < 0n) throw new Error('Share amounts cannot be negative')
	const formatted = rounding === 'down' ? formatTrimmedUnits(amount, SHARE_QUANTITY_DECIMALS, maximumFractionDigits) : formatRoundedUnits(amount, SHARE_QUANTITY_DECIMALS, maximumFractionDigits)
	return amount > 0n && formatted === '0' ? `<${formatTrimmedUnits(1n, maximumFractionDigits, maximumFractionDigits)}` : formatted
}

/** Share outcome keys; display text comes from `outcomeLabel`. */
export const shareOutcome = { yes: 'YES', no: 'NO', invalid: 'INVALID' } as const

export function formatOutcomeQuantity(amountAttoShares: bigint, outcome: 'YES' | 'NO' | 'INVALID', maximumFractionDigits = 4, rounding: ShareValueRounding = 'nearest') {
	return `${formatShareQuantity(amountAttoShares, maximumFractionDigits, rounding)} ${outcomeLabel(outcome)}`
}

/** LP quantities use a fixed scale too; their underlying reserve claims are displayed separately. */
export function formatLpQuantity(amountLp: bigint, maximumFractionDigits = 4, rounding: ShareValueRounding = 'nearest') {
	return `${formatShareQuantity(amountLp, maximumFractionDigits, rounding)} LP`
}

export function formatCompleteSetQuantity(amountAttoShares: bigint, maximumFractionDigits = 4, rounding: ShareValueRounding = 'nearest') {
	const formatted = formatShareQuantity(amountAttoShares, maximumFractionDigits, rounding)
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

type OutcomeValueMarket = ShareValueRate & Partial<Pick<LiveMarket, 'loadError' | 'questionOutcome' | 'systemState' | 'universeForkTime'>>

/** Current payout with its resolution and redemption conditions. */
export function formatOutcomePayout(amount: bigint, outcome: 'YES' | 'NO' | 'INVALID', market: OutcomeValueMarket, rounding: ShareValueRounding = 'nearest') {
	if (market.loadError !== undefined) return payoutCopy.unavailable
	if (amount === 0n) return '0 ETH'
	const value = formatCollateralEth(amount, market, rounding)
	const index = { INVALID: 0, YES: 1, NO: 2 }[outcome]
	if (market.questionOutcome !== undefined && market.questionOutcome !== 3) {
		if (market.questionOutcome !== index) return payoutCopy.zeroPayout
		return market.systemState === 0 ? payoutCopy.formatRedeemablePayout(value) : payoutCopy.formatUnredeemableWinningPayout(value)
	}
	const payout = payoutCopy.formatConditionalPayout(value, outcome)
	return (market.universeForkTime !== undefined && market.universeForkTime !== 0n) || (market.systemState !== undefined && market.systemState !== 0) ? `${payout}; ${payoutCopy.redemptionUnavailable}` : payout
}

/** Display current backing as a conditional payout, never as an executable sale quote. */
export function formatOutcomeWithValue(amount: bigint, outcome: 'YES' | 'NO' | 'INVALID', market: OutcomeValueMarket, digits = 4, rounding: ShareValueRounding = 'nearest') {
	return `${formatOutcomeQuantity(amount, outcome, digits, rounding)} (${formatOutcomePayout(amount, outcome, market, rounding)})`
}

export function formatCompleteSetWithValue(amount: bigint, market: ShareValueRate & Partial<Pick<LiveMarket, 'loadError'>>, digits = 4, rounding: ShareValueRounding = 'nearest') {
	return `${formatCompleteSetQuantity(amount, digits, rounding)} (${market.loadError === undefined ? formatCollateralEth(amount, market, rounding) : payoutCopy.unavailable})`
}

/** LP tokens represent reserve claims, not a fixed number of complete sets. */
export function formatLpPayout(amount: bigint, market: LiveMarket, rounding: ShareValueRounding = 'nearest') {
	if (amount === 0n) return '0 ETH'
	if (market.loadError !== undefined || market.lpTotalSupply === 0n) return payoutCopy.valueUnavailable
	const yes = (market.yesReserve * amount) / market.lpTotalSupply
	const no = (market.noReserve * amount) / market.lpTotalSupply
	if (market.questionOutcome !== 3) {
		let winning = 0n
		if (market.questionOutcome === 1) winning = yes
		else if (market.questionOutcome === 2) winning = no
		return payoutCopy.formatLpWinningPayout(formatCollateralEth(winning, market, rounding))
	}
	if (yes === no) return payoutCopy.formatValidPayout(formatCollateralEth(yes, market, rounding))
	return `${payoutCopy.formatConditionalPayout(formatCollateralEth(yes, market, rounding), 'YES')}; ${payoutCopy.formatConditionalPayout(formatCollateralEth(no, market, rounding), 'NO')}`
}

export function formatLpWithValue(amount: bigint, market: LiveMarket, digits = 4, rounding: ShareValueRounding = 'nearest') {
	return `${formatLpQuantity(amount, digits, rounding)} (${formatLpPayout(amount, market, rounding)})`
}

import { formatLpPayout, formatLpQuantity, formatOutcomePayout, formatOutcomeQuantity, type ShareValueRounding } from '../lib/shareValue.js'
import type { LiveMarket, ShareOutcome } from '../protocol/live.js'

/** A held balance rounds down like every "You hold" hint, so the same holding reads the same everywhere and is never overstated. */
export function OutcomeHolding({ amount, outcome, market, rounding = 'down' }: { amount: bigint; outcome: ShareOutcome; market: LiveMarket; rounding?: ShareValueRounding }) {
	return (
		<>
			{formatOutcomeQuantity(amount, outcome, 4, rounding)}
			<small className='payout-caption'> ({formatOutcomePayout(amount, outcome, market, rounding)})</small>
		</>
	)
}

export function LpHolding({ amount, market, rounding = 'nearest' }: { amount: bigint; market: LiveMarket; rounding?: ShareValueRounding }) {
	return (
		<>
			{formatLpQuantity(amount, 4, rounding)}
			<small className='payout-caption'> ({formatLpPayout(amount, market, rounding)})</small>
		</>
	)
}

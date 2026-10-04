import { formatLpPayout, formatLpQuantity, formatOutcomePayout, formatOutcomeQuantity, type ShareValueRounding } from '../lib/shareValue.js'
import type { LiveMarket, ShareOutcome } from '../protocol/live.js'

export function OutcomeHolding({ amount, outcome, market }: { amount: bigint; outcome: ShareOutcome; market: LiveMarket }) {
	return (
		<>
			{formatOutcomeQuantity(amount, outcome)}
			<small className='payout-caption'> ({formatOutcomePayout(amount, outcome, market)})</small>
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

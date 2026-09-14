import { formatCollateralEth, formatOutcomeQuantity } from '../lib/shareValue.js'
import type { LiveMarket, ShareOutcome } from '../protocol/live.js'
import * as payoutCopy from '../copy/payout.js'

export function OutcomeHolding({ amount, outcome, market }: { amount: bigint; outcome: ShareOutcome; market: LiveMarket }) {
	const index = { INVALID: 0, YES: 1, NO: 2 }[outcome]
	const value = formatCollateralEth(amount, market)
	let payout = payoutCopy.conditionalPayout(value, outcome)
	if (market.loadError !== undefined) payout = payoutCopy.unavailable
	else if (market.questionOutcome !== 3) {
		if (market.questionOutcome !== index) payout = payoutCopy.zeroPayout
		else payout = market.systemState === 0 ? payoutCopy.redeemable(value) : payoutCopy.winningPayout(value)
	} else if (market.universeForkTime !== 0n || market.systemState !== 0) payout = payoutCopy.redemptionUnavailable
	return (
		<>
			{formatOutcomeQuantity(amount, outcome)}
			{amount === 0n ? null : <small class='payout-caption'>{payout}</small>}
		</>
	)
}

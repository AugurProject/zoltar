import { formatLpPayout, formatLpQuantity, formatOutcomePayout, formatOutcomeQuantity, type ShareValueRounding } from '../lib/shareValue.js'
import type { ComponentChildren } from 'preact'
import { lockedMigratedBalance, type LiveBalances, type LiveMarket, type ShareOutcome } from '../protocol/live.js'
import { marketsCopy } from '../copy/markets.js'

/**
 * A held balance rounds down like every "You hold" hint, so the same holding reads the same everywhere and is never overstated.
 * The payout is a caption line of its own, so it needs no brackets; a caller whose surroundings already state that redemption is blocked passes `noteRedemption={false}`.
 */
export function OutcomeHolding({ amount, outcome, market, noteRedemption = true, rounding = 'down' }: { amount: bigint; outcome: ShareOutcome; market: LiveMarket; noteRedemption?: boolean; rounding?: ShareValueRounding }) {
	return (
		<>
			{formatOutcomeQuantity(amount, outcome, 4, rounding)}
			<small className='payout-caption'> {formatOutcomePayout(amount, outcome, market, rounding, { noteRedemption })}</small>
		</>
	)
}

/** The list-item class that colours a holding by its outcome. */
export const OUTCOME_HOLDING_CLASS: Record<ShareOutcome, string | undefined> = { YES: 'portfolio-holding-yes', NO: 'portfolio-holding-no', INVALID: undefined }

/** A balance a fork migration locked stays listed, marked as locked, so the holder sees it was migrated. */
export function LockedCaption({ balances, outcome }: { balances: LiveBalances | undefined; outcome: ShareOutcome }) {
	return balances === undefined || lockedMigratedBalance(balances, outcome) === 0n ? undefined : <small className='payout-caption holding-locked'>{marketsCopy.lockedAfterMigration}</small>
}

/** One outcome holding as a list item coloured by its outcome; `children` adds lines under it, such as a locked-balance caption. */
export function OutcomeHoldingItem({ children, ...holding }: Parameters<typeof OutcomeHolding>[0] & { children?: ComponentChildren }) {
	return (
		<li className={OUTCOME_HOLDING_CLASS[holding.outcome]}>
			<OutcomeHolding {...holding} />
			{children}
		</li>
	)
}

export function LpHolding({ amount, market, rounding = 'nearest' }: { amount: bigint; market: LiveMarket; rounding?: ShareValueRounding }) {
	return (
		<>
			{formatLpQuantity(amount, 4, rounding)}
			<small className='payout-caption'> {formatLpPayout(amount, market, rounding)}</small>
		</>
	)
}

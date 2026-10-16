import { marketsCopy } from '../copy/markets.js'

/**
 * Compact conditional YES / NO split for market cards. `showValues` is off when adjacent outcome buttons already carry the
 * numbers; `last` marks a market that stopped trading, whose bar shows its last price, muted.
 */
export function MarketOddsBar({ yesPercent, noPercent, showValues = true, last = false }: { yesPercent: number; noPercent: number; showValues?: boolean; last?: boolean }) {
	const caption = last ? marketsCopy.lastConditionalPrice : marketsCopy.conditionalPrice
	return (
		<div className={last ? 'market-odds market-odds--last' : 'market-odds'}>
			<div className='market-odds__labels' aria-hidden='true'>
				<span className='market-odds__caption'>{caption}</span>
				{showValues ? (
					<>
						<span className='market-odds__yes'>{marketsCopy.formatOutcomePrice(marketsCopy.yes, yesPercent)}</span>
						<span className='market-odds__no'>{marketsCopy.formatOutcomePrice(marketsCopy.no, noPercent)}</span>
					</>
				) : undefined}
			</div>
			<div className='market-odds__track' role='img' aria-label={marketsCopy.formatConditionalPrices(caption, yesPercent, noPercent)}>
				<div className='market-odds__fill' style={{ width: `${yesPercent.toString()}%` }} />
			</div>
		</div>
	)
}

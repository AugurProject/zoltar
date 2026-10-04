import { marketsCopy } from '../copy/markets.js'

/** Compact conditional YES / NO split for market cards. `showValues` is off when adjacent outcome buttons already carry the numbers. */
export function MarketOddsBar({ yesPercent, noPercent, showValues = true }: { yesPercent: number; noPercent: number; showValues?: boolean }) {
	return (
		<div className='market-odds'>
			<div className='market-odds__labels' aria-hidden='true'>
				<span className='market-odds__caption'>{marketsCopy.conditionalPrice}</span>
				{showValues ? (
					<>
						<span className='market-odds__yes'>{marketsCopy.formatOutcomePrice(marketsCopy.yes, yesPercent)}</span>
						<span className='market-odds__no'>{marketsCopy.formatOutcomePrice(marketsCopy.no, noPercent)}</span>
					</>
				) : undefined}
			</div>
			<div className='market-odds__track' role='img' aria-label={marketsCopy.formatConditionalPrices(yesPercent, noPercent)}>
				<div className='market-odds__fill' style={{ width: `${yesPercent.toString()}%` }} />
			</div>
		</div>
	)
}

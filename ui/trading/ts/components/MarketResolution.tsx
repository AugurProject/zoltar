import { marketsCopy } from '../copy/markets.js'
import { outcomeLabel } from '../copy/outcomes.js'

/** Stands in for the price on a resolved market: its shares now pay out by outcome, so a trading price no longer applies. */
export function MarketResolution({ outcome }: { outcome: 'INVALID' | 'YES' | 'NO' }) {
	return (
		<p className={`market-resolution market-resolution--${outcome.toLowerCase()}`}>
			<span className='market-resolution__label'>{marketsCopy.finalOutcome}</span>
			<strong>{outcomeLabel(outcome)}</strong>
		</p>
	)
}

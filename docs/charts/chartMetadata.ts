import type { ChartMetadata } from './diagramTypes'

export const quantitativeChartMetadata = {
	'fig-auction-clearing-ladder': {
		ariaDescription:
			'High-price bids are considered first. If cumulative demand reaches the ETH raise cap or REP sale cap, the first binding tick sets normal uniform clearing. If neither cap is reached, finalization selects bids at or above the cap-implied qualification tick and allocates the complete REP sale cap among them at one effective price. With no qualifying bids, every bid refunds.',
		ariaLabel: 'Auction demand is evaluated from high ticks to low ticks before uniform or underfunded clearing',
		height: 360,
		width: 980,
	},
	'fig-statoblast-escalation-cost-curve': {
		ariaDescription: 'Required support threshold is zero on days 0–2, starts at the configured start bond on day 3, follows the contract fixed-point attrition curve, and reaches the configured non-decision threshold on day 52; this curve is not the minimum individual deposit.',
		ariaLabel: 'Contract fixed-point required support threshold from day 0 to day 52',
		height: 300,
		width: 860,
	},
	'fig-statoblast-retention-utilization': {
		ariaDescription: 'The annualized open-interest fee rises from about ten percent at zero utilization to about fifty percent at the eighty-percent utilization dip, then remains at that level as the per-second retention rate stays at its minimum.',
		ariaLabel: 'Annualized open-interest fee across live ETH minting-capacity utilization',
		height: 420,
		width: 900,
	},
	'fig-zoltar-fork-threshold-decay': {
		ariaDescription: "With the default threshold and burn divisors, each fork haircut leaves approximately ninety-nine percent of the previous generation's theoretical REP supply. The next fork threshold remains five percent of that declining supply.",
		ariaLabel: 'Theoretical REP supply and fork threshold across repeated forks',
		height: 420,
		width: 900,
	},
	'plot-statoblast-whitepaper-19': {
		ariaDescription: 'Child collateral repair progress',
		ariaLabel: 'Child collateral repair progress',
		height: 170,
		width: 760,
	},
} satisfies Record<string, ChartMetadata>

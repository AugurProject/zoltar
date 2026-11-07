import type { ChartMetadata } from './diagramTypes'

export const quantitativeChartMetadata = {
	'fig-statoblast-escalation-cost-curve': {
		ariaDescription: 'Required support threshold is zero through day 3, starts at the configured start bond just after day 3, follows the contract fixed-point attrition curve, and reaches the configured non-decision threshold on day 52; this curve is not the minimum individual deposit.',
		ariaLabel: 'Contract fixed-point required support threshold from day 0 to day 52',
		height: 300,
		width: 860,
	},
	'fig-zoltar-fork-threshold-decay': {
		ariaDescription: "With the default threshold and burn divisors, each fork haircut leaves approximately ninety-nine percent of the previous generation's theoretical REP supply. The next fork threshold remains five percent of that declining supply.",
		ariaLabel: 'Theoretical REP supply and fork threshold across repeated forks',
		height: 420,
		width: 900,
	},
} satisfies Record<string, ChartMetadata>

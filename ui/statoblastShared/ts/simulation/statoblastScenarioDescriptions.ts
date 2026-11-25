export const STATOBLAST_SCENARIOS = ['portfolio-auction', 'security-pool', 'securitypoolx2'] as const
export type StatoblastScenario = (typeof STATOBLAST_SCENARIOS)[number]

export function getStatoblastScenarioLabel(scenario: StatoblastScenario) {
	switch (scenario) {
		case 'portfolio-auction':
			return 'Security pool branch auction'
		case 'security-pool':
			return 'One-question security pool'
		default:
			return 'Two-question security pool'
	}
}
export function getStatoblastScenarioDescription(scenario: StatoblastScenario) {
	if (scenario === 'portfolio-auction') return 'A shared security pool with an open recapitalization auction. One of your bids is still in contention and the other is outbid and refundable. Another wallet has also bid. Follow the auction through closing and branch activation.'
	if (scenario === 'security-pool') return 'A funded shared security pool with one registered question. Test trading, reporting, and owner backing.'
	return 'A funded shared security pool with two registered questions. Test shared capacity, health targets, purchases, commitment reductions, and fees.'
}

export const STATOBLAST_SCENARIOS = ['portfolio-auction', 'security-pool', 'securitypoolx2'] as const
export type StatoblastScenario = (typeof STATOBLAST_SCENARIOS)[number]

export function getStatoblastScenarioLabel(scenario: StatoblastScenario) {
	switch (scenario) {
		case 'portfolio-auction':
			return 'Portfolio branch auction'
		case 'security-pool':
			return 'One-question portfolio'
		default:
			return 'Two-question portfolio'
	}
}
export function getStatoblastScenarioDescription(scenario: StatoblastScenario) {
	if (scenario === 'portfolio-auction') return 'A shared portfolio with an open branch collateral repair auction and binding, excluded, and rival bids. Claim excluded-bid refunds now, then follow the auction through finalization and branch activation.'
	if (scenario === 'security-pool') return 'A funded shared portfolio with one registered question. Test trading, reporting, and owner backing.'
	return 'A funded shared portfolio with two registered questions. Test shared capacity, owner health settings, purchases, retirement, and fees.'
}

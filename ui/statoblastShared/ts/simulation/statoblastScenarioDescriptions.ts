import { scenario as scenarioCopy } from '../copy/simulation.js'
export const STATOBLAST_SCENARIOS = ['portfolio-auction', 'security-pool', 'securitypoolx2'] as const
export type StatoblastScenario = (typeof STATOBLAST_SCENARIOS)[number]

export function getStatoblastScenarioLabel(scenario: StatoblastScenario) {
	switch (scenario) {
		case 'portfolio-auction':
			return scenarioCopy.branchAuctionTitle
		case 'security-pool':
			return scenarioCopy.oneQuestionTitle
		default:
			return scenarioCopy.twoQuestionTitle
	}
}
export function getStatoblastScenarioDescription(scenario: StatoblastScenario) {
	if (scenario === 'portfolio-auction') return scenarioCopy.branchAuctionDetail
	if (scenario === 'security-pool') return scenarioCopy.oneQuestionDetail
	return scenarioCopy.twoQuestionDetail
}

import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'

export type StatoblastScenario = 'security-pool' | 'securitypoolx2' | 'securitypoolx2-auction'

export function getStatoblastScenarioLabel(scenario: StatoblastScenario) {
	switch (scenario) {
		case 'security-pool':
			return 'Security pool'
		case 'securitypoolx2':
			return 'Security pool x2'
		case 'securitypoolx2-auction':
			return 'Security pool x2 auction'
		default:
			return assertNever(scenario)
	}
}

export function getStatoblastScenarioDescription(scenario: StatoblastScenario) {
	switch (scenario) {
		case 'security-pool':
			return 'One seeded question, one security pool, and one funded vault with a standing ETH commitment. Use it to test pool actions and liquidation paths.'
		case 'securitypoolx2':
			return 'Two seeded questions with two security pools and two funded vaults in each pool. Use it to test multi-pool selection and repeated pool actions.'
		case 'securitypoolx2-auction':
			return 'Two seeded questions with one own-escalation fork already triggered and one child truth auction seeded with ten bids. Use it to test the fork-auction bidbook and settlement actions.'
		default:
			return assertNever(scenario)
	}
}

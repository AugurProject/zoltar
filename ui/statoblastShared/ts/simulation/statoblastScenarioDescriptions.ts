import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'

export type StatoblastScenario = 'security-pool' | 'securitypoolx2' | 'securitypoolx2-auction' | 'ended-pool-commitment' | 'liquidation-distance'

export function getStatoblastScenarioLabel(scenario: StatoblastScenario) {
	switch (scenario) {
		case 'security-pool':
			return 'Security pool'
		case 'securitypoolx2':
			return 'Security pool x2'
		case 'securitypoolx2-auction':
			return 'Security pool x2 auction'
		case 'ended-pool-commitment':
			return 'Ended pool commitment'
		case 'liquidation-distance':
			return 'Liquidation distance'
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
		case 'ended-pool-commitment':
			return 'One security pool whose question has resolved while the pool stays operational, with your vault still holding REP backing and an ETH commitment. Use it to test exiting the commitment and redeeming REP after the question ends.'
		case 'liquidation-distance':
			return 'One security pool repriced so two vaults are undercollateralized: one sits within the minimum liquidation price distance and one is past it. Use it to test the liquidation distance guard.'
		default:
			return assertNever(scenario)
	}
}

import { assertNever } from '@zoltar/ui-core-shared/lib/assert.js'

// The single scenario list: adding an id here makes the label, description, and seeding lookups fail to compile until it has an entry in each.
export const STATOBLAST_SCENARIOS = ['portfolio', 'security-pool', 'securitypoolx2', 'securitypoolx2-auction', 'finalized-truth-auction', 'ended-pool-commitment', 'escalation-in-progress', 'liquidation-distance', 'near-minimum-vault'] as const

export type StatoblastScenario = (typeof STATOBLAST_SCENARIOS)[number]

export function getStatoblastScenarioLabel(scenario: StatoblastScenario) {
	switch (scenario) {
		case 'portfolio':
			return 'Portfolio'
		case 'security-pool':
			return 'Security pool'
		case 'securitypoolx2':
			return 'Security pool x2'
		case 'securitypoolx2-auction':
			return 'Security pool x2 auction'
		case 'finalized-truth-auction':
			return 'Finalized truth auction'
		case 'ended-pool-commitment':
			return 'Ended pool commitment'
		case 'escalation-in-progress':
			return 'Escalation in progress'
		case 'liquidation-distance':
			return 'Liquidation distance'
		case 'near-minimum-vault':
			return 'Near-minimum vault'
		default:
			return assertNever(scenario)
	}
}

export function getStatoblastScenarioDescription(scenario: StatoblastScenario) {
	switch (scenario) {
		case 'portfolio':
			return 'Individual REP accounts back two questions. Test owner health settings, shared purchases, retirement, fees, and fork recovery.'
		case 'security-pool':
			return 'One seeded question, one security pool, and one funded vault with a standing ETH commitment. Use it to test pool actions and liquidation paths.'
		case 'securitypoolx2':
			return 'Two seeded questions with two security pools and two funded vaults in each pool. Use it to test multi-pool selection and repeated pool actions.'
		case 'securitypoolx2-auction':
			return 'Two seeded questions with one own-escalation fork already triggered and one child truth auction seeded with ten bids. Use it to test the fork-auction bidbook and settlement actions.'
		case 'finalized-truth-auction':
			return 'The Security pool x2 auction setup with the Yes child truth auction run past its end and finalized. Use it to test auction claims, refunds, and the settled fork workflow.'
		case 'ended-pool-commitment':
			return 'One security pool whose question has resolved while the pool stays operational, with your vault still holding REP backing and an ETH commitment. Use it to test exiting the commitment and redeeming REP after the question ends.'
		case 'escalation-in-progress':
			return 'One security pool whose question has ended, with your Yes report disputed by a larger No report while the escalation game runs. Use it to test the reporting view and escalation deadlines.'
		case 'liquidation-distance':
			return 'One security pool repriced so two vaults are undercollateralized: one sits within the minimum liquidation price distance and one is past it. Use it to test the liquidation distance guard.'
		case 'near-minimum-vault':
			return 'One security pool repriced so your vault stays healthy but sits just above the security multiplier, beside a comfortably backed vault. Use it to test near-minimum health warnings and vault ordering.'
		default:
			return assertNever(scenario)
	}
}

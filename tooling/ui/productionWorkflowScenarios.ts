export const PRODUCTION_WORKFLOW_SCENARIOS = ['auction-boot', 'capital-recovery', 'security-pool-purchase', 'deployment', 'trading-liquidity', 'openoracle-report'] as const
export type ProductionWorkflowScenario = (typeof PRODUCTION_WORKFLOW_SCENARIOS)[number]

export function selectProductionWorkflowScenarios(value: string | undefined): readonly ProductionWorkflowScenario[] {
	if (value === undefined || value === '') return PRODUCTION_WORKFLOW_SCENARIOS
	const scenarios = value.split(',').map(name => {
		const scenario = PRODUCTION_WORKFLOW_SCENARIOS.find(candidate => candidate === name)
		if (scenario === undefined) throw new Error(`Unknown production browser workflow scenario: ${name}. Expected one of: ${PRODUCTION_WORKFLOW_SCENARIOS.join(', ')}`)
		return scenario
	})
	if (new Set(scenarios).size !== scenarios.length) throw new Error(`Duplicate production browser workflow scenario in ${value}`)
	return scenarios
}

export const productionWorkflowTestName = (scenario: ProductionWorkflowScenario) => `production workflow: ${scenario}`

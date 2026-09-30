export const PRODUCTION_WORKFLOW_SCENARIOS = ['auction-boot', 'pool-recovery', 'reporting-migration', 'deployment-auction', 'ended-pool-exit', 'liquidation-distance'] as const
export type ProductionWorkflowScenario = (typeof PRODUCTION_WORKFLOW_SCENARIOS)[number]

export function selectProductionWorkflowScenarios(value: string | undefined): readonly ProductionWorkflowScenario[] {
	if (value === undefined || value === '') return PRODUCTION_WORKFLOW_SCENARIOS
	const scenario = PRODUCTION_WORKFLOW_SCENARIOS.find(candidate => candidate === value)
	if (scenario === undefined) throw new Error(`Unknown production browser workflow scenario: ${value}. Expected one of: ${PRODUCTION_WORKFLOW_SCENARIOS.join(', ')}`)
	return [scenario]
}

export const productionWorkflowTestName = (scenario: ProductionWorkflowScenario) => `production workflow: ${scenario}`

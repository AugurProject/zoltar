import { expect, test } from 'bun:test'
import { PRODUCTION_WORKFLOW_SCENARIOS, productionWorkflowTestName, selectProductionWorkflowScenarios } from './productionWorkflowScenarios.ts'

test('manual browser workflow runs retain every scenario', () => {
	expect(selectProductionWorkflowScenarios(undefined)).toEqual(PRODUCTION_WORKFLOW_SCENARIOS)
	expect(selectProductionWorkflowScenarios('')).toEqual(PRODUCTION_WORKFLOW_SCENARIOS)
})

test.each([...PRODUCTION_WORKFLOW_SCENARIOS])('a CI job selects only %s', scenario => {
	expect(selectProductionWorkflowScenarios(scenario)).toEqual([scenario])
	expect(productionWorkflowTestName(scenario)).toMatch(/^production workflow:/)
})

test.each(['unknown', 'Deployment', 'deployment,pool-recovery', ' deployment'])('rejects invalid scenario %s rather than silently running zero tests', scenario => {
	expect(() => selectProductionWorkflowScenarios(scenario)).toThrow('Unknown production browser workflow scenario')
})

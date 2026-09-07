import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'
import { getDeploymentSections as getZoltarDeploymentSections } from '@zoltar/ui-zoltar/features/deployment/lib/deployment.js'

const ZOLTAR_STEP_IDS = new Set(['proxyDeployer', 'deploymentStatusOracle', 'multicall3', 'weth', 'reputationToken', 'scalarOutcomes', 'zoltarQuestionData', 'zoltar'])

export function getStatoblastDeploymentSections(steps: DeploymentStatus[]) {
	const securityPoolSteps = steps.filter(step => !ZOLTAR_STEP_IDS.has(step.id))
	return [...getZoltarDeploymentSections(steps), ...(securityPoolSteps.length === 0 ? [] : [{ title: 'Security Pools', steps: securityPoolSteps }])]
}

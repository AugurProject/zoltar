import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'
import { getDeploymentSections as getZoltarDeploymentSections } from '@zoltar/ui-zoltar-shared/features/deployment/lib/deployment.js'

const ZOLTAR_STEP_IDS = new Set(['proxyDeployer', 'deploymentStatusOracle', 'multicall3', 'reputationToken', 'zoltarQuestionData', 'zoltar'])

export function getStatoblastDeploymentSections(steps: DeploymentStatus[]) {
	const statoblastSteps = steps.filter(step => !ZOLTAR_STEP_IDS.has(step.id))
	return [...getZoltarDeploymentSections(steps), ...(statoblastSteps.length === 0 ? [] : [{ title: 'Security pools', steps: statoblastSteps }])]
}

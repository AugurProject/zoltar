import type { DeploymentStatus } from '@zoltar/ui-core-shared/types/contracts.js'
import { getDeploymentSections as getZoltarDeploymentSections } from '@zoltar/ui-zoltar-shared/features/deployment/lib/deployment.js'
import { universeDeploymentSection } from '../../copy/app.js'

const UNIVERSE_STEP_IDS = new Set<DeploymentStatus['id']>(['reputationToken', 'zoltarQuestionData', 'zoltar'])

export function getStatoblastDeploymentSections(steps: DeploymentStatus[]) {
	const sharedSections = getZoltarDeploymentSections(steps).map(section => (section.steps.some(step => UNIVERSE_STEP_IDS.has(step.id)) ? { ...section, title: universeDeploymentSection } : section))
	const sharedStepIds = new Set(sharedSections.flatMap(section => section.steps.map(step => step.id)))
	const statoblastSteps = steps.filter(step => !sharedStepIds.has(step.id))
	return [...sharedSections, ...(statoblastSteps.length === 0 ? [] : [{ title: 'Security pools', steps: statoblastSteps }])]
}

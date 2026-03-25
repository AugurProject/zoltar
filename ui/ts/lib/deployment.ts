import type { DeploymentStatus } from '../types/contracts.js'

export function getPrerequisiteLabel(steps: DeploymentStatus[], index: number) {
	const currentStep = steps[index]
	if (currentStep === undefined) return null

	const missingDependency = currentStep.dependencies.map(dependencyId => steps.find(step => step.id === dependencyId)).find(step => step !== undefined && !step.deployed)

	return missingDependency?.label ?? null
}

export function findNextDeployableStep(steps: DeploymentStatus[]) {
	return steps.find((step, index) => !step.deployed && getPrerequisiteLabel(steps, index) === null) ?? null
}

export function getDeploymentSections(steps: DeploymentStatus[]) {
	return [
		{
			title: 'Proxy Deployer',
			steps: steps.filter(step => step.id === 'proxyDeployer'),
		},
		{
			title: 'Zoltar',
			steps: steps.filter(step => step.id === 'scalarOutcomes' || step.id === 'zoltarQuestionData' || step.id === 'zoltar'),
		},
		{
			title: 'Augur PlaceHolder',
			steps: steps.filter(step => step.id !== 'proxyDeployer' && step.id !== 'scalarOutcomes' && step.id !== 'zoltarQuestionData' && step.id !== 'zoltar'),
		},
	]
}

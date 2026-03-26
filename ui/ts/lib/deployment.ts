import type { DeploymentStatus } from '../types/contracts.js'

export function getPrerequisiteLabel(steps: DeploymentStatus[], index: number) {
	const currentStep = steps[index]
	if (currentStep === undefined) return undefined

	for (const dependencyId of currentStep.dependencies) {
		const dependency = steps.find(step => step.id === dependencyId)
		if (dependency === undefined) return dependencyId
		if (!dependency.deployed) return dependency.label
	}

	return undefined
}

export function findNextDeployableStep(steps: DeploymentStatus[]) {
	return steps.find((step, index) => !step.deployed && getPrerequisiteLabel(steps, index) === undefined)
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

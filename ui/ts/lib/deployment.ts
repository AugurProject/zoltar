import type { DeploymentStatus } from '../types/contracts.js'

type DeploymentSectionDefinition = {
	title: string
	stepIds: DeploymentStatus['id'][]
}

const DEPLOYMENT_SECTIONS: DeploymentSectionDefinition[] = [
	{
		title: 'Utilities',
		stepIds: ['proxyDeployer', 'deploymentStatusOracle', 'multicall3'],
	},
	{
		title: 'Zoltar',
		stepIds: ['scalarOutcomes', 'zoltarQuestionData', 'zoltar'],
	},
	{
		title: 'Augur PlaceHolder',
		stepIds: ['uniformPriceDualCapBatchAuctionFactory', 'securityPoolUtils', 'openOracle', 'shareTokenFactory', 'priceOracleManagerAndOperatorQueuerFactory', 'securityPoolForker', 'escalationGameFactory', 'securityPoolFactory'],
	},
]

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
	return DEPLOYMENT_SECTIONS.map(section => ({
		title: section.title,
		steps: steps.filter(step => section.stepIds.includes(step.id)),
	}))
}

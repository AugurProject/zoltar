import type { DeploymentStatus } from '../types/contracts.js'

const DEPLOYMENT_SECTION_TITLES = ['Utilities', 'Zoltar', 'Augur PlaceHolder'] as const
const DEPLOYMENT_SECTION_BY_STEP_ID: Record<DeploymentStatus['id'], (typeof DEPLOYMENT_SECTION_TITLES)[number]> = {
	proxyDeployer: 'Utilities',
	deploymentStatusOracle: 'Utilities',
	uniformPriceDualCapBatchAuctionFactory: 'Augur PlaceHolder',
	scalarOutcomes: 'Zoltar',
	securityPoolUtils: 'Augur PlaceHolder',
	openOracle: 'Augur PlaceHolder',
	zoltarQuestionData: 'Zoltar',
	zoltar: 'Zoltar',
	shareTokenFactory: 'Augur PlaceHolder',
	priceOracleManagerAndOperatorQueuerFactory: 'Augur PlaceHolder',
	securityPoolForker: 'Augur PlaceHolder',
	escalationGameFactory: 'Augur PlaceHolder',
	securityPoolFactory: 'Augur PlaceHolder',
}

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
	return DEPLOYMENT_SECTION_TITLES.map(title => ({
		title,
		steps: steps.filter(step => DEPLOYMENT_SECTION_BY_STEP_ID[step.id] === title),
	}))
}

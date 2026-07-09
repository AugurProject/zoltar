import type { ActionAvailability } from '../types/components.js'
import type { DeploymentStatus } from '../types/contracts.js'

type DeploymentStepAvailabilityState = Pick<DeploymentStatus, 'id' | 'deployed' | 'dependencies' | 'label'>

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

export function getDeploymentStepAvailability({
	accountAddress,
	busyStepId,
	isMainnet,
	prerequisiteLabel,
	step,
}: {
	accountAddress: string | undefined
	busyStepId: DeploymentStatus['id'] | undefined
	isMainnet: boolean
	prerequisiteLabel: string | undefined
	step: DeploymentStepAvailabilityState
}): ActionAvailability {
	if (step.deployed) return { disabled: true, reason: 'Already deployed.' }
	if (busyStepId !== undefined) return { disabled: true, reason: busyStepId === step.id ? 'Deployment in progress.' : 'Another deployment is already in progress.' }
	if (accountAddress === undefined) return { disabled: true, reason: 'Connect wallet to deploy this contract.' }
	if (!isMainnet) return { disabled: true, reason: undefined }
	if (prerequisiteLabel !== undefined) return { disabled: true, reason: `Waiting for ${prerequisiteLabel}.` }
	return { disabled: false, reason: undefined }
}

export function getDeployNextMissingAvailability({
	accountAddress,
	busyStepId,
	deployNextMissingPending,
	isMainnet,
	nextMissingStep,
}: {
	accountAddress: string | undefined
	busyStepId: DeploymentStatus['id'] | undefined
	deployNextMissingPending: boolean
	isMainnet: boolean
	nextMissingStep: Pick<DeploymentStatus, 'id' | 'label'> | undefined
}): ActionAvailability {
	if (deployNextMissingPending) return { disabled: true, reason: 'Deployment in progress.' }
	if (busyStepId !== undefined) return { disabled: true, reason: 'Another deployment is already in progress.' }
	if (accountAddress === undefined) return { disabled: true, reason: 'Connect wallet to continue.' }
	if (!isMainnet) return { disabled: true, reason: undefined }
	if (nextMissingStep === undefined) return { disabled: true, reason: 'All deterministic contracts are already deployed.' }
	return { disabled: false, reason: undefined }
}

export function getDeploymentSections(steps: DeploymentStatus[]) {
	return DEPLOYMENT_SECTIONS.map(section => ({
		title: section.title,
		steps: steps.filter(step => section.stepIds.includes(step.id)),
	}))
}

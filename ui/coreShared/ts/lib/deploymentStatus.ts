import type { DeploymentStatus } from '../types/contracts.js'

export function hasDeployedStep(steps: DeploymentStatus[], stepId: DeploymentStatus['id']) {
	return steps.some(step => step.id === stepId && step.deployed)
}

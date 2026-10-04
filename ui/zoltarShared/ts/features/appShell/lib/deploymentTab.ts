type DeploymentTabState = {
	applicationDeploymentMissing: boolean
	deploymentStatusError: string | undefined
	deploymentStatuses: readonly { deployed: boolean }[]
	hasLoadedDeploymentStatuses: boolean
}

/** Shows the deployment tab on a status-read failure, missing application contracts, or a loaded undeployed step; hidden until statuses load. */
export function shouldShowDeploymentTab({ applicationDeploymentMissing, deploymentStatusError, deploymentStatuses, hasLoadedDeploymentStatuses }: DeploymentTabState) {
	return deploymentStatusError !== undefined || applicationDeploymentMissing || (hasLoadedDeploymentStatuses && deploymentStatuses.some(step => !step.deployed))
}

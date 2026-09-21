type DeploymentTabState = {
	applicationDeploymentMissing: boolean
	deploymentStatusError: string | undefined
	deploymentStatuses: readonly { deployed: boolean }[]
	hasLoadedDeploymentStatuses: boolean
}

/** The deployment tab stays visible while anything about the deployment is unknown, failing, or incomplete. */
export function shouldShowDeploymentTab({ applicationDeploymentMissing, deploymentStatusError, deploymentStatuses, hasLoadedDeploymentStatuses }: DeploymentTabState) {
	return deploymentStatusError !== undefined || applicationDeploymentMissing || (hasLoadedDeploymentStatuses && deploymentStatuses.some(step => !step.deployed))
}

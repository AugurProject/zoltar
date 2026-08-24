import { zeroAddress, type Address } from '@zoltar/bot-shared/ethereum'

type RelevantDeployment = Readonly<{
	parent: Address
	securityPool: Address
}>

type RelevantDeploymentDiscoveryParameters<Deployment extends RelevantDeployment, DesiredPool> = {
	desiredPools: readonly DesiredPool[]
	loadDeploymentsForParent: (parent: Address) => Promise<readonly Deployment[]>
	loadDeploymentsForPool: (pool: Address) => Promise<readonly Deployment[]>
	resolveDesiredPool: (desired: DesiredPool) => Promise<Address>
	selectedPools: readonly Address[]
}

function addDeployment<Deployment extends RelevantDeployment>(deployments: Map<string, Deployment>, deployment: Deployment) {
	deployments.set(deployment.securityPool.toLowerCase(), deployment)
}

export async function discoverRelevantDeployments<Deployment extends RelevantDeployment, DesiredPool>(parameters: RelevantDeploymentDiscoveryParameters<Deployment, DesiredPool>) {
	const deployments = new Map<string, Deployment>()
	const selectedPools = [...new Map(parameters.selectedPools.map(address => [address.toLowerCase(), address])).values()]
	for (const selectedPool of selectedPools) {
		for (const deployment of await parameters.loadDeploymentsForPool(selectedPool)) addDeployment(deployments, deployment)
		for (const deployment of await parameters.loadDeploymentsForParent(selectedPool)) addDeployment(deployments, deployment)
	}
	for (const desired of parameters.desiredPools) {
		const pool = await parameters.resolveDesiredPool(desired)
		if (pool === zeroAddress || deployments.has(pool.toLowerCase())) continue
		for (const deployment of await parameters.loadDeploymentsForPool(pool)) addDeployment(deployments, deployment)
	}
	return [...deployments.values()]
}

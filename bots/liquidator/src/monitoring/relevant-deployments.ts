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
	const queriedPools = new Set<string>()
	const queriedParents = new Set<string>()
	const loadPoolAndChildren = async (pool: Address) => {
		const key = pool.toLowerCase()
		if (!queriedPools.has(key)) {
			queriedPools.add(key)
			for (const deployment of await parameters.loadDeploymentsForPool(pool)) addDeployment(deployments, deployment)
		}
		if (!queriedParents.has(key)) {
			queriedParents.add(key)
			for (const deployment of await parameters.loadDeploymentsForParent(pool)) addDeployment(deployments, deployment)
		}
	}
	for (const selectedPool of selectedPools) await loadPoolAndChildren(selectedPool)
	for (const desired of parameters.desiredPools) {
		const pool = await parameters.resolveDesiredPool(desired)
		if (pool === zeroAddress) continue
		await loadPoolAndChildren(pool)
	}
	return [...deployments.values()]
}

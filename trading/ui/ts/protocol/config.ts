export type DeploymentConfiguration = Readonly<{
	chainId: number
	chainName: string
	rpcUrl: string
	securityPoolFactory: `0x${string}`
	factory: `0x${string}`
	router: `0x${string}`
	feeBps: number
}>

export async function loadDeploymentConfiguration(): Promise<DeploymentConfiguration | undefined> {
	const response = await fetch('./deployment.json', { cache: 'no-store' })
	if (response.status === 404) return undefined
	if (!response.ok) throw new Error(`Deployment configuration failed with HTTP ${response.status}`)
	const candidate: unknown = await response.json()
	if (typeof candidate !== 'object' || candidate === null) throw new Error('Deployment configuration must be an object')
	const source = candidate as Record<string, unknown>
	if (typeof source.chainId !== 'number' || typeof source.chainName !== 'string' || typeof source.rpcUrl !== 'string' || typeof source.securityPoolFactory !== 'string' || typeof source.factory !== 'string' || typeof source.router !== 'string' || typeof source.feeBps !== 'number') {
		throw new Error('Deployment configuration is incomplete')
	}
	return source as DeploymentConfiguration
}

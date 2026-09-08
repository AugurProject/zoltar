import type { Address, Hex } from '@zoltar/bot-shared/ethereum'

type DeploymentReader = {
	getBlock(): Promise<{ number?: bigint | undefined; timestamp: bigint }>
	getCode(parameters: { address: Address; blockNumber: bigint }): Promise<Hex | undefined>
}

type CoreDeployment = {
	securityPoolFactory: Address
	weth: Address
	zoltar: Address
}

export type SystemDeploymentStatus = { deployed: true } | { address: Address; deployed: false; name: string; block: { number: bigint; timestamp: bigint } }

export async function systemDeploymentStatus(client: DeploymentReader, deployment: CoreDeployment): Promise<SystemDeploymentStatus> {
	const observed = await client.getBlock()
	if (observed.number === undefined) throw new Error('Deployment check block is missing its number')
	const block = { number: observed.number, timestamp: observed.timestamp }
	const contracts = [
		{ address: deployment.zoltar, name: 'Zoltar' },
		{ address: deployment.securityPoolFactory, name: 'security-pool factory' },
		{ address: deployment.weth, name: 'WETH' },
	] as const

	for (const contract of contracts) {
		const code = await client.getCode({ address: contract.address, blockNumber: block.number })
		if (code === undefined || code === '0x') return { ...contract, deployed: false, block }
	}
	return { deployed: true }
}

export function createSystemDeploymentGate() {
	let verifiedDeployment: string | undefined
	return async (client: DeploymentReader, chainId: number, deployment: CoreDeployment): Promise<SystemDeploymentStatus> => {
		const deploymentKey = `${chainId.toString()}:${deployment.zoltar}:${deployment.securityPoolFactory}:${deployment.weth}`
		if (verifiedDeployment === deploymentKey) return { deployed: true }
		verifiedDeployment = undefined
		const status = await systemDeploymentStatus(client, deployment)
		if (status.deployed) verifiedDeployment = deploymentKey
		return status
	}
}

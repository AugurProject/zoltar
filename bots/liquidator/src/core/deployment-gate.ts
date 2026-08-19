import type { Address, Hex } from '@zoltar/bot-shared/ethereum'

type DeploymentReader = {
	getCode(parameters: { address: Address }): Promise<Hex | undefined>
}

type CoreDeployment = {
	securityPoolFactory: Address
	weth: Address
	zoltar: Address
}

export type SystemDeploymentStatus = { deployed: true } | { address: Address; deployed: false; name: string }

export async function systemDeploymentStatus(client: DeploymentReader, deployment: CoreDeployment): Promise<SystemDeploymentStatus> {
	const contracts = [
		{ address: deployment.zoltar, name: 'Zoltar' },
		{ address: deployment.securityPoolFactory, name: 'security-pool factory' },
		{ address: deployment.weth, name: 'WETH' },
	] as const

	for (const contract of contracts) {
		const code = await client.getCode({ address: contract.address })
		if (code === undefined || code === '0x') return { ...contract, deployed: false }
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

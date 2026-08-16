import { promises as fs } from 'node:fs'
import path from 'node:path'
import { getAddress } from '@zoltar/shared/ethereum'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function requiredString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`)
	return value
}

function requiredChainId(value: unknown) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new Error('network.chainId must be a positive safe integer')
	return value
}

function deploymentStepAddress(steps: unknown, id: string) {
	if (!Array.isArray(steps)) throw new Error('deploymentSteps must be an array')
	const step = steps.find(candidate => isRecord(candidate) && candidate.id === id)
	if (!isRecord(step)) throw new Error(`deploymentSteps must contain ${id}`)
	return getAddress(requiredString(step.address, `${id}.address`))
}

export function coreDeploymentFromManifest(candidate: unknown) {
	if (!isRecord(candidate) || !isRecord(candidate.network)) throw new Error('Core deployment manifest network is required')
	return {
		chainId: requiredChainId(candidate.network.chainId),
		chainName: requiredString(candidate.network.name, 'network.name'),
		id: requiredString(candidate.network.id, 'network.id'),
		proxyDeployer: deploymentStepAddress(candidate.deploymentSteps, 'proxyDeployer'),
		securityPoolFactory: deploymentStepAddress(candidate.deploymentSteps, 'securityPoolFactory'),
	}
}

export async function writeCoreDeploymentRegistry(output: string) {
	const repositoryRoot = path.resolve(import.meta.dir, '../../..')
	const manifestPaths = [path.join(repositoryRoot, 'docs/mainnet-deployment-addresses.json'), path.join(repositoryRoot, 'docs/sepolia-deployment-addresses.json')]
	const deployments = await Promise.all(
		manifestPaths.map(async manifestPath => {
			const candidate: unknown = JSON.parse(await fs.readFile(manifestPath, 'utf8'))
			return coreDeploymentFromManifest(candidate)
		}),
	)
	await fs.writeFile(output, `${JSON.stringify(deployments, undefined, 2)}\n`)
}

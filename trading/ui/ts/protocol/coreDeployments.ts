import { getAddress, isAddress } from '@zoltar/shared/ethereum'
import { defaultCoreDeploymentRpcUrls } from './coreDeploymentDefaults.ts'
import type { CoreDeployment } from './deployment.ts'

export function isKnownDefaultRpcUrl(rpcUrl: string) {
	let normalizedRpcUrl: string
	try {
		normalizedRpcUrl = new URL(rpcUrl).toString()
	} catch {
		return false
	}
	return Object.values(defaultCoreDeploymentRpcUrls).some(defaultRpcUrl => new URL(defaultRpcUrl).toString() === normalizedRpcUrl)
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function requiredString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.trim() === '') throw new Error(`${label} is required`)
	return value
}

function requiredAddress(value: unknown, label: string) {
	const address = requiredString(value, label)
	if (!isAddress(address)) throw new Error(`${label} must be a valid address`)
	return getAddress(address)
}

export function parseCoreDeployments(candidate: unknown): readonly CoreDeployment[] {
	if (!Array.isArray(candidate) || candidate.length === 0) throw new Error('Core deployment registry must contain at least one network')
	const deployments = candidate.map((value, index) => {
		if (!isRecord(value)) throw new Error(`Core deployment ${index.toString()} must be an object`)
		if (typeof value.chainId !== 'number' || !Number.isSafeInteger(value.chainId) || value.chainId <= 0) throw new Error(`Core deployment ${index.toString()} chainId must be a positive safe integer`)
		const chainId = value.chainId
		const rpcUrl = value.rpcUrl === undefined ? defaultCoreDeploymentRpcUrls[chainId] : value.rpcUrl
		if (rpcUrl === undefined) throw new Error(`Core deployment ${index.toString()} has no default RPC URL`)
		return {
			chainId,
			chainName: requiredString(value.chainName, `Core deployment ${index.toString()} chainName`),
			defaultRpcUrl: requiredString(rpcUrl, `Core deployment ${index.toString()} rpcUrl`),
			id: requiredString(value.id, `Core deployment ${index.toString()} id`),
			proxyDeployer: requiredAddress(value.proxyDeployer, `Core deployment ${index.toString()} proxyDeployer`),
			securityPoolFactory: requiredAddress(value.securityPoolFactory, `Core deployment ${index.toString()} securityPoolFactory`),
		}
	})
	const chainIds = new Set<number>()
	for (const deployment of deployments) {
		if (chainIds.has(deployment.chainId)) throw new Error(`Core deployment registry repeats chain ${deployment.chainId.toString()}`)
		chainIds.add(deployment.chainId)
	}
	return deployments
}

export async function loadCoreDeployments() {
	const response = await fetch('./core-deployments.json', { cache: 'no-store' })
	if (!response.ok) throw new Error(`Core deployment registry failed with HTTP ${response.status.toString()}`)
	const candidate: unknown = await response.json()
	return parseCoreDeployments(candidate)
}

import { getAddress, isAddress, type Address } from '@zoltar/shared/ethereum'

export type DeploymentConfiguration = Readonly<{
	chainId: number
	chainName: string
	rpcUrl: string
	securityPoolFactory: Address
	factory: Address
	router: Address
	feeBps: number
}>

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function requiredString(value: unknown, label: string) {
	if (typeof value !== 'string' || value.length === 0) throw new Error(`${label} is required`)
	return value
}

function requiredNumber(value: unknown, label: string) {
	if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error(`${label} must be a nonnegative integer`)
	return value
}

function requiredAddress(value: unknown, label: string) {
	const address = requiredString(value, label)
	if (!isAddress(address)) throw new Error(`${label} must be a valid address`)
	return getAddress(address)
}

export function parseDeploymentConfiguration(candidate: unknown): DeploymentConfiguration {
	if (!isRecord(candidate)) throw new Error('Deployment configuration must be an object')
	const network = isRecord(candidate.network) ? candidate.network : candidate
	const core = isRecord(candidate.core) ? candidate.core : candidate
	const trading = isRecord(candidate.trading) ? candidate.trading : candidate
	const feeBps = requiredNumber(trading.feeBps, 'feeBps')
	if (feeBps >= 10_000) throw new Error('feeBps must be below 10000')
	return {
		chainId: requiredNumber(network.chainId, 'chainId'),
		chainName: typeof network.chainName === 'string' && network.chainName.length > 0 ? network.chainName : `Chain ${requiredNumber(network.chainId, 'chainId')}`,
		rpcUrl: requiredString(network.rpcUrl, 'rpcUrl'),
		securityPoolFactory: requiredAddress(core.securityPoolFactory, 'securityPoolFactory'),
		factory: requiredAddress(trading.factory, 'factory'),
		router: requiredAddress(trading.router, 'router'),
		feeBps,
	}
}

export async function loadDeploymentConfiguration(): Promise<DeploymentConfiguration | undefined> {
	const response = await fetch('./deployment.json', { cache: 'no-store' })
	if (response.status === 404) return undefined
	if (!response.ok) throw new Error(`Deployment configuration failed with HTTP ${response.status}`)
	const candidate: unknown = await response.json()
	return candidate === null ? undefined : parseDeploymentConfiguration(candidate)
}

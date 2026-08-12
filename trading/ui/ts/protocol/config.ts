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

function requiredRpcUrl(value: unknown) {
	const rpcUrl = requiredString(value, 'rpcUrl')
	let parsed: URL
	try {
		parsed = new URL(rpcUrl)
	} catch (error) {
		if (error instanceof TypeError) throw new Error('rpcUrl must be a valid URL')
		throw error
	}
	const loopback = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost'
	if (parsed.protocol !== 'https:' && !(parsed.protocol === 'http:' && loopback)) throw new Error('rpcUrl must use HTTPS or loopback HTTP')
	if (parsed.username !== '' || parsed.password !== '') throw new Error('rpcUrl must not contain embedded credentials')
	return parsed.toString()
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
	const chainId = requiredNumber(network.chainId, 'chainId')
	if (chainId === 0) throw new Error('chainId must be positive')
	return {
		chainId,
		chainName: typeof network.chainName === 'string' && network.chainName.length > 0 ? network.chainName : `Chain ${chainId}`,
		rpcUrl: requiredRpcUrl(network.rpcUrl),
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

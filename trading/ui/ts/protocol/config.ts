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

type ConfigurationStorage = Pick<Storage, 'getItem' | 'setItem'>
const deploymentStorageKey = 'zoltar.trading.deployment.v1'

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

export function parseDeploymentSetupInput(input: Readonly<{ chainId: string; feeBps: string; rpcUrl: string }>) {
	if (!/^[1-9][0-9]*$/.test(input.chainId)) throw new Error('Chain ID must be a positive whole number')
	const chainId = Number(input.chainId)
	if (!Number.isSafeInteger(chainId)) throw new Error('Chain ID must be a positive safe integer')
	if (!/^[0-9]+$/.test(input.feeBps)) throw new Error('Trading fee must be a whole number from 0 to 9999 basis points')
	const feeBps = Number(input.feeBps)
	if (!Number.isSafeInteger(feeBps) || feeBps >= 10_000) throw new Error('Trading fee must be a whole number from 0 to 9999 basis points')
	return { chainId, feeBps, rpcUrl: requiredRpcUrl(input.rpcUrl) }
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
	if (candidate !== null) return parseDeploymentConfiguration(candidate)
	return typeof window === 'undefined' ? undefined : loadStoredDeploymentConfiguration(window.localStorage)
}

export function loadStoredDeploymentConfiguration(storage: Pick<ConfigurationStorage, 'getItem'>): DeploymentConfiguration | undefined {
	const raw = storage.getItem(deploymentStorageKey)
	if (raw === null) return undefined
	const candidate: unknown = JSON.parse(raw)
	return parseDeploymentConfiguration(candidate)
}

export function saveDeploymentConfiguration(configuration: DeploymentConfiguration, storage: Pick<ConfigurationStorage, 'setItem'> = window.localStorage) {
	storage.setItem(deploymentStorageKey, JSON.stringify(configuration))
}

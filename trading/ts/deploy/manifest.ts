import type { Address } from '@zoltar/shared/ethereum'

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

export function requireAddress(value: unknown, label: string): Address {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value)) throw new Error(`${label} must be an address`)
	return value.toLowerCase() as Address
}

function readManifestChainId(manifest: Record<string, unknown>) {
	const network = manifest.network
	const candidate = isRecord(network) ? network.chainId : manifest.chainId
	if (typeof candidate === 'number' && Number.isSafeInteger(candidate) && candidate >= 0) return BigInt(candidate)
	if (typeof candidate === 'string' && /^(?:0x[0-9a-fA-F]+|[0-9]+)$/.test(candidate)) return BigInt(candidate)
	throw new Error('Core deployment manifest does not contain a valid chain ID')
}

function readSecurityPoolFactory(manifest: Record<string, unknown>) {
	const direct = manifest.securityPoolFactory
	if (direct !== undefined) return requireAddress(direct, 'securityPoolFactory')
	const deploymentSteps = manifest.deploymentSteps
	if (Array.isArray(deploymentSteps)) {
		const factoryStep = deploymentSteps.find(step => isRecord(step) && step.id === 'securityPoolFactory')
		if (isRecord(factoryStep)) return requireAddress(factoryStep.address, 'deploymentSteps.securityPoolFactory.address')
	}
	const contracts = manifest.contracts
	if (isRecord(contracts)) {
		const candidate = contracts.SecurityPoolFactory ?? contracts.securityPoolFactory
		if (isRecord(candidate)) return requireAddress(candidate.address, 'contracts.SecurityPoolFactory.address')
		if (candidate !== undefined) return requireAddress(candidate, 'contracts.SecurityPoolFactory')
	}
	throw new Error('Core deployment manifest does not contain SecurityPoolFactory')
}

export function parseCoreDeploymentManifest(manifest: unknown) {
	if (!isRecord(manifest)) throw new Error('Core deployment manifest must be an object')
	return { chainId: readManifestChainId(manifest), securityPoolFactory: readSecurityPoolFactory(manifest) }
}

export function requireMatchingChain(configuredChainId: bigint, rpcChainId: bigint) {
	if (configuredChainId !== rpcChainId) throw new Error(`Core deployment chain ${configuredChainId} does not match RPC chain ${rpcChainId}`)
}

export function requireReceiptBlockNumber(value: unknown) {
	if (typeof value !== 'string' || !/^0x[0-9a-fA-F]+$/.test(value)) throw new Error('Deployment receipt is missing a valid block number')
	return BigInt(value).toString()
}

export function requireSafeChainId(chainId: bigint) {
	if (chainId < 0n || chainId > 9_007_199_254_740_991n) throw new Error('Chain ID must fit in a JavaScript safe integer')
	return Number.parseInt(chainId.toString(), 10)
}

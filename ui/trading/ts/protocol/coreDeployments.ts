import { getAddress, isAddress } from '@zoltar/core-shared/evm/ethereum'
import { defaultCoreDeploymentRpcUrls } from './coreDeploymentDefaults.js'
import type { CoreDeployment } from './deployment.js'
import { deploymentRegistryUnavailable } from '../copy/app.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import { getInfraContractAddresses, PROXY_DEPLOYER_ADDRESS } from '@zoltar/ui-statoblast-shared/protocol/deploymentHelpers.js'
import { parseGenesisOutcome } from '@zoltar/zoltar-shared/deployment/genesisUniverses'

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

function parseCoreDeployments(candidate: unknown): readonly CoreDeployment[] {
	if (!Array.isArray(candidate) || candidate.length === 0) throw new Error('Core deployment registry must contain at least one network')
	const deployments = candidate.map((value, index) => {
		if (!isRecord(value)) throw new Error(`Core deployment ${index.toString()} must be an object`)
		if (typeof value['chainId'] !== 'number' || !Number.isSafeInteger(value['chainId']) || value['chainId'] <= 0) throw new Error(`Core deployment ${index.toString()} chainId must be a positive safe integer`)
		const chainId = value['chainId']
		const genesisOutcome = parseGenesisOutcome(typeof value['genesisOutcome'] === 'string' ? value['genesisOutcome'] : undefined)
		if (genesisOutcome === undefined) throw new Error(`Core deployment ${index.toString()} genesisOutcome must be yes or no`)
		const rpcUrl = value['rpcUrl'] === undefined ? defaultCoreDeploymentRpcUrls[chainId] : value['rpcUrl']
		if (rpcUrl === undefined) throw new Error(`Core deployment ${index.toString()} has no default RPC URL`)
		return {
			chainId,
			genesisOutcome,
			chainName: requiredString(value['chainName'], `Core deployment ${index.toString()} chainName`),
			defaultRpcUrl: requiredString(rpcUrl, `Core deployment ${index.toString()} rpcUrl`),
			id: requiredString(value['id'], `Core deployment ${index.toString()} id`),
			proxyDeployer: requiredAddress(value['proxyDeployer'], `Core deployment ${index.toString()} proxyDeployer`),
			securityPoolFactory: requiredAddress(value['securityPoolFactory'], `Core deployment ${index.toString()} securityPoolFactory`),
			zoltar: requiredAddress(value['zoltar'], `Core deployment ${index.toString()} zoltar`),
		}
	})
	const identities = new Set<string>()
	for (const deployment of deployments) {
		const identity = `${deployment.chainId}:${deployment.genesisOutcome}`
		if (identities.has(identity)) throw new Error(`Core deployment registry repeats chain ${deployment.chainId.toString()} genesis ${deployment.genesisOutcome}`)
		identities.add(identity)
	}
	return deployments
}

export async function loadCoreDeployments() {
	const backend = getActiveBackend()
	if (backend.id === 'simulation') {
		return [
			{
				chainId: backend.profile.chain.id,
				genesisOutcome: backend.profile.genesisOutcome ?? 'yes',
				chainName: backend.profile.displayName,
				defaultRpcUrl: 'http://127.0.0.1/',
				id: 'simulation',
				proxyDeployer: PROXY_DEPLOYER_ADDRESS,
				securityPoolFactory: getInfraContractAddresses(backend.profile).securityPoolFactory,
				zoltar: getInfraContractAddresses(backend.profile).zoltar,
			},
		] satisfies readonly CoreDeployment[]
	}
	// A failed download is a connection problem, not a chain or RPC one, so it says that in user terms.
	let response: Response
	try {
		response = await fetch('./core-deployments.json', { cache: 'no-store', signal: AbortSignal.timeout(30_000) })
	} catch (error) {
		throw new Error(deploymentRegistryUnavailable, { cause: error })
	}
	if (!response.ok) throw new Error(deploymentRegistryUnavailable)
	const candidate: unknown = await response.json()
	return parseCoreDeployments(candidate).filter(deployment => deployment.genesisOutcome === (backend.profile.genesisOutcome ?? 'yes'))
}

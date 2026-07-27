import { getAddress, isAddress, keccak256, type Address, type Hex } from '@zoltar/shared/ethereum'

export type DeploymentRole = 'coordinator' | 'executor' | 'open-oracle' | 'token' | 'uniswap-factory' | 'uniswap-quoter' | 'uniswap-router' | 'weth'

export type DeploymentManifest = {
	chainId: number
	contracts: readonly {
		address: Address
		role: DeploymentRole
		runtimeCodeHash: Hex
	}[]
	network: 'mainnet' | 'sepolia'
	version: 1
}

const roles = new Set<DeploymentRole>(['coordinator', 'executor', 'open-oracle', 'token', 'uniswap-factory', 'uniswap-quoter', 'uniswap-router', 'weth'])

function record(value: unknown, description: string) {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error(`${description} must be an object`)
	return value as Record<string, unknown>
}

export function parseDeploymentManifest(value: unknown): DeploymentManifest {
	const manifest = record(value, 'Deployment manifest')
	if (manifest['version'] !== 1) throw new Error('Deployment manifest version must be 1')
	if (manifest['network'] !== 'mainnet' && manifest['network'] !== 'sepolia') throw new Error('Deployment manifest network must be mainnet or sepolia')
	if (typeof manifest['chainId'] !== 'number' || !Number.isSafeInteger(manifest['chainId']) || manifest['chainId'] <= 0) throw new Error('Deployment manifest chainId must be a positive integer')
	if (!Array.isArray(manifest['contracts']) || manifest['contracts'].length === 0) throw new Error('Deployment manifest must contain contracts')
	const identities = new Set<string>()
	const contracts = manifest['contracts'].map(value => {
		const contract = record(value, 'Deployment contract')
		if (typeof contract['role'] !== 'string' || !roles.has(contract['role'] as DeploymentRole)) throw new Error('Deployment contract role is unsupported')
		if (typeof contract['address'] !== 'string' || !isAddress(contract['address'])) throw new Error('Deployment contract address is invalid')
		if (typeof contract['runtimeCodeHash'] !== 'string' || !/^0x[0-9a-fA-F]{64}$/.test(contract['runtimeCodeHash'])) throw new Error('Deployment runtime code hash must be bytes32')
		const role = contract['role'] as DeploymentRole
		const address = getAddress(contract['address'])
		const identity = `${role}:${address.toLowerCase()}`
		if (identities.has(identity)) throw new Error(`Duplicate deployment identity: ${identity}`)
		identities.add(identity)
		return { address, role, runtimeCodeHash: contract['runtimeCodeHash'].toLowerCase() as Hex }
	})
	return {
		chainId: manifest['chainId'],
		contracts,
		network: manifest['network'],
		version: 1,
	}
}

export async function authenticateDeploymentManifest(
	manifest: DeploymentManifest,
	parameters: {
		chainId: number
		network: DeploymentManifest['network']
		readCode: (address: Address) => Promise<Hex | undefined>
		required: readonly { address: Address; role: DeploymentRole }[]
	},
) {
	if (manifest.chainId !== parameters.chainId || manifest.network !== parameters.network) throw new Error(`Deployment manifest targets ${manifest.network} chain ${manifest.chainId.toString()}`)
	for (const requirement of parameters.required) {
		const entry = manifest.contracts.find(candidate => candidate.role === requirement.role && candidate.address.toLowerCase() === requirement.address.toLowerCase())
		if (entry === undefined) throw new Error(`Deployment manifest is missing ${requirement.role} ${requirement.address}`)
		const code = await parameters.readCode(requirement.address)
		if (code === undefined || code === '0x') throw new Error(`Authenticated ${requirement.role} ${requirement.address} has no runtime bytecode`)
		if (keccak256(code).toLowerCase() !== entry.runtimeCodeHash.toLowerCase()) throw new Error(`Authenticated ${requirement.role} ${requirement.address} runtime bytecode hash does not match the manifest`)
	}
}

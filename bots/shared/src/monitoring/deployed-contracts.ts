import type { Address, Hex } from '../ethereum.js'

type DeploymentReader = {
	getCode(parameters: { address: Address; blockNumber?: bigint }): Promise<Hex | undefined>
	getChainId(): Promise<number>
}

export async function requireDeployedContracts(client: DeploymentReader, contracts: readonly { address: Address; name: string }[], blockNumber?: bigint) {
	const codes = await Promise.all(contracts.map(contract => client.getCode({ address: contract.address, ...(blockNumber === undefined ? {} : { blockNumber }) })))
	const missing = contracts.filter((_, index) => codes[index] === undefined || codes[index] === '0x')
	if (missing.length === 0) return
	const chainId = await client.getChainId()
	const at = blockNumber === undefined ? 'latest block' : `block ${blockNumber.toString()}`
	const error = new Error(`No contract code on RPC chain ${chainId.toString()} at ${at}: ${missing.map(contract => `${contract.name} (${contract.address})`).join(', ')}. Verify the selected network, RPC synchronization, and deployment addresses before retrying.`)
	missingDeployments.set(error, { chainId, contracts: missing })
	throw error
}

const verifiedDeployments = new WeakMap<DeploymentReader, Set<string>>()

/**
 * Verifies each contract once per client. Contract code does not disappear from a canonical chain,
 * so a successful check is not repeated on later polls; a failure is rechecked every time.
 */
export async function requireDeployedContractsOnce(client: DeploymentReader, contracts: readonly { address: Address; name: string }[], blockNumber?: bigint) {
	const verified = verifiedDeployments.get(client) ?? new Set<string>()
	const unverified = contracts.filter(contract => !verified.has(contract.address.toLowerCase()))
	if (unverified.length === 0) return
	await requireDeployedContracts(client, unverified, blockNumber)
	for (const contract of unverified) verified.add(contract.address.toLowerCase())
	verifiedDeployments.set(client, verified)
}

export type MissingContractDeployment = {
	chainId: number
	contracts: readonly { address: Address; name: string }[]
}

const missingDeployments = new WeakMap<Error, MissingContractDeployment>()

export function missingContractDeployment(error: unknown): MissingContractDeployment | undefined {
	return error instanceof Error ? missingDeployments.get(error) : undefined
}

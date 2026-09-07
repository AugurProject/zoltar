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
	throw new Error(`No contract code on RPC chain ${chainId.toString()} at ${at}: ${missing.map(contract => `${contract.name} (${contract.address})`).join(', ')}. Verify the selected network, RPC synchronization, and deployment addresses before retrying.`)
}

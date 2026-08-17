import { createPublicClient, type Abi, type Address, type Chain, type PublicClient, type Transport } from '@zoltar/shared/ethereum'
import { custom, http, RpcError, type TransportOptions } from './rpc-transport.ts'
import type { createRpcEndpointPool } from './rpc-resilience.ts'

export {
	createPublicClient,
	createWalletClient,
	defineChain,
	mainnet,
	publicActions,
} from '@zoltar/shared/ethereum'
export type { PublicActions, PublicClient, WalletClient } from '@zoltar/shared/ethereum'
export { custom, http, RpcError, type TransportOptions }

export async function readContractAtBlock(client: Pick<PublicClient, 'readContract'>, parameters: { abi: Abi; address: Address; args?: readonly unknown[] | undefined; functionName: string }, blockNumber: bigint): Promise<unknown> {
	return await client.readContract({ ...parameters, blockNumber })
}

export async function getBalanceAtBlock(transport: Transport, parameters: { address: Address; blockNumber: bigint }) {
	return await createPublicClient({ transport }).getBalance(parameters)
}

export async function getTransactionCountAtBlock(transport: Transport, parameters: { address: Address; blockNumber: bigint }) {
	return await createPublicClient({ transport }).getTransactionCount(parameters)
}

const contextualActionMethods = new Map<PropertyKey, string>([
	['getBalance', 'eth_getBalance'],
	['getBlock', 'eth_getBlockByNumber'],
	['getBlockNumber', 'eth_blockNumber'],
	['getChainId', 'eth_chainId'],
	['getCode', 'eth_getCode'],
	['getLogs', 'eth_getLogs'],
	['getTransaction', 'eth_getTransactionByHash'],
	['getTransactionCount', 'eth_getTransactionCount'],
	['getTransactionReceipt', 'eth_getTransactionReceipt'],
	['readContract', 'eth_call'],
])

export function createContextualPublicClient<const TChain extends Chain>(chain: TChain, pool: ReturnType<typeof createRpcEndpointPool>, rpcUrl?: string) {
	const client = createPublicClient({ chain, transport: rpcUrl === undefined ? pool.transport : pool.transportFor(rpcUrl) })
	return new Proxy(client, {
		get(target, property, receiver) {
			const method = contextualActionMethods.get(property)
			if (method === undefined) return Reflect.get(target, property, receiver)
			return (...args: unknown[]) =>
				pool.contextualRequest(
					method,
					async transport => {
						const requestClient = createPublicClient({ chain, transport })
						const action = Reflect.get(requestClient, property, requestClient)
						if (typeof action !== 'function') throw new Error(`Public client action ${String(property)} is unavailable`)
						return await action.apply(requestClient, args)
					},
					rpcUrl,
				)
		},
	})
}

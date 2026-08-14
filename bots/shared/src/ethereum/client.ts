import { createPublicClient, type Abi, type Address, type Transport } from '@zoltar/shared/ethereum'
import { custom, http, RpcError, type TransportOptions } from './rpc-transport.ts'

export {
	createPublicClient,
	createWalletClient,
	defineChain,
	mainnet,
	publicActions,
} from '@zoltar/shared/ethereum'
export type { PublicActions, PublicClient, WalletClient } from '@zoltar/shared/ethereum'
export { custom, http, RpcError, type TransportOptions }

export async function readContractAtBlock(transport: Transport, parameters: { abi: Abi; address: Address; args?: readonly unknown[] | undefined; functionName: string }, blockNumber: bigint): Promise<unknown> {
	return await createPublicClient({ transport }).readContract({ ...parameters, blockNumber })
}

export async function getBalanceAtBlock(transport: Transport, parameters: { address: Address; blockNumber: bigint }) {
	return await createPublicClient({ transport }).getBalance(parameters)
}

export async function getTransactionCountAtBlock(transport: Transport, parameters: { address: Address; blockNumber: bigint }) {
	return await createPublicClient({ transport }).getTransactionCount(parameters)
}

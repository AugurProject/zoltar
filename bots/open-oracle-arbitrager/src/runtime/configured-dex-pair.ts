import type { Configuration } from '#config/configuration'
import { constantProductPairAbi } from '#contracts/abi'
import type { Address, Chain, PublicClient, Transport } from '@zoltar/bot-shared/ethereum'
import { readConstantProductPairWithQuorum } from '@zoltar/bot-shared/monitoring/constant-product-markets'
import { rpcQuorumRequirement } from '@zoltar/bot-shared/monitoring/rpc-quorum-policy'

type ContextualRpcRead = <Value>(method: string, request: (requestClient: PublicClient<Transport, Chain>) => Promise<Value>, explicitRpcUrl?: string | undefined) => Promise<Value>

/** Reads a configured constant-product pair at a canonical block through every quorum endpoint via the operator's contextual RPC reader. */
export function createConfiguredDexPairReader(config: Pick<Configuration, 'connectivity' | 'network' | 'quorumRpcUrls'>, contextualRpcRead: ContextualRpcRead) {
	return async (pair: Address, block: Readonly<{ hash: `0x${string}`; number: bigint }>) =>
		readConstantProductPairWithQuorum({
			block,
			chainId: config.network.chain.id,
			endpoints: [config.connectivity.readRpcUrl, ...config.quorumRpcUrls],
			pair,
			readBlock: async (endpoint, canonicalBlockNumber) =>
				await contextualRpcRead(
					'eth_getBlockByNumber',
					async requestClient => {
						const endpointBlock = await requestClient.getBlock({ blockNumber: canonicalBlockNumber })
						return { hash: endpointBlock.hash, number: endpointBlock.number, timestamp: endpointBlock.timestamp }
					},
					endpoint,
				),
			readPairAtBlock: async (endpoint, quorumPair, canonicalBlockHash) => {
				const [token0, token1, reserves] = await contextualRpcRead(
					'eth_call',
					requestClient =>
						Promise.all([
							requestClient.readContract({ address: quorumPair, abi: constantProductPairAbi, blockHash: canonicalBlockHash, functionName: 'token0' }),
							requestClient.readContract({ address: quorumPair, abi: constantProductPairAbi, blockHash: canonicalBlockHash, functionName: 'token1' }),
							requestClient.readContract({ address: quorumPair, abi: constantProductPairAbi, blockHash: canonicalBlockHash, functionName: 'getReserves' }),
						]),
					endpoint,
				)
				return { reserve0: reserves[0], reserve1: reserves[1], token0, token1 }
			},
			requirement: rpcQuorumRequirement(),
		})
}

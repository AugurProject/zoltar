import type { marketConfigurations } from '#core/candidate-selection'
import { createPublicClient, getAddress, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { constantProductPairAbi, observeConstantProductMarkets, readConstantProductPairWithQuorum, requireCurrentConstantProductMarketEvidence } from '@zoltar/bot-shared/monitoring/constant-product-markets'
import { readEndpoints, type LiquidatorRuntime } from './liquidator-runtime.ts'

type MarketConfiguration = ReturnType<typeof marketConfigurations>[number]

/** Reads one configured DEX pair at `block` across the configured read endpoints under the RPC quorum requirement. */
function readConfiguredDexPair(runtime: LiquidatorRuntime, pair: Address, block: Readonly<{ hash: Hash; number: bigint }>) {
	const { settings } = runtime
	return readConstantProductPairWithQuorum({
		block,
		chainId: settings.network.chainId,
		endpoints: readEndpoints(settings),
		pair,
		readBlock: async (endpoint, blockNumber) => {
			const pairClient = createPublicClient({ chain: runtime.chain, transport: runtime.readPool.transportFor(endpoint) })
			const endpointBlock = await pairClient.getBlock({ blockNumber })
			return { hash: endpointBlock.hash, number: endpointBlock.number, timestamp: endpointBlock.timestamp }
		},
		readPairAtBlock: async (endpoint, quorumPair, blockHash) => {
			const pairClient = createPublicClient({ chain: runtime.chain, transport: runtime.readPool.transportFor(endpoint) })
			const [token0, token1, reserves] = await Promise.all([
				pairClient.readContract({ abi: constantProductPairAbi, address: quorumPair, blockHash, functionName: 'token0' }),
				pairClient.readContract({ abi: constantProductPairAbi, address: quorumPair, blockHash, functionName: 'token1' }),
				pairClient.readContract({ abi: constantProductPairAbi, address: quorumPair, blockHash, functionName: 'getReserves' }),
			])
			return { reserve0: reserves[0], reserve1: reserves[1], token0, token1 }
		},
		requirement: settings.connectivity.rpcQuorum,
	})
}

export async function observeConfiguredDex(runtime: LiquidatorRuntime, configuration: MarketConfiguration, block: { hash: Hash; number: bigint; timestamp: bigint }) {
	return observeConstantProductMarkets(configuration, getAddress(configuration.assetAddress), runtime.settings.deployment.weth, async pair => readConfiguredDexPair(runtime, getAddress(pair), block))
}

export async function requireCurrentDexEvidence(runtime: LiquidatorRuntime, configuration: MarketConfiguration, estimate: Parameters<typeof requireCurrentConstantProductMarketEvidence>[3]) {
	return requireCurrentConstantProductMarketEvidence(configuration, getAddress(configuration.assetAddress), runtime.settings.deployment.weth, estimate, (pair, block) => readConfiguredDexPair(runtime, pair, block))
}

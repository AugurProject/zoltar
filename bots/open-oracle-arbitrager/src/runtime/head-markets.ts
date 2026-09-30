import { loadBalances } from '#execution/balances'
import { loadApprovedUniverses } from '#monitoring/approved-universes'
import { poolsForTokens } from '#monitoring/execution-pools'
import { discoverTokenPools, loadTokenMarkets } from '#monitoring/market-monitor'
import { zeroAddress } from '@zoltar/bot-shared/ethereum'
import { observeConstantProductMarkets } from '@zoltar/bot-shared/monitoring/constant-product-markets'
import { discardDexMarketObservations } from '@zoltar/bot-shared/monitoring/market-consensus'
import type { OperatorContext, OperatorRuntime, ScanBlock } from './operator-runtime.ts'

/** DEX evidence read at a head that turns out to be non-canonical is discarded before the failure propagates. */
export function discardDexEvidence(context: Pick<OperatorContext, 'state'>, error: unknown): never {
	const { state } = context
	state.marketObservations = discardDexMarketObservations(state.marketObservations ?? [])
	state.marketConsensus = undefined
	throw error
}

/**
 * Loads the configured DEX markets, approved universes, execution tokens, pools, token markets, and wallet balances
 * pinned to the head block. Returns `undefined` as soon as `stopHead` reports a shutdown between stages.
 */
export async function loadHeadMarkets(runtime: OperatorRuntime, context: OperatorContext, block: ScanBlock, stopHead: () => boolean) {
	const { config, state } = context
	const blockNumber = block.number
	const [configuredDexMarkets, { universes, approvedTokens }] = await Promise.all([
		observeConstantProductMarkets(config.centralizedMarkets, config.network.rep, config.network.weth, async pair => context.readConfiguredDexPair(pair, { hash: block.hash, number: blockNumber })).catch(error => discardDexEvidence(context, error)),
		loadApprovedUniverses(runtime.readClients, config, blockNumber),
	])
	if (stopHead()) return undefined
	state.universes = universes
	const observedTokens = [...runtime.reports.values()].flatMap(report => [report.latest.game.token1, report.latest.game.token2]).filter(address => address !== zeroAddress && address.toLowerCase() !== config.network.weth.toLowerCase())
	const { executionTokens, monitoringTokens: discoveredTokens } = await runtime.catalogForScan(config.tokenAddresses, [...universes.map(universe => universe.repToken), ...observedTokens], approvedTokens)
	if (stopHead()) return undefined
	state.tokenAddresses = [...executionTokens]
	const discoveredPools = await discoverTokenPools(runtime.client, {
		blockNumber,
		chainId: config.network.chain.id,
		factory: config.router === undefined ? undefined : config.network.factory,
		multicall3: config.network.multicall3,
		tokens: discoveredTokens,
		weth: config.network.weth,
	})
	if (stopHead()) return undefined
	const pools = await poolsForTokens(runtime.client, config, discoveredPools, blockNumber)
	const [tokenMarkets, balances] = await Promise.all([
		loadTokenMarkets(runtime.client, {
			blockNumber,
			explorerUrl: config.network.explorerUrl,
			metadataCache: runtime.tokenMetadataCache,
			multicall3: config.network.multicall3,
			pools: discoveredPools,
			wallet: runtime.wallet?.account.address,
			weth: config.network.weth,
		}),
		loadBalances(runtime.client, runtime.wallet, config, discoveredTokens, pools, blockNumber),
	])
	if (stopHead()) return undefined
	state.tokenMarkets = tokenMarkets
	state.marketAvailability = pools.length === 0 ? { kind: 'no-execution-pools', chainId: config.network.chain.id } : undefined
	return { balances, configuredDexMarkets, executionTokens, pools, tokenMarkets }
}

export type HeadMarkets = NonNullable<Awaited<ReturnType<typeof loadHeadMarkets>>>

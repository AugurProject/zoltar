import type { DiscoveryRun } from './discovery-context.ts'
import { hasCode } from './discovery-graph.ts'
import { canonicalDiscoveryIssues, formatDiscoveryWarnings } from './discovery-coverage.ts'
import type { DiscoveryIssue } from '../operations/types.ts'
import { canonicalUniswapDeployment } from '@zoltar/bot-shared/config/canonical-deployment'
import * as abis from '@zoltar/bot-shared/contracts/abi'
import { bigintToSafeNumber, getAddress, zeroAddress, type Address, type Hash } from '@zoltar/bot-shared/ethereum'
import { requireDeployedContracts } from '@zoltar/bot-shared/monitoring/deployed-contracts'
import { sameAddress } from '@zoltar/core-shared/evm/address'
import { discoverUniverseUniswap } from './discovery-uniswap.ts'

import type { AuctionSnapshot, EcosystemSnapshot, OracleGameSnapshot, PairSnapshot, PoolSnapshot, TokenInventory, UniverseSnapshot } from '../operations/types.ts'
import { DISCOVERY_RPC_CONCURRENCY, drainConcurrent, limitDiscoveryConcurrency, mapWithConcurrency, requirePositiveLimit } from './discovery-client.ts'
import { limitsWithDefaults, requireAggregateDiscoveryEnvelope, type EcosystemDiscoveryContext } from './discovery-context.ts'
import { relevantTokenSpenders } from './discovery-escalation.ts'

import { assertCanonicalPairGraph, requireGraphEdge } from './discovery-graph.ts'

import { discoverShareInventory, trustedIndexedReportsForDiscovery } from './discovery-share-inventory.ts'

import { cloneImmutableTopologyData, emptyImmutableTopologyData, IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION, type ImmutableTopologyData } from './topology-schema.ts'
import { discoverUniverses } from './discovery-universes.ts'
import { discoverQuestions } from './discovery-questions.ts'
import { discoverPools } from './discovery-pools.ts'

async function immutableTopologyForAnchor(context: EcosystemDiscoveryContext, block: { hash: Hash; number: bigint }) {
	const cached = context.topologyCache
	if (cached === undefined) return { reset: true, topology: emptyImmutableTopologyData() }
	const cachedBlockNumber = BigInt(cached.anchor.blockNumber)
	if (cachedBlockNumber > block.number) {
		return { reset: true, topology: emptyImmutableTopologyData() }
	}
	if (cachedBlockNumber === block.number) {
		return cached.anchor.blockHash.toLowerCase() === block.hash.toLowerCase() ? { reset: false, topology: cloneImmutableTopologyData(cached) } : { reset: true, topology: emptyImmutableTopologyData() }
	}
	const cachedBlock = await context.client.getBlock({ blockNumber: cachedBlockNumber })
	if (cachedBlock.hash == null || cachedBlock.number !== cachedBlockNumber || cachedBlock.hash.toLowerCase() !== cached.anchor.blockHash.toLowerCase()) {
		return { reset: true, topology: emptyImmutableTopologyData() }
	}
	return { reset: false, topology: cloneImmutableTopologyData(cached) }
}

async function authenticateConfiguredGraph(context: EcosystemDiscoveryContext, blockNumber: bigint) {
	const { client, deployments } = context
	const requiredRoots = ['zoltar', 'questionData', 'securityPoolFactory', 'securityPoolForker', 'openOracle', 'weth'] as const
	await requireDeployedContracts(
		client,
		requiredRoots.map(name => ({ name, address: deployments[name] })),
		blockNumber,
	)
	const [forkerZoltar, tradingFactoryCode, tradingRouterCode] = await drainConcurrent([
		client.readContract({ abi: abis.securityPoolForkerAbi, address: deployments.securityPoolForker, blockNumber, functionName: 'zoltar' }),
		client.getCode({ address: deployments.tradingFactory, blockNumber }),
		client.getCode({ address: deployments.tradingRouter, blockNumber }),
	])
	requireGraphEdge(getAddress(forkerZoltar), deployments.zoltar, 'SecurityPoolForker Zoltar edge')
	const [factory, router] = [hasCode(tradingFactoryCode), hasCode(tradingRouterCode)]
	if (router && !factory) throw new Error('Configured trading router exists without its factory')
	if (!factory) return { factory, router }
	const tradingSecurityPoolFactory = await client.readContract({ abi: abis.twoWayConstantProductFactoryAbi, address: deployments.tradingFactory, blockNumber, functionName: 'securityPoolFactory' })
	requireGraphEdge(getAddress(tradingSecurityPoolFactory), deployments.securityPoolFactory, 'Trading factory security-pool-factory edge')
	if (router) {
		const routerFactory = await client.readContract({ abi: abis.twoWayConstantProductRouterAbi, address: deployments.tradingRouter, blockNumber, functionName: 'factory' })
		requireGraphEdge(getAddress(routerFactory), deployments.tradingFactory, 'Trading router factory edge')
	}
	return { factory, router }
}

async function discoverPairs(context: EcosystemDiscoveryContext, pools: readonly PoolSnapshot[], blockNumber: bigint, topology: ImmutableTopologyData, mutation: DiscoveryRun['mutation']) {
	const { client, deployments, wallet } = context
	const pairs: PairSnapshot[] = []
	for (const pool of pools) {
		const pairCacheKey = pool.address.toLowerCase()
		const cachedPair = topology.pairsByPool[pairCacheKey]
		const rawPair = cachedPair ?? (await client.readContract({ abi: abis.twoWayConstantProductFactoryAbi, address: deployments.tradingFactory, args: [pool.address], blockNumber, functionName: 'getPair' }))
		if (rawPair === zeroAddress) continue
		if (cachedPair === undefined) mutation.changed = true
		const address = getAddress(rawPair)
		const [status, feeBps, reserves, effectiveReserves, totalSupply, walletLiquidity, pairFactory, pairPool, pairShareToken, pairUniverseId, pairQuestionId] = await drainConcurrent([
			client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'tradingStatus' }),
			client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'feeBps' }),
			client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'getReserves' }),
			client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'getEffectiveReserves' }),
			client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'totalSupply' }),
			wallet === undefined ? Promise.resolve(0n) : client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, args: [wallet], blockNumber, functionName: 'balanceOf' }),
			cachedPair === undefined ? client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'factory' }) : Promise.resolve(deployments.tradingFactory),
			cachedPair === undefined ? client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'securityPool' }) : Promise.resolve(pool.address),
			cachedPair === undefined ? client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'shareToken' }) : Promise.resolve(pool.shareToken),
			cachedPair === undefined ? client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'universeId' }) : Promise.resolve(BigInt(pool.universeId)),
			cachedPair === undefined ? client.readContract({ abi: abis.twoWayConstantProductPairAbi, address, blockNumber, functionName: 'questionId' }) : Promise.resolve(BigInt(pool.questionId)),
		])
		assertCanonicalPairGraph({
			configuredFactory: deployments.tradingFactory,
			pair: address,
			pairFactory: getAddress(pairFactory),
			pairPool: getAddress(pairPool),
			pairQuestionId: pairQuestionId.toString(),
			pairShareToken: getAddress(pairShareToken),
			pairUniverseId: pairUniverseId.toString(),
			pool: pool.address,
			poolQuestionId: pool.questionId,
			poolShareToken: pool.shareToken,
			poolUniverseId: pool.universeId,
		})
		topology.pairsByPool[pairCacheKey] = address
		pairs.push({
			address,
			effectiveNoReserve: effectiveReserves[1].toString(),
			effectiveYesReserve: effectiveReserves[0].toString(),
			feeBps: bigintToSafeNumber(feeBps),
			noReserve: reserves[1].toString(),
			pool: pool.address,
			shareToken: pool.shareToken,
			status: bigintToSafeNumber(status),
			totalSupply: totalSupply.toString(),
			universeId: pool.universeId,
			walletLiquidity: walletLiquidity.toString(),
			yesReserve: reserves[0].toString(),
		})
	}
	return pairs
}

async function discoverTokenInventory(context: EcosystemDiscoveryContext, universes: readonly UniverseSnapshot[], pools: readonly PoolSnapshot[], blockNumber: bigint) {
	const { client, deployments, wallet } = context
	if (wallet === undefined) return []
	const addresses = new Map<string, Address>()
	addresses.set(deployments.weth.toLowerCase(), deployments.weth)
	for (const universe of universes) addresses.set(universe.repToken.toLowerCase(), universe.repToken)
	const tokens: TokenInventory[] = []
	for (const address of addresses.values()) {
		const [balance, openOracleCredit, openOracleInternalAllowanceToSelf] = await drainConcurrent([
			client.readContract({ abi: abis.erc20Abi, address, args: [wallet], blockNumber, functionName: 'balanceOf' }),
			client.readContract({ abi: abis.openOracleAbi, address: deployments.openOracle, args: [wallet, address], blockNumber, functionName: 'tokenHolder' }),
			client.readContract({ abi: abis.openOracleAbi, address: deployments.openOracle, args: [wallet, wallet, address], blockNumber, functionName: 'internalAllowance' }),
		])
		const allowances: Record<string, string> = {}
		const spenders = relevantTokenSpenders(deployments, pools, address)
		if (deployments.uniswapV3Factory !== undefined || context.discoverGenesisDeployment) spenders.push(canonicalUniswapDeployment(await client.getChainId()).router)
		for (const spender of spenders) {
			allowances[spender] = (await client.readContract({ abi: abis.erc20Abi, address, args: [wallet, spender], blockNumber, functionName: 'allowance' })).toString()
		}
		tokens.push({
			address,
			allowances,
			balance: balance.toString(),
			openOracleCredit: openOracleCredit.toString(),
			openOracleInternalAllowanceToSelf: openOracleInternalAllowanceToSelf.toString(),
			symbol: context.tokenSymbols?.[address.toLowerCase()] ?? (sameAddress(address, deployments.weth) ? 'WETH' : 'REP'),
		})
	}
	return tokens
}

async function discoverLpInventory(context: EcosystemDiscoveryContext, pairs: readonly PairSnapshot[], blockNumber: bigint) {
	const wallet = context.wallet
	if (wallet === undefined) return []
	return await mapWithConcurrency(pairs, DISCOVERY_RPC_CONCURRENCY, async pair => ({
		allowanceToRouter: (await context.client.readContract({ abi: abis.twoWayConstantProductPairAbi, address: pair.address, args: [wallet, context.deployments.tradingRouter], blockNumber, functionName: 'allowance' })).toString(),
		balance: pair.walletLiquidity,
		pair: pair.address,
	}))
}

function authenticatedAuctionRefundGeneration(context: EcosystemDiscoveryContext, auction: Address, pendingAttoEth: bigint) {
	const indexed = context.indexedAuctionRefunds?.[auction.toLowerCase()]
	return pendingAttoEth > 0n && indexed !== undefined && BigInt(indexed.pendingAttoEth) === pendingAttoEth ? indexed.generation : undefined
}

async function discoverAuctions(context: EcosystemDiscoveryContext, pools: readonly PoolSnapshot[], blockNumber: bigint): Promise<AuctionSnapshot[]> {
	const auctions: AuctionSnapshot[] = []
	for (const pool of pools) {
		if (pool.truthAuction === zeroAddress) continue
		const started = await context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'auctionStarted' })
		const [minimumBid, finalized, pendingRefund, clearing, storedClearingTick, underfunded, underfundedWinningAttoEth] =
			started === 0n
				? [0n, false, 0n, [false, 0n, 0n, 0n] as const, 0n, false, 0n]
				: await drainConcurrent([
						context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'minBidSizeAttoEth' }),
						context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'finalized' }),
						context.wallet === undefined ? Promise.resolve(0n) : context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, args: [context.wallet], blockNumber, functionName: 'pendingEthRefundsAttoEth' }),
						context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'computeClearing' }),
						context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'clearingTick' }),
						context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'underfunded' }),
						context.client.readContract({ abi: abis.uniformPriceDualCapBatchAuctionAbi, address: pool.truthAuction, blockNumber, functionName: 'underfundedWinningAttoEth' }),
					])
		const pendingEthRefundGeneration = authenticatedAuctionRefundGeneration(context, pool.truthAuction, pendingRefund)
		auctions.push({
			address: pool.truthAuction,
			bids: [...(context.indexedAuctionBids?.[pool.truthAuction.toLowerCase()] ?? [])],
			endTime: (started + 7n * 24n * 60n * 60n).toString(),
			finalized,
			hasClearingPrice: finalized ? !underfunded || underfundedWinningAttoEth > 0n : clearing[0],
			clearingTick: (finalized ? storedClearingTick : clearing[1]).toString(),
			minimumBidAttoEth: minimumBid.toString(),
			pendingEthRefund: pendingRefund.toString(),
			...(pendingEthRefundGeneration === undefined ? {} : { pendingEthRefundGeneration }),
			pool: pool.address,
			startTime: started.toString(),
			underfunded,
			underfundedWinningAttoEth: underfundedWinningAttoEth.toString(),
		})
	}
	return auctions
}

async function verifyIndexedReports(context: EcosystemDiscoveryContext, blockNumber: bigint) {
	const verified: OracleGameSnapshot[] = []
	for (const report of context.indexedReports ?? []) {
		if (!sameAddress(report.openOracle, context.deployments.openOracle)) continue
		const stateHash = await context.client.readContract({ abi: abis.openOracleAbi, address: report.openOracle, args: [BigInt(report.reportId)], blockNumber, functionName: 'oracleGame' })
		if (stateHash.toLowerCase() !== report.stateHash.toLowerCase()) continue
		const timestampClock = (report.flags & 1) !== 0
		const settleAt = BigInt(report.reportTimestamp) + BigInt(report.settlementTime)
		const disputeAt = BigInt(report.reportTimestamp) + BigInt(report.disputeDelay)
		const verifiedReport: OracleGameSnapshot = { ...report, stateHash }
		if (timestampClock) {
			verifiedReport.disputeAfterTimestamp = disputeAt.toString()
			verifiedReport.disputeBeforeTimestamp = settleAt.toString()
			verifiedReport.settleAfterTimestamp = settleAt.toString()
		}
		verified.push(verifiedReport)
	}
	return verified
}

export async function discoverEcosystemSnapshot(context: EcosystemDiscoveryContext): Promise<EcosystemSnapshot> {
	context = { ...context, client: limitDiscoveryConcurrency(context.client) }
	const limits = limitsWithDefaults(context.limits)
	for (const [label, value] of Object.entries(limits)) requirePositiveLimit(value, label)
	requireAggregateDiscoveryEnvelope(limits)
	const block = await context.client.getBlock({ blockNumber: context.anchorBlockNumber })
	if (block.hash === null || block.hash === undefined) throw new Error('Canonical discovery anchor has no block hash')
	if (block.number === undefined) throw new Error('Canonical discovery anchor has no block number')
	if (block.baseFeePerGas === null || block.baseFeePerGas === undefined) throw new Error('Canonical discovery anchor has no EIP-1559 base fee')
	if (block.number !== context.anchorBlockNumber) throw new Error(`RPC returned block ${block.number.toString()} for requested anchor ${context.anchorBlockNumber.toString()}`)
	if (context.expectedAnchorHash !== undefined && block.hash.toLowerCase() !== context.expectedAnchorHash.toLowerCase()) {
		throw new Error(`RPC anchor hash ${block.hash} does not match quorum anchor ${context.expectedAnchorHash}`)
	}
	if (context.expectedAnchorBaseFeePerGas !== undefined && block.baseFeePerGas !== context.expectedAnchorBaseFeePerGas) {
		throw new Error(`RPC anchor base fee ${block.baseFeePerGas.toString()} does not match quorum anchor ${context.expectedAnchorBaseFeePerGas.toString()}`)
	}
	const blockNumber = block.number
	const resolvedTopology = await immutableTopologyForAnchor(context, { hash: block.hash, number: blockNumber })
	const topology = resolvedTopology.topology
	const topologyMutation = { changed: resolvedTopology.reset }
	const tradingDeployment = await authenticateConfiguredGraph(context, blockNumber)
	const issues: DiscoveryIssue[] = []
	const run: DiscoveryRun = { context, blockNumber, limits, topology, mutation: topologyMutation, issues }
	const [chainId, ethBalanceAttoEth, universes, questions, openOracleEthCredit] = await drainConcurrent([
		context.client.getChainId(),
		context.wallet === undefined ? Promise.resolve(0n) : context.client.getBalance({ address: context.wallet, blockNumber }),
		discoverUniverses(run),
		discoverQuestions(run),
		context.wallet === undefined ? Promise.resolve(0n) : context.client.readContract({ abi: abis.openOracleAbi, address: context.deployments.openOracle, args: [context.wallet, zeroAddress], blockNumber, functionName: 'tokenHolder' }),
	])
	const { pools, staged } = await discoverPools({ ...run, anchorTimestamp: block.timestamp, anchorBaseFeePerGas: block.baseFeePerGas, universes, questions })
	const pairs = tradingDeployment.factory ? await discoverPairs(context, pools, blockNumber, topology, topologyMutation) : []
	const universeUniswap = context.deployments.uniswapV3Factory !== undefined || context.discoverGenesisDeployment ? await discoverUniverseUniswap(context, universes, blockNumber, chainId) : undefined
	const genesis = universeUniswap?.pools.find(pool => pool.universeId === '0')
	const genesisUniswap =
		context.discoverGenesisDeployment && universeUniswap !== undefined
			? { factory: universeUniswap.factory, initialized: genesis?.initialized ?? false, liquidity: genesis?.liquidity ?? '0', ...(genesis?.pool === undefined ? {} : { pool: genesis.pool }), proxy: universeUniswap.proxy, seeder: universeUniswap.seeder }
			: undefined
	const indexedReports = context.wallet === undefined ? [] : trustedIndexedReportsForDiscovery({ deployments: context.deployments, pools, reports: context.indexedReports ?? [], universes, wallet: context.wallet })
	context = { ...context, indexedReports }
	const [tokens, shares, lpTokens, auctions, reports] = await drainConcurrent([
		discoverTokenInventory(context, universes, pools, blockNumber),
		discoverShareInventory(context, pools, pairs, universes, questions, blockNumber, issues),
		discoverLpInventory(context, pairs, blockNumber),
		discoverAuctions(context, pools, blockNumber),
		verifyIndexedReports(context, blockNumber),
	])
	const snapshot: EcosystemSnapshot = {
		anchor: { baseFeePerGas: block.baseFeePerGas.toString(), blockHash: block.hash, blockNumber: blockNumber.toString(), timestamp: block.timestamp.toString() },
		auctions,
		chainId,
		deployments: context.deployments,
		escalationDeposits: [...(context.indexedEscalationDeposits ?? [])],
		pairs,
		pools,
		questions,
		reports,
		schemaVersion: 1,
		stagedOperations: staged,
		tradingDeployment,
		...(genesisUniswap === undefined ? {} : { genesisUniswap }),
		...(universeUniswap === undefined ? {} : { universeUniswap }),
		universes,
		// The empty wallet is inert planning data; no account RPC uses this placeholder.
		wallet: { address: context.wallet ?? zeroAddress, ethBalanceAttoEth: ethBalanceAttoEth.toString(), lpTokens, openOracleEthCredit: openOracleEthCredit.toString(), shares, tokens },
		discoveryIssues: canonicalDiscoveryIssues(issues),
		warnings: formatDiscoveryWarnings(issues),
	}
	context.recordTopologyCache?.(
		{
			...cloneImmutableTopologyData(topology),
			anchor: { blockHash: block.hash, blockNumber: blockNumber.toString() },
			schemaVersion: IMMUTABLE_TOPOLOGY_CACHE_SCHEMA_VERSION,
		},
		topologyMutation.changed,
	)
	return snapshot
}

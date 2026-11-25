import { readOperationClient, runReadOperation } from '@zoltar/ui-core-shared/lib/readOperation.js'
import { getAddress, zeroAddress, type Address, type Hash, type PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory, statoblast_QuestionLedger_QuestionLedger, statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { DeploymentConfiguration } from './config.js'
import { shareTokenAbi } from './authorization.js'
import { tradingContracts } from '../generated/contractArtifact.js'
import {
	type MarketDiscoveryProgress,
	type LiveMarket,
	publicErrorMessage,
	createQuestionLedgerDeploymentIndex,
	loadQuestionLedgerRegistry,
	mapWithConcurrency,
	loadLiveMarket,
	shareBalanceScope,
	loadSelectedUniverseIds,
	marketDiscoveryPage,
	refreshQuestionLedgerDeploymentIndex,
	registryBlockAnchorIsCanonical,
	unavailableMarket,
	type QuestionLedgerDeployment,
	type QuestionLedgerDeploymentIndex,
} from './live.js'
import { latestBlockIdentity } from './tradeQuote.js'

const poolAbi = statoblast_QuestionLedger_QuestionLedger.abi
const poolFactoryAbi = statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi
const tradingFactoryAbi = tradingContracts['contracts/trading/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory.abi
type PairDeployment = Readonly<{ questionLedger: Address; shareToken: Address; universeId: bigint }>
export type TradingPairIndex = QuestionLedgerDeploymentIndex<PairDeployment, { blockNumber: bigint; blockHash: Hash }>

function createTradingPairIndex(): TradingPairIndex {
	return createQuestionLedgerDeploymentIndex()
}

function questionLedgerNotFound(message: string) {
	return Object.assign(new Error(message), { name: 'QuestionLedgerNotFoundError' })
}

export function isQuestionLedgerNotFoundError(error: unknown) {
	return error instanceof Error && error.name === 'QuestionLedgerNotFoundError'
}

async function loadCanonicalPoolDeployment(client: PublicClient, configuration: DeploymentConfiguration, pool: Address): Promise<QuestionLedgerDeployment> {
	const [factory, universeId, shareToken, zoltar] = await Promise.all([
		client.readContract({ abi: poolAbi, address: pool, functionName: 'securityPoolFactory' }),
		client.readContract({ abi: poolAbi, address: pool, functionName: 'universeId' }),
		client.readContract({ abi: poolAbi, address: pool, functionName: 'shareToken' }),
		client.readContract({ abi: poolAbi, address: pool, functionName: 'zoltar' }),
	]).catch(error => {
		if (error instanceof Error && error.name === 'ContractFunctionZeroDataError') throw questionLedgerNotFound('Question ledger does not exist at this address. Check the address and network.')
		throw error
	})
	if (getAddress(factory) !== getAddress(configuration.securityPoolFactory) || getAddress(zoltar) !== getAddress(configuration.zoltar)) throw questionLedgerNotFound('Question ledger does not exist in the configured deployment. Check the address and network.')
	const originId = await client.readContract({ abi: poolFactoryAbi, address: configuration.securityPoolFactory, functionName: 'getQuestionLedgerOriginId', args: [pool] })
	const [registeredPool, canonicalPool] = await Promise.all([
		client.readContract({ abi: poolFactoryAbi, address: configuration.securityPoolFactory, functionName: 'getQuestionLedger', args: [originId, universeId] }),
		client.readContract({ abi: shareTokenAbi, address: getAddress(shareToken), functionName: 'canonicalQuestionLedgerByUniverse', args: [universeId] }),
	])
	if (getAddress(registeredPool) !== pool || getAddress(canonicalPool) !== pool) throw questionLedgerNotFound('This address is not a registered question ledger.')
	const [questionId, statoblastSecurityMultiplierBps, manager] = await Promise.all([
		client.readContract({ abi: poolAbi, address: pool, functionName: 'questionId' }),
		client.readContract({ abi: poolAbi, address: pool, functionName: 'statoblastSecurityMultiplierBps' }),
		client.readContract({ abi: poolAbi, address: pool, functionName: 'sharedPriceFeed' }),
	])
	const initialReportPriorityFeeAttoEthPerGas = await client.readContract({ abi: statoblast_SharedPoolPriceFeed_SharedPoolPriceFeed.abi, address: getAddress(manager), functionName: 'initialReportPriorityFeeAttoEthPerGas' })
	return { questionLedger: pool, shareToken: getAddress(shareToken), universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas }
}

export async function discoverAddressedMarket(client: PublicClient, configuration: DeploymentConfiguration, address: Address) {
	const pool = getAddress(address)
	if (pool === zeroAddress) throw new Error('Enter a nonzero question ledger address')
	const deployment = await loadCanonicalPoolDeployment(client, configuration, pool)
	const market = await loadLiveMarket(client, configuration, deployment)
	return { start: 0n, count: 1n, total: 1n, previousStart: undefined, nextStart: undefined, markets: [market], universeIds: [market.universeId], selectedUniverseId: market.universeId }
}

/** Confirms one selected universe for universe and address-lookup routes without enumerating the tree. */
export async function discoverUniverses(client: PublicClient, configuration: DeploymentConfiguration, requestedUniverseId: bigint | undefined, isCurrent = () => true) {
	const { universeIds, selectedUniverseId } = await loadSelectedUniverseIds(client, configuration, requestedUniverseId, isCurrent)
	return { ...marketDiscoveryPage(0n), total: 0n, markets: [], universeIds, selectedUniverseId }
}

export type SavedPortfolioPool = Readonly<{ pool: Address; universeId: bigint | undefined; market: LiveMarket | undefined }>

/** Find holdings across registered questions, including pools the browser has never opened. */
async function discoverWalletPools(client: PublicClient, configuration: DeploymentConfiguration, universeId: bigint, account: Address, isCurrent: () => boolean): Promise<SavedPortfolioPool[]> {
	const anchor = await latestBlockIdentity(client)
	const deployments = await loadQuestionLedgerRegistry(client, configuration, universeId, anchor.blockNumber, isCurrent)
	const owned = await mapWithConcurrency(deployments, 4, async deployment => {
		if (!isCurrent()) throw new Error('Portfolio refresh cancelled')
		const pool = { pool: deployment.questionLedger, shareToken: deployment.shareToken, universeId: deployment.universeId }
		try {
			return await runReadOperation(
				async operation => {
					const reader = readOperationClient(client, operation)
					const scope = shareBalanceScope(pool)
					const pair = await reader.readContract({ abi: tradingFactoryAbi, address: configuration.factory, functionName: 'getPair', args: [pool.pool], blockNumber: anchor.blockNumber })
					const balances = await Promise.all([
						...[scope.invalidTokenId, scope.yesTokenId, scope.noTokenId].map(id => reader.readContract({ abi: shareTokenAbi, address: pool.shareToken, functionName: 'balanceOf', args: [account, id], blockNumber: anchor.blockNumber })),
						pair === zeroAddress ? 0n : reader.readContract({ abi: tradingContracts['contracts/trading/TwoWayConstantProductPair.sol'].TwoWayConstantProductPair.abi, address: pair, functionName: 'balanceOf', args: [account], blockNumber: anchor.blockNumber }),
					])
					return balances.some(balance => balance > 0n) ? [{ ...pool, market: undefined }] : []
				},
				{ isCurrent },
			)
		} catch (error) {
			if (!isCurrent()) throw error
			// Keep uncertain rows visible: an RPC failure must not masquerade as zero holdings.
			return [{ ...pool, market: undefined }]
		}
	})
	if (!isCurrent()) throw new Error('Portfolio refresh cancelled')
	if (!(await registryBlockAnchorIsCanonical(anchor, () => latestBlockIdentity(client), getActiveBackend().id === 'simulation' ? undefined : async blockNumber => latestBlockIdentity({ getBlock: () => client.getBlock({ blockNumber }) })))) throw new Error('Portfolio discovery head changed; refresh again')
	return owned.flat()
}

/** Refresh wallet-wide holdings plus saved addresses; cached summaries never supply balances or prices. */
export async function discoverSavedMarkets(client: PublicClient, configuration: DeploymentConfiguration, requestedUniverseId: bigint | undefined, savedMarkets: readonly SavedPortfolioPool[], onProgress?: MarketDiscoveryProgress, isCurrent = () => true, account?: Address) {
	const { universeIds, selectedUniverseId } = await runReadOperation(operation => loadSelectedUniverseIds(readOperationClient(client, operation), configuration, requestedUniverseId, isCurrent), { isCurrent })
	const walletPools = account === undefined || selectedUniverseId === undefined ? [] : await discoverWalletPools(client, configuration, selectedUniverseId, account, isCurrent)
	const saved = [...new Map([...walletPools, ...savedMarkets].filter(market => market.universeId === undefined || market.universeId === selectedUniverseId).map(market => [market.pool.toLowerCase(), market])).values()]
	const total = BigInt(saved.length)
	const result = { start: 0n, count: total, total, previousStart: undefined, nextStart: undefined, universeIds, selectedUniverseId }
	const markets = await mapWithConcurrency(
		saved,
		1,
		async (cached, index) => {
			if (!isCurrent()) throw new Error('Portfolio refresh cancelled')
			if (index > 0) await new Promise(resolve => setTimeout(resolve, 1_000))
			if (!isCurrent()) throw new Error('Portfolio refresh cancelled')
			try {
				const discovered = await runReadOperation(operation => discoverAddressedMarket(readOperationClient(client, operation), configuration, cached.pool), { isCurrent })
				const market = discovered.markets[0]
				if (market === undefined) throw new Error('Favorite market is unavailable')
				return market.universeId === selectedUniverseId ? market : undefined
			} catch (error) {
				if (!isCurrent()) throw error
				const market = cached.market ?? unavailableMarket({ questionLedger: cached.pool, universeId: selectedUniverseId ?? 0n, shareToken: zeroAddress, questionId: 0n, statoblastSecurityMultiplierBps: 0n, initialReportPriorityFeeAttoEthPerGas: 0n }, error, configuration.feeBps)
				return { ...market, loadError: publicErrorMessage(error, 'Favorite market refresh failed.') }
			}
		},
		markets => onProgress?.({ ...result, markets }),
	)
	return { ...result, markets: markets.filter(market => market !== undefined) }
}

export async function discoverTradingMarketPage(client: PublicClient, configuration: DeploymentConfiguration, requestedUniverseId: bigint | undefined, requestedStart = 0n, pageSize = 25n, index = createTradingPairIndex(), isCurrent = () => true, onProgress?: MarketDiscoveryProgress) {
	const { universeIds, selectedUniverseId } = await loadSelectedUniverseIds(client, configuration, requestedUniverseId, isCurrent)
	if (selectedUniverseId === undefined) return { ...marketDiscoveryPage(0n), total: 0n, markets: [], universeIds, selectedUniverseId }
	const canonical = async (anchor: { blockNumber: bigint; blockHash: Hash }) =>
		await registryBlockAnchorIsCanonical(anchor, async () => await latestBlockIdentity(client), getActiveBackend().id === 'simulation' ? undefined : async blockNumber => await latestBlockIdentity({ getBlock: async () => await client.getBlock({ blockNumber }) }))
	const deployments = await refreshQuestionLedgerDeploymentIndex(
		index,
		`${configuration.chainId}:${configuration.factory}:${configuration.rpcUrl}:${selectedUniverseId}`,
		async () => await latestBlockIdentity(client),
		canonical,
		async anchor => {
			const { blockNumber } = anchor
			const pools = await loadQuestionLedgerRegistry(client, configuration, selectedUniverseId, blockNumber, isCurrent, { index: index.registry, anchor })
			const pairs = await mapWithConcurrency(pools, 8, async deployment => {
				if (!isCurrent()) throw new Error('Market discovery cancelled')
				const pair = await client.readContract({ abi: tradingFactoryAbi, address: configuration.factory, functionName: 'getPair', args: [deployment.questionLedger], blockNumber })
				return pair === zeroAddress ? [] : [deployment]
			})
			return pairs.flat()
		},
	)
	if (!isCurrent()) throw new Error('Market discovery cancelled')
	const page = marketDiscoveryPage(BigInt(deployments.length), requestedStart, pageSize)
	const pageDeployments = deployments.filter((_deployment, position) => BigInt(position) >= page.start && BigInt(position) < page.start + page.count)
	const markets = await mapWithConcurrency(
		pageDeployments,
		6,
		async deployment => {
			try {
				const { markets } = await discoverAddressedMarket(client, configuration, deployment.questionLedger)
				const market = markets[0]
				if (market === undefined || market.pair === undefined || market.universeId !== deployment.universeId || market.shareToken !== deployment.shareToken) throw new Error('The trading pool registry no longer matches its question ledger')
				return market
			} catch (error) {
				return { ...unavailableMarket({ ...deployment, questionId: 0n, statoblastSecurityMultiplierBps: 0n, initialReportPriorityFeeAttoEthPerGas: 0n }, error, configuration.feeBps), title: `Question ledger ${deployment.questionLedger}` }
			}
		},
		markets => onProgress?.({ ...page, total: BigInt(deployments.length), markets, universeIds, selectedUniverseId }),
	)
	return { ...page, total: BigInt(deployments.length), markets, universeIds, selectedUniverseId }
}

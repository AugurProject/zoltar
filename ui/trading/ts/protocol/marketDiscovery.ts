import { getAddress, zeroAddress, type Address, type Hash, type PublicClient } from '@zoltar/core-shared/evm/ethereum'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory, statoblast_SecurityPool_SecurityPool, statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator } from '@zoltar/ui-statoblast-shared/contractArtifact.js'
import { getActiveBackend } from '@zoltar/ui-core-shared/lib/activeEnvironment.js'
import type { DeploymentConfiguration } from './config.js'
import { shareTokenAbi } from './authorization.js'
import { tradingContracts } from '../generated/contractArtifact.js'
import { createSecurityPoolDeploymentIndex, loadLiveMarket, loadUniverseIds, marketDiscoveryPage, refreshSecurityPoolDeploymentEventIndex, registryBlockAnchorIsCanonical, unavailableMarket, type SecurityPoolDeployment, type SecurityPoolDeploymentIndex } from './live.js'
import { latestBlockIdentity } from './tradeQuote.js'

const poolAbi = statoblast_SecurityPool_SecurityPool.abi
const poolFactoryAbi = statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi
const tradingFactoryAbi = tradingContracts['contracts/trading/TwoWayConstantProductFactory.sol'].TwoWayConstantProductFactory.abi
const pairCreated = tradingFactoryAbi.find(entry => entry.type === 'event' && entry.name === 'PairCreated')
if (pairCreated === undefined) throw new Error('PairCreated event is missing from the trading factory ABI')

type PairDeployment = Readonly<{ securityPool: Address; shareToken: Address; universeId: bigint }>
export type TradingPairIndex = SecurityPoolDeploymentIndex<PairDeployment, { blockNumber: bigint; blockHash: Hash }>

export function createTradingPairIndex(): TradingPairIndex {
	return createSecurityPoolDeploymentIndex()
}

async function loadCanonicalPoolDeployment(client: PublicClient, configuration: DeploymentConfiguration, pool: Address): Promise<SecurityPoolDeployment> {
	const [factory, universeId, shareToken, zoltar] = await Promise.all([
		client.readContract({ abi: poolAbi, address: pool, functionName: 'securityPoolFactory' }),
		client.readContract({ abi: poolAbi, address: pool, functionName: 'universeId' }),
		client.readContract({ abi: poolAbi, address: pool, functionName: 'shareToken' }),
		client.readContract({ abi: poolAbi, address: pool, functionName: 'zoltar' }),
	])
	if (getAddress(factory) !== getAddress(configuration.securityPoolFactory) || getAddress(zoltar) !== getAddress(configuration.zoltar)) throw new Error('Pool does not belong to the configured deployment')
	const originId = await client.readContract({ abi: poolFactoryAbi, address: configuration.securityPoolFactory, functionName: 'getSecurityPoolOriginId', args: [pool] })
	const [registeredPool, canonicalPool] = await Promise.all([
		client.readContract({ abi: poolFactoryAbi, address: configuration.securityPoolFactory, functionName: 'getSecurityPool', args: [originId, universeId] }),
		client.readContract({ abi: shareTokenAbi, address: getAddress(shareToken), functionName: 'canonicalPoolByUniverse', args: [universeId] }),
	])
	if (getAddress(registeredPool) !== pool || getAddress(canonicalPool) !== pool) throw new Error('Address is not a canonical SecurityPool')
	const [questionId, statoblastSecurityMultiplierBps, manager] = await Promise.all([
		client.readContract({ abi: poolAbi, address: pool, functionName: 'questionId' }),
		client.readContract({ abi: poolAbi, address: pool, functionName: 'statoblastSecurityMultiplierBps' }),
		client.readContract({ abi: poolAbi, address: pool, functionName: 'priceOracleManagerAndOperatorQueuer' }),
	])
	const initialReportPriorityFeeAttoEthPerGas = await client.readContract({ abi: statoblast_OpenOraclePriceCoordinator_OpenOraclePriceCoordinator.abi, address: getAddress(manager), functionName: 'initialReportPriorityFeeAttoEthPerGas' })
	return { securityPool: pool, shareToken: getAddress(shareToken), universeId, questionId, statoblastSecurityMultiplierBps, initialReportPriorityFeeAttoEthPerGas }
}

export async function discoverAddressedMarket(client: PublicClient, configuration: DeploymentConfiguration, address: Address) {
	const pool = getAddress(address)
	if (pool === zeroAddress) throw new Error('Enter a nonzero SecurityPool address')
	let deployment
	try {
		deployment = await loadCanonicalPoolDeployment(client, configuration, pool)
	} catch (error) {
		if (error instanceof Error && error.name === 'ContractFunctionZeroDataError') throw new Error('No SecurityPool found at this address. Check the address and network.')
		throw error
	}
	const market = await loadLiveMarket(client, configuration, deployment)
	return { start: 0n, count: 1n, total: 1n, previousStart: undefined, nextStart: undefined, markets: [market], universeIds: [market.universeId], selectedUniverseId: market.universeId }
}

function deploymentFromPairEvent(log: Readonly<{ args?: unknown }>): PairDeployment {
	const args = log.args
	if (typeof args !== 'object' || args === null) throw new Error('Trading pair event has no arguments')
	const securityPool = Reflect.get(args, 'securityPool')
	const shareToken = Reflect.get(args, 'shareToken')
	const universeId = Reflect.get(args, 'universeId')
	if (typeof securityPool !== 'string' || typeof shareToken !== 'string' || typeof universeId !== 'bigint') throw new Error('Trading pair event is incomplete')
	return { securityPool: getAddress(securityPool), shareToken: getAddress(shareToken), universeId }
}

export async function discoverTradingMarketPage(client: PublicClient, configuration: DeploymentConfiguration, requestedUniverseId: bigint | undefined, requestedStart = 0n, pageSize = 25n, index = createTradingPairIndex(), isCurrent = () => true) {
	const universeIds = await loadUniverseIds(client, configuration, isCurrent)
	const selectedUniverseId = requestedUniverseId !== undefined && universeIds.includes(requestedUniverseId) ? requestedUniverseId : universeIds[0]
	if (selectedUniverseId === undefined) return { ...marketDiscoveryPage(0n), total: 0n, markets: [], universeIds, selectedUniverseId }
	const canonical = async (anchor: { blockNumber: bigint; blockHash: Hash }) =>
		await registryBlockAnchorIsCanonical(anchor, async () => await latestBlockIdentity(client), getActiveBackend().id === 'simulation' ? undefined : async blockNumber => await latestBlockIdentity({ getBlock: async () => await client.getBlock({ blockNumber }) }))
	const deployments = await refreshSecurityPoolDeploymentEventIndex(
		index,
		`${configuration.chainId}:${configuration.factory}:${configuration.rpcUrl}:${selectedUniverseId}`,
		async () => await latestBlockIdentity(client),
		canonical,
		async (fromBlock, toBlock) => {
			if (!isCurrent()) throw new Error('Market discovery cancelled')
			return (await client.getLogs({ address: configuration.factory, event: pairCreated, args: { universeId: selectedUniverseId }, fromBlock, toBlock })).map(deploymentFromPairEvent)
		},
	)
	if (!isCurrent()) throw new Error('Market discovery cancelled')
	const page = marketDiscoveryPage(BigInt(deployments.length), requestedStart, pageSize)
	const pageDeployments = deployments.filter((_deployment, position) => BigInt(position) >= page.start && BigInt(position) < page.start + page.count)
	const markets = await Promise.all(
		pageDeployments.map(async deployment => {
			try {
				const { markets } = await discoverAddressedMarket(client, configuration, deployment.securityPool)
				const market = markets[0]
				if (market === undefined || market.pair === undefined || market.universeId !== deployment.universeId || market.shareToken !== deployment.shareToken) throw new Error('Trading pair registry no longer matches its pool')
				return market
			} catch (error) {
				return { ...unavailableMarket({ ...deployment, questionId: 0n, statoblastSecurityMultiplierBps: 0n, initialReportPriorityFeeAttoEthPerGas: 0n }, error, configuration.feeBps), title: `Pool ${deployment.securityPool}` }
			}
		}),
	)
	return { ...page, total: BigInt(deployments.length), markets, universeIds, selectedUniverseId }
}

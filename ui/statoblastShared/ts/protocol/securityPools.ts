import { createRegistryIndex, readIncrementalRegistry, type RegistryIndex } from '@zoltar/ui-core-shared/lib/incrementalRegistry.js'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory, statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio } from '../contractArtifact.js'

import { zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { sameAddress } from '@zoltar/ui-core-shared/lib/address.js'
import type { ReadClient } from '@zoltar/ui-core-shared/types/contracts.js'
import type { ListedSecurityPool } from '../types/contracts.js'

import { requireSecurityPoolDeploymentTupleArray, type SecurityPoolDeploymentTuple } from './helpers.js'
import { requireAddressValue, requireArrayValue } from './decoders.js'
import { readOptionalMulticall } from '@zoltar/ui-zoltar-shared/protocol/core.js'
import { getInfraContractAddresses } from './deploymentHelpers.js'

import { loadSecurityPoolDetails } from './securityPoolSnapshot.js'

const securityPoolFactoryAbi = statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi
const securityPoolPortfolioAbi = statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio.abi
async function loadSecurityPoolDeployments(client: ReadClient, startIndex: bigint, count: bigint, blockNumber?: bigint) {
	if (count === 0n) return [] as readonly SecurityPoolDeploymentTuple[]
	return requireSecurityPoolDeploymentTupleArray(
		await client.readContract({
			address: getInfraContractAddresses().securityPoolFactory,
			abi: statoblast_factories_SecurityPoolFactory_SecurityPoolFactory.abi,
			functionName: 'securityPoolDeploymentsRange',
			args: [startIndex, count],
			blockNumber,
		}),
		'security pool deployments range',
	)
}

async function loadListedSecurityPools(client: ReadClient, deployments: readonly SecurityPoolDeploymentTuple[]) {
	return await Promise.all(deployments.map(deployment => loadSecurityPoolDetails(client, deployment)))
}

type DeploymentRegistryAnchor = Readonly<{ blockHash: `0x${string}`; blockNumber: bigint }>

async function loadDeploymentRegistryAnchor(client: ReadClient): Promise<DeploymentRegistryAnchor> {
	const block = await client.getBlock()
	if (block.hash === undefined || block.number === undefined) throw new Error('Security pool deployment head is missing its canonical identity')
	return { blockHash: block.hash, blockNumber: block.number }
}

async function requireDeploymentRegistryAnchor(client: ReadClient, anchor: DeploymentRegistryAnchor, changedMessage = 'Security pool deployments changed during discovery') {
	const block = await client.getBlock({ blockNumber: anchor.blockNumber })
	if (block.hash?.toLowerCase() !== anchor.blockHash.toLowerCase()) throw new Error(changedMessage)
}

function isCanonicalAnchor(client: ReadClient) {
	return async (candidate: DeploymentRegistryAnchor) => {
		const block = await client.getBlock({ blockNumber: candidate.blockNumber })
		return block.hash?.toLowerCase() === candidate.blockHash.toLowerCase()
	}
}

async function loadDeploymentRegistry(client: ReadClient, anchor: DeploymentRegistryAnchor, index: RegistryIndex<SecurityPoolDeploymentTuple> = createRegistryIndex()): Promise<readonly SecurityPoolDeploymentTuple[]> {
	const factory = getInfraContractAddresses().securityPoolFactory
	return await readIncrementalRegistry({
		index,
		key: factory.toLowerCase(),
		anchor,
		loadCount: async () => await client.readContract({ address: factory, abi: securityPoolFactoryAbi, functionName: 'securityPoolDeploymentCount', args: [], blockNumber: anchor.blockNumber }),
		loadRange: async (start, count) => await loadSecurityPoolDeployments(client, start, count, anchor.blockNumber),
		isCanonical: isCanonicalAnchor(client),
	})
}

async function loadPortfolioRegistry(client: ReadClient, anchor: DeploymentRegistryAnchor): Promise<readonly Address[]> {
	const factory = getInfraContractAddresses().securityPoolFactory
	return await readIncrementalRegistry({
		index: createRegistryIndex<Address>(),
		key: `${factory.toLowerCase()}:portfolios`,
		anchor,
		loadCount: async () => await client.readContract({ address: factory, abi: securityPoolFactoryAbi, functionName: 'portfolioCount', args: [], blockNumber: anchor.blockNumber }),
		loadRange: async (start, count) =>
			requireArrayValue(await client.readContract({ address: factory, abi: securityPoolFactoryAbi, functionName: 'portfoliosRange', args: [start, count], blockNumber: anchor.blockNumber }), 'registered portfolios').map(portfolio => requireAddressValue(portfolio, 'registered portfolio')),
		isCanonical: isCanonicalAnchor(client),
	})
}

function applyChildForkActivityHints(pools: ListedSecurityPool[]) {
	return pools.map(pool => {
		if (pool.hasForkActivity) return pool
		if (!pools.some(candidate => sameAddress(candidate.parent, pool.securityPoolAddress))) return pool
		return {
			...pool,
			hasForkActivity: true,
		}
	})
}

export async function loadAllSecurityPools(client: ReadClient): Promise<ListedSecurityPool[]> {
	const anchor = await loadDeploymentRegistryAnchor(client)
	const deployments = await loadDeploymentRegistry(client, anchor)
	const pools = await loadListedSecurityPools(client, deployments)
	await requireDeploymentRegistryAnchor(client, anchor)
	return applyChildForkActivityHints(pools)
}

export type RegisteredPortfolio = { portfolio: Address; questionCount: number }

type ListingRead = { status: 'success'; result: unknown } | { status: 'failure' }
// Retries go out in small groups, so a registry with many failing addresses does not flood the provider.
const LISTING_RETRY_GROUP = 8

function portfolioListingCalls(portfolio: Address, universeId: bigint) {
	return [
		{ address: portfolio, abi: securityPoolPortfolioAbi, functionName: 'capitalLedger', args: [universeId] },
		{ address: portfolio, abi: securityPoolPortfolioAbi, functionName: 'questionCount', args: [] },
	]
}

/** A row for an address that answers as a portfolio with a ledger in this universe, or `undefined` for anything else. */
function portfolioListing(portfolio: Address, ledger: ListingRead | undefined, questions: ListingRead | undefined): RegisteredPortfolio | undefined {
	if (ledger?.status !== 'success' || questions?.status !== 'success') return undefined
	if (typeof ledger.result !== 'string' || sameAddress(ledger.result, zeroAddress) || typeof questions.result !== 'bigint') return undefined
	return { portfolio, questionCount: Number(questions.result) }
}

/**
 * Portfolios that open in this universe, most recently registered first. The factory registers a portfolio when its
 * setup configures its price feed, so a portfolio still in setup can only be opened by its address. Any caller can
 * register its own address the same way, so only addresses that answer as a portfolio with a capital ledger in this
 * universe are listed; a portfolio keeps one ledger per universe it can open in.
 */
export async function loadRegisteredPortfolios(client: ReadClient, universeId: bigint): Promise<RegisteredPortfolio[]> {
	const anchor = await loadDeploymentRegistryAnchor(client)
	const portfolios = await loadPortfolioRegistry(client, anchor)
	let unanswered: unknown
	let answeredRequests = 0
	const read = async (batch: readonly Address[]) => {
		try {
			const reads = await readOptionalMulticall(
				client,
				batch.flatMap(portfolio => portfolioListingCalls(portfolio, universeId)),
				anchor.blockNumber,
			)
			answeredRequests += 1
			return reads
		} catch (error) {
			unanswered = error
			return undefined
		}
	}
	// One batched read at the anchor block. The calls share its gas, so one registered contract can fail the whole read
	// or starve the calls after it; those addresses are read again one at a time below.
	const batch = portfolios.length === 0 ? [] : await read(portfolios)
	const answered = (index: number) => batch?.[2 * index]?.status === 'success' && batch[2 * index + 1]?.status === 'success'
	const listings = portfolios.map((portfolio, index) => portfolioListing(portfolio, batch?.[2 * index], batch?.[2 * index + 1]))
	const retries = portfolios.flatMap((portfolio, index) => (answered(index) ? [] : [{ portfolio, index }]))
	for (let start = 0; start < retries.length; start += LISTING_RETRY_GROUP) {
		await Promise.all(
			retries.slice(start, start + LISTING_RETRY_GROUP).map(async ({ portfolio, index }) => {
				// Only an address that fails on its own is skipped.
				const own = await read([portfolio])
				listings[index] = portfolioListing(portfolio, own?.[0], own?.[1])
			}),
		)
	}
	// With no request answered at all, the provider failed rather than one registered contract, so the list reports it.
	if (portfolios.length > 0 && answeredRequests === 0) throw unanswered
	await requireDeploymentRegistryAnchor(client, anchor, 'Portfolios changed during discovery')
	return listings.filter(listing => listing !== undefined).reverse()
}

import { createRegistryIndex, readIncrementalRegistry, type RegistryIndex } from '@zoltar/ui-core-shared/lib/incrementalRegistry.js'
import { statoblast_factories_SecurityPoolFactory_SecurityPoolFactory, statoblast_SecurityPoolPortfolio_SecurityPoolPortfolio } from '../contractArtifact.js'

import { RpcError, zeroAddress, type Address } from '@zoltar/core-shared/evm/ethereum'
import { errorChain } from '@zoltar/core-shared/errors/errorChain'
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
// Listing reads go out in registry-sized pages, at most this many requests at once, as registry pages do; a growing
// registry then never outgrows the request size a provider accepts.
const LISTING_PAGE_SIZE = 100
const LISTING_READ_CONCURRENCY = 4

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
 * The node ran the calls and they failed: a revert or exhausted gas. A request that got no answer, such as an HTTP error,
 * a timeout or a lost connection, is not one, and neither is empty return data: Multicall3 always returns encoded
 * results or reverts, so empty data means the node or the deployment is at fault, not a registered contract.
 */
function isExecutionFailure(error: unknown) {
	return [...errorChain(error)].some(current => {
		if (current instanceof Error && current.name === 'ContractFunctionRevertedError') return true
		// An HTTP status arrives in the same field as a JSON-RPC error code, but then the node never ran the calls.
		if (!(current instanceof RpcError) || typeof current.code !== 'number' || (current.code >= 100 && current.code < 600)) return false
		// Nodes word these differently, such as "out of gas" and "EVM error OutOfGas".
		const message = current.message.toLowerCase().replaceAll(/[\s_-]/g, '')
		return message.includes('revert') || message.includes('outofgas') || message.includes('gasrequiredexceeds') || message.includes('invalidopcode')
	})
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
	const listings = new Map<Address, RegisteredPortfolio>()
	// Every request ends with this call. A call starved of gas takes almost all that is left with it, so when this one
	// succeeds, no call before it was starved and each failed address failed on its own.
	const gasWitness = { address: getInfraContractAddresses().securityPoolFactory, abi: securityPoolFactoryAbi, functionName: 'portfolioCount', args: [] }
	let reading = 0
	const queued: (() => void)[] = []
	const read = async (addresses: readonly Address[]): Promise<readonly ListingRead[] | undefined> => {
		while (reading >= LISTING_READ_CONCURRENCY) await new Promise<void>(resolve => queued.push(resolve))
		reading += 1
		try {
			return await readOptionalMulticall(client, [...addresses.flatMap(portfolio => portfolioListingCalls(portfolio, universeId)), gasWitness], anchor.blockNumber)
		} catch (error) {
			// Only a failure the node reports for the calls is put down to a registered contract; anything else fails the list.
			if (!isExecutionFailure(error)) throw error
			return undefined
		} finally {
			reading -= 1
			queued.shift()?.()
		}
	}
	// Each set of addresses is read in one batched request at the anchor block. Any contract can register, and a request's
	// calls share its gas, so one contract can fail the whole request or starve the calls after it.
	const settle = async (addresses: readonly Address[]): Promise<void> => {
		const reads = await read(addresses)
		const answered = addresses.map((_, index) => reads?.[2 * index]?.status === 'success' && reads[2 * index + 1]?.status === 'success')
		for (const [index, portfolio] of addresses.entries()) {
			const listing = answered[index] ? portfolioListing(portfolio, reads?.[2 * index], reads?.[2 * index + 1]) : undefined
			if (listing !== undefined) listings.set(portfolio, listing)
		}
		if (reads?.[2 * addresses.length]?.status === 'success') return
		// Otherwise a call that failed before a later success still had gas, so its address failed on its own and is
		// skipped. The calls after the last success may have been starved by an earlier contract, so they are read again.
		const unanswered = addresses.slice(answered.lastIndexOf(true) + 1)
		if (unanswered.length === 0 || addresses.length === 1) return
		if (unanswered.length < addresses.length) return await settle(unanswered)
		// A set that got no answer at all is split, so every round makes progress and one contract costs a few requests.
		const middle = Math.ceil(addresses.length / 2)
		await Promise.all([settle(addresses.slice(0, middle)), settle(addresses.slice(middle))])
	}
	await Promise.all(Array.from({ length: Math.ceil(portfolios.length / LISTING_PAGE_SIZE) }, (_, page) => settle(portfolios.slice(page * LISTING_PAGE_SIZE, (page + 1) * LISTING_PAGE_SIZE))))
	await requireDeploymentRegistryAnchor(client, anchor, 'Portfolios changed during discovery')
	return portfolios.flatMap(portfolio => listings.get(portfolio) ?? []).reverse()
}
